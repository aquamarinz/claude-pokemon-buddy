import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { applyDailyGrowth, deriveMood, PARAMS } from "./pet/sim.js";
import { settleDays } from "./pet/settlement.js";
import { resolveEvolution } from "./pet/evolution.js";
import { renderFrame } from "./render/frame.js";
import { loadBuddySprite } from "./render/sprites.js";
import { loadState, saveState } from "./state.js";
import { createMockTransport } from "./transport/mock.js";
import { loadUsageSnapshot, usageForDisplay } from "./usage.js";
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

export async function runOneTick({
  usage,
  weather,
  room,
  statePath = "out/state.json",
  framePath = "out/frame.png",
  now = new Date(),
  today = localYmd(now),
  mock,
} = {}) {
  if (!usage) throw new Error("usage is required");
  if (!weather) throw new Error("weather is required");

  mkdirSync(dirname(statePath), { recursive: true });
  const transport = mock ?? createMockTransport({ framePath });
  const buttonEvents = [];
  const offButtons = transport.onButton?.((event) => buttonEvents.push(event));
  const sensor = room ?? transport.feedSensor();
  let pet = ensurePet(loadState(statePath), today);
  const closedUsageDays = new Set();
  if (
    pet.lastGrowthDay &&
    pet.lastGrowthDay < today &&
    ((pet.todayCreditedExp ?? 0) > 0 || (pet.todayCreditedBond ?? 0) > 0)
  ) {
    closedUsageDays.add(pet.lastGrowthDay);
  }

  pet = settleDays(pet, today, {
    usedDays: closedUsageDays,
  });

  pet = applyDailyGrowth(pet, { todayTokens: usage.todayTokens, today });

  if (pet.bond >= PARAMS.evolveBond || pet.stone) {
    pet = { ...pet, readyToEvolve: true };
  }

  if (pet.readyToEvolve && hasKeyPress(buttonEvents)) {
    const evolution = resolveEvolution(pet.species, evolutionContext({ pet, weather, room: sensor, now }));
    if (evolution.auto) {
      pet = evolvePet(pet, evolution.auto);
    } else if (evolution.candidates.length > 0) {
      pet = { ...pet, pendingCandidates: evolution.candidates };
    }
  }

  const mood = deriveMood(usage);
  const sprite = await loadBuddySprite(pet.species);
  const { pngBuffer } = await renderFrame({
    ...usage,
    weather,
    room: sensor,
    out: {
      t: weather.temp ?? 0,
      h: weather.humidity ?? 64,
    },
    buddy: {
      spriteGray: sprite.gray,
      mood,
      level: pet.level,
      bond: bondHearts(pet.bond),
      expPct: Math.round((pet.exp / PARAMS.levelExp) * 100),
      bubble: sprite.placeholder ? "BUDDY" : "Pika!",
    },
  });

  saveState(statePath, pet);
  offButtons?.();
  await transport.push(pngBuffer);

  return pet;
}

export async function main({
  once = process.env.CPB_ONCE === "1",
  intervalMs = Number(process.env.CPB_INTERVAL_MS ?? 60_000),
  statePath = "out/state.json",
  framePath = "out/frame.png",
  usageRun,
} = {}) {
  const config = loadConfig();
  const transport = createMockTransport({ framePath });
  const weatherClient = makeWeather();
  let lastKnownUsage = null;
  let stopped = false;
  let timer = null;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  async function tick() {
    const snapshot = await loadUsageSnapshot({ ...config, run: usageRun });
    const selected = usageForDisplay(snapshot, lastKnownUsage);
    lastKnownUsage = selected.lastKnown;
    const usage = selected.usage;
    const weather = await loadWeatherSnapshot(weatherClient, config);
    const room = transport.feedSensor();
    await runOneTick({ usage, weather, room, statePath, framePath, mock: transport });
    console.log(`wrote ${framePath}`);
  }

  await tick();
  if (once) return;

  while (!stopped) {
    await new Promise((resolve) => {
      timer = setTimeout(resolve, intervalMs);
    });
    if (!stopped) await tick();
  }
}

function ensurePet(state, today) {
  if (state?.level) {
    return {
      species: "eevee",
      exp: 0,
      bond: 120,
      streak: 0,
      shield: 0,
      lastSettled: today,
      lastGrowthDay: null,
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      ...state,
    };
  }

  return {
    ...state,
    species: "eevee",
    level: 1,
    exp: 0,
    bond: 120,
    streak: 0,
    shield: 0,
    lastSettled: today,
    lastGrowthDay: null,
    todayCreditedExp: 0,
    todayCreditedBond: 0,
  };
}

async function loadWeatherSnapshot(weatherClient, config) {
  const weather = await weatherClient.get(config.lat, config.lon);
  if (weather.temp == null || weather.cond === "—") return { ...DEFAULT_WEATHER, degraded: true };
  return weather;
}

function bondHearts(bond) {
  return Math.max(0, Math.min(5, Math.round(Number(bond ?? 0) / 40)));
}

function hasKeyPress(events) {
  return events.some((event) => event?.key === "KEY");
}

function evolutionContext({ pet, weather, room, now }) {
  const hour = now.getHours();
  const daytime = hour >= 6 && hour < 18;
  const careCount = Math.max(0, Number(pet.careCount ?? 0));

  return {
    bond: pet.bond,
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
