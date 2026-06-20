import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { startDashboardServer } from "../src/index.js";
import { loadConfig } from "../src/config.js";

test("dashboard server reflects host state and persists settings updates", async () => {
  const id = randomUUID();
  const statePath = join("out", `test-dashboard-state-${id}.json`);
  const configPath = join("out", `test-dashboard-config-${id}.json`);
  const framePath = join("out", `test-dashboard-frame-${id}.png`);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      species: "eevee",
      level: 9,
      exp: 20,
      bond: 150,
      streak: 3,
      shield: 0,
      lastSettled: "2026-05-30",
      lastGrowthDay: "2026-05-30",
      todayCreditedExp: 2,
      todayCreditedBond: 2,
      readyToEvolve: false,
    }),
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "阿布",
      quietHours: { start: 22, end: 8 },
      volume: 70,
      lat: -36.8,
      lon: 174.8,
      difficulty: "normal",
    }),
  );
  writeFileSync(framePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const srv = await startDashboardServer({
    host: "127.0.0.1",
    port: 0,
    statePath,
    configPath,
    framePath,
    getRuntime: () => ({
      usage: {
        p5h: 72,
        pweek: 41,
        todayCost: 4.1,
        todayTokens: 5_300_000,
        streak: 3,
        modelled: true,
      },
      weather: { cond: "多云", temp: 19, feels: 17, hi: 22, lo: 14, precip: 30 },
      room: { t: 23.4, h: 56 },
    }),
  });

  try {
    assert.equal(srv.host, "127.0.0.1");

    const first = await fetch(`http://127.0.0.1:${srv.port}/api/state`);
    const firstJson = await first.json();
    assert.equal(firstJson.buddy.name, "阿布");
    assert.equal(firstJson.buddy.level, 9);
    assert.equal(firstJson.usage.streak, 3);

    const post = await fetch(`http://127.0.0.1:${srv.port}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "布布", volume: 20 }),
    });
    assert.equal(post.status, 200);

    const second = await fetch(`http://127.0.0.1:${srv.port}/api/state`);
    const secondJson = await second.json();
    assert.equal(secondJson.buddy.name, "布布");
    assert.equal(secondJson.settings.volume, 20);
    assert.equal(loadConfig(configPath).name, "布布");
    assert.equal(loadConfig(configPath).difficulty, "normal");
  } finally {
    await srv.close();
    rmSync(statePath, { force: true });
    rmSync(`${statePath}.bak`, { force: true });
    rmSync(configPath, { force: true });
    rmSync(`${configPath}.bak`, { force: true });
    rmSync(framePath, { force: true });
  }
});

test("dashboard reads and writes config through main()'s in-memory closures (M5)", async () => {
  const configPath = join("out", "test-m5-config.json");
  const statePath = join("out", "test-m5-state.json");
  const framePath = join("out", "test-m5-frame.png");
  rmSync(configPath, { force: true });
  rmSync(statePath, { force: true });

  let config = { name: "old", quietHours: { start: 22, end: 8 }, volume: 50, lat: 1, lon: 2 };
  const handle = await startDashboardServer({
    port: 0,
    statePath,
    configPath,
    framePath,
    getRuntime: () => ({}),
    getConfig: () => config,
    setConfig: (next) => { config = next; },
  });

  try {
    const before = await (await fetch(`http://127.0.0.1:${handle.port}/api/state`)).json();
    assert.equal(before.settings.name, "old");

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "new" }),
    });
    assert.equal(res.status, 200);

    // the in-memory object main()'s next tick reads is updated (not just the disk file)
    assert.equal(config.name, "new");

    const after = await (await fetch(`http://127.0.0.1:${handle.port}/api/state`)).json();
    assert.equal(after.settings.name, "new");
  } finally {
    await handle.close();
  }
});
