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
  today = new Date().toISOString().slice(0, 10),
  mock,
} = {}) {
  if (!usage) throw new Error("usage is required");
  if (!weather) throw new Error("weather is required");

  mkdirSync(dirname(statePath), { recursive: true });
  const transport = mock ?? createMockTransport({ framePath });
  const sensor = room ?? transport.feedSensor();
  let pet = ensurePet(loadState(statePath), today);

  pet = settleDays(pet, today, {
    usedDays: new Set(usage.todayTokens > 0 ? [today] : []),
  });

  if (pet.lastGrowthDay !== today) {
    pet = {
      ...applyDailyGrowth(pet, { todayTokens: usage.todayTokens }),
      lastGrowthDay: today,
    };
  } else {
    pet = { ...pet, expGain: 0 };
  }

  const evolution = resolveEvolution(pet.species, {
    bond: pet.bond,
    daytime: true,
    warmHumid: weather.temp >= 20 && weather.humidity >= 60,
    cold: weather.temp <= 4,
  });
  if (evolution.auto) pet = { ...pet, species: evolution.auto };

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

const isCli = process.argv[1] && existsSync(process.argv[1])
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
