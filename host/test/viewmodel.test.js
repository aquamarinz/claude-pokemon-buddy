import { test } from "node:test";
import assert from "node:assert/strict";

import { toDashboardView } from "../src/web/viewmodel.js";
import { PARAMS } from "../src/pet/sim.js";

test("maps host state to dashboard view (read-only)", () => {
  const v = toDashboardView({
    pet: {
      species: "eevee",
      level: 7,
      exp: 40,
      bond: 142,
      mood: "focused",
      nature: "急性子",
      iv: [28, 18, 23, 30, 15, 21],
      characteristic: "爱睡午觉",
      badges: ["7d", "1e8"],
      readyToEvolve: false,
    },
    usage: {
      p5h: 72,
      pweek: 41,
      todayCost: 4.1,
      todayTokens: 5_300_000,
      streak: 6,
      modelled: true,
    },
    weather: { cond: "多云", temp: 19, feels: 17, hi: 22, lo: 14, precip: 30 },
    sensors: { roomT: 23.4, roomH: 56 },
    journey: [{ date: "2026-05-30", text: "亲密度 142" }],
    secrets: { discovered: ["shiny"], total: 12 },
    config: {
      name: "阿布",
      quietHours: { start: 22, end: 8 },
      volume: 70,
      lat: -36.8,
      lon: 174.8,
      difficulty: "normal",
    },
  });

  assert.equal(v.buddy.name, "阿布");
  assert.equal(v.buddy.level, 7);
  assert.equal(v.buddy.nextEvo.threshold, PARAMS.evolveBond);
  assert.equal(v.buddy.nextEvo.threshold, 56);
  assert.equal(v.buddy.nextEvo.bond, 142);
  assert.equal(v.usage.modelled, true);
  assert.equal(v.secrets.discoveredCount, 1);
  assert.equal(v.secrets.lockedCount, 11);
  assert.equal(v.difficulty, "NORMAL · 锁定");
});

test("forwards rateStale into the dashboard usage block", () => {
  const base = {
    pet: { species: "eevee", level: 1, exp: 0, bond: 0, mood: "happy", nature: "—", iv: [], characteristic: "—", badges: [], readyToEvolve: false },
    weather: { cond: "多云", temp: 19 },
    sensors: { roomT: null, roomH: null },
    journey: [],
    secrets: { discovered: [], total: 12 },
    config: { name: "x", quietHours: { start: 22, end: 8 }, volume: 70, lat: 0, lon: 0 },
  };

  const stale = toDashboardView({ ...base, usage: { p5h: 72, pweek: 41, rateStale: true } });
  assert.equal(stale.usage.rateStale, true);

  const fresh = toDashboardView({ ...base, usage: { p5h: 72, pweek: 41 } });
  assert.equal(fresh.usage.rateStale, false);
});

test("forwards degraded weather into the dashboard view", () => {
  const view = toDashboardView({
    pet: { species: "eevee", level: 1, exp: 0, bond: 0, mood: "happy", nature: "-", iv: [], characteristic: "-", badges: [], readyToEvolve: false },
    usage: { p5h: 72, pweek: 41 },
    weather: { cond: "cloud", temp: 19, degraded: true },
    sensors: { roomT: null, roomH: null },
    journey: [],
    secrets: { discovered: [], total: 12 },
    config: { name: "x", quietHours: { start: 22, end: 8 }, volume: 70, lat: 0, lon: 0 },
  });

  assert.equal(view.weather.degraded, true);
});

test("forwards pending evolution candidates into the dashboard next-evolution block", () => {
  const base = {
    pet: {
      species: "eevee",
      level: 1,
      exp: 0,
      bond: 160,
      mood: "focused",
      nature: "急性子",
      iv: [28, 18, 23, 30, 15, 21],
      characteristic: "爱睡午觉",
      badges: [],
      readyToEvolve: true,
      pendingCandidates: [
        { to: "espeon", needs: { bond: 56, daytime: true }, priority: 2 },
        { to: "leafeon", needs: { bond: 56, warmHumid: true }, priority: 3 },
      ],
    },
    usage: { p5h: 72, pweek: 41 },
    weather: { cond: "多云", temp: 19 },
    sensors: { roomT: null, roomH: null },
    journey: [],
    secrets: { discovered: [], total: 12 },
    config: { name: "x", quietHours: { start: 22, end: 8 }, volume: 70, lat: 0, lon: 0 },
  };

  const view = toDashboardView(base);

  assert.deepEqual(view.buddy.nextEvo.pendingCandidates, [
    { to: "espeon", priority: 2 },
    { to: "leafeon", priority: 3 },
  ]);
});
