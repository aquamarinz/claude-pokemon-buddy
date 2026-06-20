import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { startWebServer } from "../src/web/server.js";

test("GET /api/state returns view json on 127.0.0.1", async () => {
  const srv = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    getView: () => ({ buddy: { name: "阿布" } }),
  });

  try {
    assert.equal(srv.host, "127.0.0.1");
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/state`);
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.buddy.name, "阿布");
  } finally {
    await srv.close();
  }
});

test("POST /api/settings accepts whitelisted settings", async () => {
  let saved = null;
  const srv = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    getView: () => ({}),
    saveSettings: (value) => {
      saved = value;
    },
  });

  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "布布", volume: 20 }),
    });
    const j = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(saved, { name: "布布", volume: 20 });
    assert.deepEqual(j.settings, { name: "布布", volume: 20 });
  } finally {
    await srv.close();
  }
});

test("POST /api/settings rejects unknown field", async () => {
  let saved = null;
  const srv = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    getView: () => ({}),
    saveSettings: (value) => {
      saved = value;
    },
  });

  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ difficulty: "easy" }),
    });

    assert.equal(res.status, 400);
    assert.equal(saved, null);
  } finally {
    await srv.close();
  }
});

test("POST /api/settings with an empty body is rejected and does not save", async () => {
  let saved = 0;
  const srv = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    getView: () => ({}),
    saveSettings: () => {
      saved += 1;
    },
  });

  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /no settings/i);
    assert.equal(saved, 0);
  } finally {
    await srv.close();
  }
});

test("GET /frame.png mirrors configured frame file", async () => {
  const framePath = join("out", `test-web-frame-${randomUUID()}.png`);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  mkdirSync(dirname(framePath), { recursive: true });
  writeFileSync(framePath, png);
  const srv = await startWebServer({
    host: "127.0.0.1",
    port: 0,
    getView: () => ({}),
    framePath,
  });

  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/frame.png`);
    const body = Buffer.from(await res.arrayBuffer());

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(body, png);
  } finally {
    await srv.close();
    rmSync(framePath, { force: true });
  }
});
