import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runOneTick } from "../src/index.js";

test("one tick produces frame and advances state", async () => {
  const statePath = join("out", "test-state.json");
  const framePath = join("out", "test-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });

  const state = await runOneTick({
    usage: {
      p5h: 72,
      pweek: 41,
      todayCost: 4.1,
      todayTokens: 5_300_000,
      modelled: true,
      weekTokens: 30_000_000,
    },
    weather: {
      cond: "多云",
      temp: 19,
      feels: 17,
      hi: 22,
      lo: 14,
      precip: 30,
      wind: 11,
      humidity: 64,
    },
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
  });

  assert.equal(existsSync(framePath), true);
  assert.equal(existsSync(statePath), true);
  assert.ok(state.level >= 1);
  assert.ok(state.expGain > 0);
  assert.equal(state.lastGrowthDay, "2026-05-30");
});

test("same-day usage growth credits only new token progress", async () => {
  const statePath = join("out", "test-growth-delta-state.json");
  const framePath = join("out", "test-growth-delta-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });

  const first = await runOneTick({
    usage: usageWithTokens(1_000),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
  });
  const second = await runOneTick({
    usage: usageWithTokens(2_000),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
  });

  assert.equal(first.expGain, 2);
  assert.equal(second.expGain, 2);
  assert.equal(second.exp, 4);
  assert.equal(second.todayCreditedExp, 4);
  assert.equal(second.todayCreditedBond, 4);
});

test("fresh pet state rolls personality on first tick", async () => {
  const statePath = join("out", "test-personality-fresh-state.json");
  const framePath = join("out", "test-personality-fresh-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });

  const state = await runOneTick({
    usage: usageWithTokens(0),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
    personalityRng: sequenceRng([0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.2]),
  });

  assert.equal(typeof state.nature, "string");
  assert.notEqual(state.nature, "");
  assert.equal(state.iv.length, 6);
  assert.equal(typeof state.characteristic, "string");
  assert.notEqual(state.characteristic, "");
});

test("existing pet keeps personality across ticks", async () => {
  const statePath = join("out", "test-personality-stable-state.json");
  const framePath = join("out", "test-personality-stable-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });

  const first = await runOneTick({
    usage: usageWithTokens(0),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
    personalityRng: sequenceRng([0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.2]),
  });
  const second = await runOneTick({
    usage: usageWithTokens(1_000),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
    personalityRng: sequenceRng([0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93]),
  });

  assert.equal(typeof first.nature, "string");
  assert.equal(first.iv.length, 6);
  assert.equal(typeof first.characteristic, "string");
  assert.deepEqual(personalityOf(second), personalityOf(first));
});

test("old pet state missing personality is migrated on first tick", async () => {
  const statePath = join("out", "test-personality-migrate-state.json");
  const framePath = join("out", "test-personality-migrate-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      species: "eevee",
      level: 1,
      exp: 4,
      bond: 124,
      streak: 0,
      shield: 0,
      lastSettled: "2026-05-29",
      lastGrowthDay: "2026-05-30",
      todayCreditedExp: 4,
      todayCreditedBond: 4,
    }),
  );

  const state = await runOneTick({
    usage: usageWithTokens(0),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-30",
    personalityRng: sequenceRng([0.03, 0.13, 0.23, 0.33, 0.43, 0.53, 0.63]),
  });
  const persisted = JSON.parse(readFileSync(statePath, "utf8"));

  assert.deepEqual(personalityOf(persisted), personalityOf(state));
  assert.equal(typeof persisted.nature, "string");
  assert.equal(persisted.iv.length, 6);
  assert.equal(typeof persisted.characteristic, "string");
});

test("cross-day settlement freezes yesterday once and stays idempotent", async () => {
  const statePath = join("out", "test-cross-day-state.json");
  const framePath = join("out", "test-cross-day-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      species: "eevee",
      level: 1,
      exp: 4,
      bond: 124,
      streak: 0,
      shield: 0,
      lastSettled: "2026-05-29",
      lastGrowthDay: "2026-05-30",
      todayCreditedExp: 4,
      todayCreditedBond: 4,
    }),
  );

  const first = await runOneTick({
    usage: usageWithTokens(0),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-31",
  });
  const second = await runOneTick({
    usage: usageWithTokens(0),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    today: "2026-05-31",
  });

  assert.equal(first.lastSettled, "2026-05-30");
  assert.equal(first.streak, 1);
  assert.equal(first.todayCreditedExp, 0);
  assert.equal(first.todayCreditedBond, 0);
  assert.equal(second.lastSettled, "2026-05-30");
  assert.equal(second.streak, 1);
});

function usageWithTokens(todayTokens) {
  return {
    p5h: 12,
    pweek: 34,
    todayCost: 1,
    todayTokens,
    modelled: true,
    weekTokens: todayTokens,
  };
}

function sampleWeather() {
  return {
    cond: "多云",
    temp: 19,
    feels: 17,
    hi: 22,
    lo: 14,
    precip: 30,
    wind: 11,
    humidity: 64,
  };
}

function personalityOf(pet) {
  return {
    nature: pet.nature,
    iv: pet.iv,
    characteristic: pet.characteristic,
  };
}

function sequenceRng(values) {
  let index = 0;
  return () => values[index++];
}
