import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, SCHEMA_VERSION } from "../src/state.js";

test("saveState/loadState roundtrip adds schemaVersion and leaves no tmp file", (t) => {
  const { dir, file } = tempState(t);

  saveState(file, { level: 3, bond: 120, lastSettled: "2026-05-28" });
  const loaded = loadState(file);

  assert.equal(loaded.schemaVersion, SCHEMA_VERSION);
  assert.equal(loaded.level, 3);
  assert.equal(loaded.bond, 120);
  assert.equal(existsSync(`${file}.tmp`), false);
  assert.equal(existsSync(dir), true);
});

test("saveState creates backup and corrupt main falls back to previous backup", (t) => {
  const { file } = tempState(t);

  saveState(file, { level: 7 });
  saveState(file, { level: 8 });
  writeFileSync(file, "{corrupt");

  assert.equal(JSON.parse(readFileSync(`${file}.bak`, "utf8")).level, 7);
  assert.equal(loadState(file).level, 7);
});

test("loadState safely rebuilds when main and backup are invalid", (t) => {
  const { file } = tempState(t);
  writeFileSync(file, JSON.stringify({ schemaVersion: 999, level: 99 }));
  writeFileSync(`${file}.bak`, "{corrupt");

  const loaded = loadState(file);

  assert.deepEqual(loaded, { schemaVersion: SCHEMA_VERSION, _rebuilt: true });
});

function tempState(t) {
  const dir = mkdtempSync(join(tmpdir(), "cpb-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, "state.json") };
}
