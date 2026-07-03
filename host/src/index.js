import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { cryAudioId } from "./pet/cry-audio.js";
import { cryFor } from "./pet/cries.js";
import { loadConfig, saveConfig } from "./config.js";
import { rollPersonality } from "./pet/personality.js";
import { applyDailyGrowth, deriveMood, PARAMS } from "./pet/sim.js";
import { buildUsedDays, settleDays } from "./pet/settlement.js";
import { resolveEvolution } from "./pet/evolution.js";
import { runOnboarding } from "./pet/onboarding.js";
import { createBuddyAnimator } from "./render/buddy-animator.js";
import { playEvolutionAnimation } from "./render/evolution-anim.js";
import { renderFrame } from "./render/frame.js";
import { playSignatureAnimation } from "./render/signature-anim.js";
import { loadBuddySprite } from "./render/sprites.js";
import { loadState, saveState } from "./state.js";
import { createTransport } from "./transport/index.js";
import { SOUND } from "./transport/proto.js";
import { loadRateLimits } from "./rate-limits.js";
import { pollUsageOnce } from "./usage-poll.mjs";
import { loadUsageSnapshot, usageForDisplay } from "./usage.js";
import { startWebServer } from "./web/server.js";
import { validateSettings } from "./web/settings.js";
import { toDashboardView } from "./web/viewmodel.js";
import { makeWeather } from "./weather.js";

const DEFAULT_WEATHER = {
  cond: "多云",
  temp: 19,
  feels: 17,
  hi: 22,
  lo: 14,
  precip: 30,
  wind: 11,
  humidity: 64,
};

// Overlay official statusline rate-limits (5h/week %/reset) onto the ccusage
// snapshot, which now only sources cost/token totals.
export function mergeUsage(ccusageUsage, rateLimits) {
  return {
    ...ccusageUsage,
    p5h: rateLimits.p5h,
    pweek: rateLimits.pweek,
    resets5h: rateLimits.resets5h,
    resetsWeek: rateLimits.resetsWeek,
    official: rateLimits.official,
    rateStale: rateLimits.stale,
  };
}

export function shouldPlaySignature(event, pet) {
  return event?.key === "KEY" && event?.kind === "short" && pet?.readyToEvolve === false;
}

export function shouldQueueButtonForTick(event) {
  return event?.key === "KEY" && (
    event.kind === "short" ||
    event.kind === "long" ||
    event.kind === "double"
  );
}

// 串行化动作：tick 与招牌经同一队列互斥，杜绝 tick 帧插进招牌帧序列之间。
export function createActionQueue() {
  let chain = Promise.resolve();
  return {
    run(fn) {
      const result = chain.then(fn);
      chain = result.then(() => {}, () => {});
      return result;
    },
  };
}

export function createEvolutionIntentQueue() {
  const intents = [];
  return {
    push(intent) {
      intents.push(intent);
    },
    drain() {
      return intents.splice(0);
    },
  };
}

export function createButtonDispatcher({
  transport,
  getPet = () => undefined,
  getModel = () => null,
  actions = createActionQueue(),
  animator = { pause() {}, resume() {} },
  playSignature = playSignatureAnimation,
  onSignatureError = () => {},
} = {}) {
  const tickQueue = [];
  let signatureInFlight = false;
  const off = transport?.onButton?.((event) => {
    if (shouldPlaySignature(event, getPet())) {
      if (signatureInFlight) return;
      const pressModel = getModel();
      if (pressModel) {
        signatureInFlight = true;
        actions.run(async () => {
          animator.pause();
          try { await playSignature({ transport, model: pressModel }); }
          finally { animator.resume(); }
        }).catch(onSignatureError).finally(() => { signatureInFlight = false; });
      }
      return;
    }

    if (shouldQueueButtonForTick(event)) tickQueue.push(event);
  });

  return {
    drainTickEvents() {
      return tickQueue.splice(0);
    },
    requeueForRetry(events) {
      const retry = events
        .filter((event) => event && !event.requeued)
        .map((event) => ({ ...event, requeued: true }));
      tickQueue.unshift(...retry);
      return retry.length;
    },
    stop() {
      off?.();
    },
  };
}

export async function runOneTick({
  usage,
  weather,
  room,
  statePath = "out/state.json",
  framePath = "out/frame.png",
  now = new Date(),
  today = localYmd(now),
  mock,
  transport,
  transportFactory = createTransport,
  personalityRng = Math.random,
  evolutionDelay,
  onRenderModel,
  pendingButtons,
  evolutionIntents,
} = {}) {
  if (!usage) throw new Error("usage is required");
  if (!weather) throw new Error("weather is required");

  mkdirSync(dirname(statePath), { recursive: true });
  const activeTransport = transport ?? (mock ? adaptPngTransport(mock) : await transportFactory({ framePath }));
  const buttonEvents = Array.isArray(pendingButtons)
    ? [...pendingButtons]
    : collectStandaloneButtonSnapshot(activeTransport);
  const evolutionIntentEvents = drainEvolutionIntents(evolutionIntents);
  const sensor = room ?? activeTransport.feedSensor?.();
  let pet = ensurePet(loadState(statePath), today, personalityRng);
  pet = settleDays(pet, today, {
    usedDays: buildUsedDays(pet, today, usage),
  });

  const creditedTokens =
    usage.todayPeriod == null || usage.todayPeriod === today ? usage.todayTokens : 0;
  pet = applyDailyGrowth(pet, { todayTokens: creditedTokens, today });

  if (buttonEvents.some((event) => event?.key === "KEY" && event?.kind === "long")) {
    pet = { ...pet, careCount: Math.max(0, Number(pet.careCount ?? 0)) + 1 };
  }

  let evolutionAnimation = null;
  let choiceEvolved = false;
  for (const intent of evolutionIntentEvents) {
    if (intent?.type === "stone" && isEvolutionStone(intent.stone)) {
      pet = { ...pet, stone: intent.stone };
    } else if (intent?.type === "choose" && typeof intent.to === "string") {
      const choice = resolveEvolution(pet.species, evolutionContext({ pet, weather, room: sensor, now }))
        .candidates
        .find((candidate) => candidate.to === intent.to);
      if (choice) {
        const fromSpecies = pet.species;
        pet = evolvePet(pet, choice.to);
        evolutionAnimation = { fromSpecies, toSpecies: choice.to };
        choiceEvolved = true;
        break;
      }
    }
  }

  // Table-driven: resolve once against the evolution tables, recompute readiness
  // every tick (can fall back to false), and reuse the same resolution for KEY.
  const evolution = choiceEvolved
    ? { auto: null, candidates: [] }
    : resolveEvolution(pet.species, evolutionContext({ pet, weather, room: sensor, now }));
  const readyToEvolve = Boolean(evolution.auto || evolution.candidates.length > 0);
  pet = { ...pet, readyToEvolve };

  if (!choiceEvolved && readyToEvolve && hasKeyPress(buttonEvents)) {
    if (evolution.auto) {
      const fromSpecies = pet.species;
      const toSpecies = evolution.auto;
      pet = evolvePet(pet, toSpecies);
      evolutionAnimation = { fromSpecies, toSpecies };
    } else if (evolution.candidates.length > 0) {
      pet = { ...pet, pendingCandidates: evolution.candidates };
    }
  }

  if (evolutionAnimation) {
    saveState(statePath, pet);
    await playEvolutionAnimation({ transport: activeTransport, ...evolutionAnimation, delay: evolutionDelay });
  }

  const mood = deriveMood(usage);
  const cryId = cryAudioId(pet.species);
  if (cryId != null) activeTransport.setActiveCry?.(cryId);
  const sprite = await loadBuddySprite(pet.species);
  const model = {
    ...usage,
    now,
    weather,
    room: sensor,
    streak: pet.streak ?? 0,
    out: {
      t: weather.temp ?? 0,
      h: weather.humidity ?? 64,
    },
    buddy: {
      spriteGray: sprite.gray,
      spriteW: sprite.w,
      spriteH: sprite.h,
      mood,
      level: pet.level,
      species: pet.species,
      readyToEvolve: pet.readyToEvolve,
      bond: pet.bond,
      expPct: Number.isFinite(pet.exp) ? Math.round((pet.exp / PARAMS.levelExp) * 100) : 0,
      bubble: sprite.placeholder ? "BUDDY" : cryFor(pet.species, mood),
    },
  };
  onRenderModel?.(model);
  const { pngBuffer, bitmap } = await renderFrame(model);

  saveState(statePath, pet);
  await activeTransport.push({ pngBuffer, bitmap });

  return pet;
}

export async function main({
  once = process.env.CPB_ONCE === "1",
  intervalMs = Number(process.env.CPB_INTERVAL_MS ?? 60_000),
  configPath = "config.json",
  statePath = "out/state.json",
  framePath = "out/frame.png",
  usageRun,
  dashboard = process.env.CPB_DASHBOARD !== "0" && !once,
  dashboardHost = "127.0.0.1",
  dashboardPort = Number(process.env.CPB_DASHBOARD_PORT ?? 8765),
  transport: injectedTransport,
  weatherClient: injectedWeatherClient,
  pollUsage = pollUsageOnce,
  logger = console,
} = {}) {
  let config = loadConfig(configPath);
  const transport = injectedTransport ?? await createTransport({ framePath });
  let currentModel = null;
  const animator = createBuddyAnimator({
    transport,
    getModel: () => currentModel,
    render: renderFrame,
  });

  await runOnboardingGate({
    statePath,
    onboarding: async () => {
      const { io, off } = makeOnboardingIo(transport);
      try { return await runOnboarding(io); } finally { off?.(); }
    },
  });

  const weatherClient = injectedWeatherClient ?? makeWeather();
  let lastKnownUsage = null;
  let stopped = false;
  let timer = null;
  let resolveLoopSleep = null;
  let runtime = {};
  let lastPollUsageFailureReason = null;
  const actions = createActionQueue();
  const evolutionIntents = createEvolutionIntentQueue();
  const buttonDispatcher = createButtonDispatcher({
    transport,
    getPet: () => runtime.pet,
    getModel: () => currentModel,
    actions,
    animator,
    onSignatureError: () => {},
  });
  const dashboardServer = dashboard
    ? await startDashboardServer({
        host: dashboardHost,
        port: dashboardPort,
        statePath,
        configPath,
        framePath,
        getRuntime: () => runtime,
        getConfig: () => config,
        setConfig: (next) => { config = next; },
        evolutionIntents,
      })
    : null;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    resolveLoopSleep?.();
    resolveLoopSleep = null;
    buttonDispatcher.stop();
    animator.stop();
    dashboardServer?.close().catch(() => {});
    transport.close?.();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let lastHour = new Date().getHours();
  async function tick() {
    await actions.run(async () => {
      animator.pause();
      try {
        const snapshot = await loadUsageSnapshot({ ...config, run: usageRun });
        const selected = usageForDisplay(snapshot, lastKnownUsage);
        lastKnownUsage = selected.lastKnown;
        const pollResult = await pollUsage().catch((error) => ({
          ok: false,
          reason: errorReason(error),
        }));
        lastPollUsageFailureReason = logFailureReasonTransition({
          result: pollResult,
          lastReason: lastPollUsageFailureReason,
          logger,
          label: "pollUsage",
        });
        const usage = mergeUsage(selected.usage, loadRateLimits());
        const weather = await loadWeatherSnapshot(weatherClient, config);
        const room = transport.feedSensor();
        const pendingButtons = buttonDispatcher.drainTickEvents();
        let pet;
        try {
          pet = await runOneTick({
            usage,
            weather,
            room,
            statePath,
            framePath,
            transport,
            onRenderModel: (model) => { currentModel = model; },
            pendingButtons,
            evolutionIntents,
          });
        } catch (error) {
          buttonDispatcher.requeueForRetry(pendingButtons);
          throw error;
        }
        runtime = { usage, weather, room, pet };
        const hour = new Date().getHours();
        if (hour !== lastHour) {
          lastHour = hour;
          transport.playSound?.(SOUND.HOUR);           // top-of-hour chime
        }
        console.log(`wrote ${framePath}`);
      } finally {
        animator.resume();
      }
    });
  }

  if (once) {
    await tick(); // once mode: let errors propagate to the exit code
    return;
  }

  await runTickLoop({
    runTick: tick,
    intervalMs,
    isStopped: () => stopped,
    beforeLoop: () => animator.start(),
    setTimer: (resolve, ms) => {
      resolveLoopSleep = () => {
        timer = null;
        resolveLoopSleep = null;
        resolve();
      };
      timer = setTimeout(resolveLoopSleep, ms);
    },
  });
}

export async function runTickLoop({
  runTick,
  intervalMs,
  isStopped,
  beforeLoop = () => {},
  setTimer = (resolve, ms) => setTimeout(resolve, ms),
  onError = (error) => console.error("buddy tick failed; continuing:", error),
}) {
  const safe = async () => {
    try {
      await runTick();
    } catch (error) {
      onError(error);
    }
  };

  await safe();
  beforeLoop();
  while (!isStopped()) {
    await new Promise((resolve) => setTimer(resolve, intervalMs));
    if (!isStopped()) await safe();
  }
}

export function startDashboardServer({
  host = "127.0.0.1",
  port = 0,
  statePath = "out/state.json",
  configPath = "config.json",
  framePath = "out/frame.png",
  getRuntime = () => ({}),
  getConfig = () => loadConfig(configPath),
  setConfig = () => {},
  evolutionIntents = createEvolutionIntentQueue(),
} = {}) {
  return startWebServer({
    host,
    port,
    framePath,
    getView: () => {
      const config = getConfig();
      const runtime = getRuntime();
      const pet = dashboardPet(runtime.pet ?? loadState(statePath), runtime.usage);
      const view = toDashboardView({
        pet,
        usage: dashboardUsage(runtime.usage, pet),
        weather: runtime.weather ?? DEFAULT_WEATHER,
        sensors: dashboardSensors(runtime.room),
        journey: dashboardJourney(pet),
        secrets: dashboardSecrets(pet),
        config,
      });
      return {
        ...view,
        box: Array.isArray(config.box) && config.box.length > 0 ? config.box : [pet.species],
      };
    },
    saveSettings: (input) => {
      const result = validateSettings(input);
      if (!result.ok) throw new Error(result.error);
      const next = { ...getConfig(), ...result.value };
      setConfig(next);
      saveConfig(configPath, next);
      return result.value;
    },
    chooseEvolution: (to) => {
      const runtime = getRuntime();
      const pet = runtime.pet ?? loadState(statePath);
      const pending = Array.isArray(pet.pendingCandidates) ? pet.pendingCandidates : [];
      if (!pending.some((candidate) => candidate?.to === to)) {
        throw new Error("evolution candidate is not pending");
      }
      evolutionIntents.push({ type: "choose", to });
    },
    grantEvolutionStone: (stone) => {
      evolutionIntents.push({ type: "stone", stone });
    },
  });
}

function adaptPngTransport(transport) {
  return {
    ...transport,
    async push(frame) {
      return transport.push(frame?.pngBuffer ?? frame);
    },
  };
}

function collectStandaloneButtonSnapshot(transport) {
  const events = [];
  const off = transport?.onButton?.((event) => events.push(event));
  try {
    return events;
  } finally {
    off?.();
  }
}

export async function runOnboardingGate({
  statePath,
  today = localYmd(new Date()),
  onboarding,             // 注入：() => Promise<{species,name}>（真实由 transport io 驱动）
  personalityRng = Math.random,
}) {
  const existing = loadState(statePath);
  if (existing?.hatched) return existing;
  const { species, name } = await onboarding();
  mkdirSync(dirname(statePath), { recursive: true });
  const newborn = makeNewborn(species, name, today, personalityRng);
  saveState(statePath, newborn);
  return newborn;
}

function makeNewborn(species, name, today, personalityRng = Math.random) {
  return {
    species, name, level: 1, exp: 0, bond: 0, streak: 0, shield: 0,
    lastSettled: today, lastGrowthDay: null, todayCreditedExp: 0, todayCreditedBond: 0,
    hatched: true, ...rollPersonality(personalityRng),
  };
}

function makeOnboardingIo(transport) {
  let resolveBtn = null;
  const off = transport.onButton?.((b) => { const r = resolveBtn; resolveBtn = null; r?.(b); });
  const io = {
    push: (frame) => transport.push(frame),
    nextButton: () => new Promise((res) => { resolveBtn = res; }),
    playSound: (id) => transport.playSound?.(id),
    delay: (ms) => new Promise((res) => setTimeout(res, ms)),
  };
  return { io, off };
}

export function ensurePet(state, today, personalityRng = Math.random) {
  // No hatched flag = fresh start (or pre-hatched dirty save) → newborn from bond 0.
  // The onboarding gate (runOnboardingGate in main) handles species choice + hatch;
  // ensurePet is the no-gate fallback (tests / CPB_ONCE) and births a plain eevee.
  if (!state?.hatched) {
    return {
      species: "eevee",
      level: 1,
      exp: 0,
      bond: 0,
      streak: 0,
      shield: 0,
      lastSettled: today,
      lastGrowthDay: null,
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      hatched: true,
      ...rollPersonality(personalityRng),
    };
  }

  const pet = {
    species: "eevee",
    level: 1,
    exp: 0,
    bond: 0,
    streak: 0,
    shield: 0,
    lastSettled: today,
    lastGrowthDay: null,
    todayCreditedExp: 0,
    todayCreditedBond: 0,
    ...state,
  };
  return hasPersonality(pet) ? pet : { ...pet, ...rollPersonality(personalityRng) };
}

function hasPersonality(pet) {
  return Boolean(
    typeof pet.nature === "string" &&
      pet.nature.length > 0 &&
      Array.isArray(pet.iv) &&
      pet.iv.length === 6 &&
      pet.iv.every((value) => Number.isInteger(value) && value >= 0 && value <= 31) &&
      typeof pet.characteristic === "string" &&
      pet.characteristic.length > 0,
  );
}

async function loadWeatherSnapshot(weatherClient, config) {
  const weather = await weatherClient.get(config.lat, config.lon);
  if (weather.temp == null || weather.cond === "—") return { ...DEFAULT_WEATHER, degraded: true };
  return weather;
}

function hasKeyPress(events) {
  return events.some((event) => event?.key === "KEY" && event?.kind === "short");
}

function drainEvolutionIntents(evolutionIntents) {
  if (!evolutionIntents || typeof evolutionIntents.drain !== "function") return [];
  const drained = evolutionIntents.drain();
  return Array.isArray(drained) ? drained : [];
}

function isEvolutionStone(stone) {
  return stone === "water" || stone === "thunder" || stone === "fire";
}

function evolutionContext({ pet, weather, room, now }) {
  const hour = now.getHours();
  const daytime = hour >= 6 && hour < 18;
  const careCount = Math.max(0, Number(pet.careCount ?? 0));

  return {
    bond: pet.bond,
    level: pet.level,
    daytime,
    night: !daytime,
    care: careCount > 0,
    careCount,
    roomTemp: room?.t,
    roomHumidity: room?.h,
    weather: weather?.cond,
    temp: weather?.temp,
    humidity: weather?.humidity,
    warmHumid: isWarmHumid(weather?.temp, weather?.humidity) || isWarmHumid(room?.t, room?.h),
    cold: isCold(weather?.temp) || isCold(room?.t),
    stone: pet.stone,
  };
}

function evolvePet(pet, species) {
  const { pendingCandidates, stone, ...rest } = pet;
  return { ...rest, species, readyToEvolve: false };
}

function isWarmHumid(temp, humidity) {
  return typeof temp === "number" && typeof humidity === "number" && temp >= 20 && humidity >= 60;
}

function isCold(temp) {
  return typeof temp === "number" && temp <= 4;
}

function logFailureReasonTransition({ result, lastReason, logger, label }) {
  const reason = failureReason(result);
  if (!reason) return null;
  if (reason !== lastReason) logger?.warn?.(`${label} failed: ${reason}`);
  return reason;
}

function failureReason(result) {
  if (result?.ok !== false) return null;
  return typeof result.reason === "string" && result.reason.length > 0
    ? result.reason
    : "unknown";
}

function errorReason(error) {
  return error?.message ? error.message : "error";
}

function dashboardPet(pet, usage) {
  const normalized = {
    species: "eevee",
    level: 1,
    exp: 0,
    bond: 0,
    streak: 0,
    ...pet,
  };
  return {
    ...normalized,
    mood: normalized.mood ?? deriveMood(dashboardUsage(usage, normalized)),
    nature: normalized.nature ?? "—",
    iv: Array.isArray(normalized.iv) ? normalized.iv : [],
    characteristic: normalized.characteristic ?? "—",
    badges: Array.isArray(normalized.badges) ? normalized.badges : dashboardBadges(normalized),
  };
}

function dashboardUsage(usage, pet = {}) {
  return {
    p5h: null,
    pweek: null,
    todayCost: null,
    todayTokens: null,
    streak: pet.streak ?? 0,
    modelled: false,
    ...usage,
  };
}

export function dashboardSensors(room) {
  const r = room ?? {};
  return {
    roomT: r.roomT ?? r.t ?? null,
    roomH: r.roomH ?? r.h ?? null,
  };
}

function dashboardJourney(pet) {
  if (Array.isArray(pet.journey)) return pet.journey;
  const date = pet.lastGrowthDay ?? pet.lastSettled;
  return date ? [{ date, text: `亲密度 ${pet.bond}` }] : [];
}

function dashboardSecrets(pet) {
  const source = pet.secrets ?? {};
  const discovered = Array.isArray(source.discovered)
    ? source.discovered
    : Array.isArray(pet.discoveredSecrets)
      ? pet.discoveredSecrets
      : [];
  return {
    discovered,
    total: Number.isFinite(source.total) ? source.total : 12,
  };
}

function dashboardBadges(pet) {
  const badges = [];
  if ((pet.streak ?? 0) >= 7) badges.push("7d");
  if ((pet.bond ?? 0) >= PARAMS.evolveBond) badges.push("EVO");
  return badges;
}

function localYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const isCli = process.argv[1] && existsSync(process.argv[1])
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
