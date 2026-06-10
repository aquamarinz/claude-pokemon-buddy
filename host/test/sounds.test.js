import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runOneTick } from "../src/index.js";
import { SOUND } from "../src/transport/proto.js";

const USAGE = {
  p5h: 50, pweek: 30, todayCost: 1, todayTokens: 1_000_000,
  modelled: true, weekTokens: 5_000_000,
};
const WEATHER = {
  cond: "晴", temp: 18, feels: 16, hi: 20, lo: 12, precip: 0, wind: 5, humidity: 50,
};
const PERSONALITY = { nature: "Hardy", iv: [15, 15, 15, 15, 15, 15], characteristic: "Likes to run" };

// Spy transport: records playSound ids and replays button events to onButton.
function spyTransport(buttons = []) {
  const sounds = [];
  return {
    sounds,
    push: async () => ({ ok: true }),
    onButton: (cb) => { buttons.forEach(cb); return () => {}; },
    onSensor: () => () => {},
    feedSensor: () => null,
    playSound: (id) => sounds.push(id),
  };
}

function seedState(path, extra) {
  mkdirSync("out", { recursive: true });
  rmSync(path, { force: true });
  rmSync(`${path}.bak`, { force: true });
  writeFileSync(path, JSON.stringify({
    schemaVersion: 1,
    hatched: true,
    species: "eevee", level: 5, exp: 0, bond: 50, streak: 0, ...PERSONALITY, ...extra,
  }));
}

test("evolution plays the EVOLVE sound", async () => {
  const statePath = join("out", "test-sound-evolve-state.json");
  const framePath = join("out", "test-sound-evolve-frame.png");
  // thunder stone => auto-evolve to jolteon once KEY is pressed
  seedState(statePath, { stone: "thunder" });
  const transport = spyTransport([{ key: "KEY", kind: "short" }]);

  const pet = await runOneTick({
    usage: USAGE, weather: WEATHER, statePath, framePath, transport, today: "2026-06-09",
  });

  assert.equal(pet.species, "jolteon", "thunder stone evolves eevee -> jolteon");
  assert.ok(transport.sounds.includes(SOUND.EVOLVE), "should play EVOLVE on evolution");
});

test("no evolution => no EVOLVE sound", async () => {
  const statePath = join("out", "test-sound-noevolve-state.json");
  const framePath = join("out", "test-sound-noevolve-frame.png");
  // no stone, bond below threshold, and no KEY press
  seedState(statePath, {});
  const transport = spyTransport([]);

  await runOneTick({
    usage: USAGE, weather: WEATHER, statePath, framePath, transport, today: "2026-06-09",
  });

  assert.equal(transport.sounds.length, 0, "no sound when nothing evolves");
});
