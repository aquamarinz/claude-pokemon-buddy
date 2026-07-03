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

import { loadConfig, saveConfig } from "../src/config.js";

test("loadConfig fills defaults when file missing", () => {
  const c = loadConfig("/nonexistent.json");

  assert.equal(c.planTokenBudget5h > 0, true);
  assert.equal(typeof c.lat, "number");
  assert.ok(Array.isArray(c.box) && c.box.includes("eevee"));
  assert.deepEqual(c.quietHours, { start: 22, end: 8 });
});

test("loadConfig falls back to a parseable backup when primary is corrupt", (t) => {
  const { file } = tempConfig(t);
  const warnings = [];
  writeFileSync(file, "{corrupt");
  writeFileSync(`${file}.bak`, JSON.stringify({ name: "备份", volume: 30 }));

  const config = loadConfig(file, {
    logger: {
      warn(message, meta) {
        warnings.push({ message, meta });
      },
    },
  });

  assert.equal(config.name, "备份");
  assert.equal(config.volume, 30);
  assert.equal(config.planTokenBudget5h > 0, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /backup/i);
});

test("loadConfig snapshots corrupt primary and returns defaults when primary and backup are corrupt", (t) => {
  const { file } = tempConfig(t);
  const warnings = [];
  writeFileSync(file, "{corrupt-primary");
  writeFileSync(`${file}.bak`, "{corrupt-backup");

  const config = loadConfig(file, {
    logger: {
      warn(message, meta) {
        warnings.push({ message, meta });
      },
    },
  });

  assert.equal(config.name, "阿布");
  assert.equal(config.volume, 70);
  assert.equal(existsSync(`${file}.corrupt`), true);
  assert.equal(readFileSync(`${file}.corrupt`, "utf8"), "{corrupt-primary");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /invalid/i);
});

test("saveConfig does not refresh backup from a corrupt primary", (t) => {
  const { file } = tempConfig(t);
  writeFileSync(file, "{corrupt-primary");
  writeFileSync(`${file}.bak`, JSON.stringify({ name: "good backup", volume: 15 }));

  saveConfig(file, { name: "new primary", volume: 40 });

  assert.equal(JSON.parse(readFileSync(file, "utf8")).name, "new primary");
  assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, "utf8")), {
    name: "good backup",
    volume: 15,
  });
});

function tempConfig(t) {
  const dir = mkdtempSync(join(tmpdir(), "cpb-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, "config.json") };
}
