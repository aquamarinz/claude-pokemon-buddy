import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE = fileURLToPath(new URL("../src/usage-bridge.mjs", import.meta.url));

function run(stdinObj) {
  const out = mkdtempSync(join(tmpdir(), "cpb-bridge-"));
  const path = join(out, "cpb-usage.json");
  const res = spawnSync("node", [BRIDGE], {
    input: JSON.stringify(stdinObj),
    env: { ...process.env, CPB_USAGE_PATH: path },
    encoding: "utf8",
  });
  return { res, path };
}

test("extracts rate_limits and writes usage.json + prints statusline", () => {
  const { res, path } = run({
    rate_limits: {
      five_hour: { used_percentage: 9, resets_at: 1_750_003_600 },
      seven_day: { used_percentage: 52, resets_at: 1_750_086_400 },
    },
  });
  assert.equal(res.status, 0);
  const j = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(j.fiveHourPct, 9);
  assert.equal(j.weeklyPct, 52);
  assert.equal(j.fiveHourReset, 1_750_003_600);
  assert.equal(typeof j.writtenAt, "number");
  assert.match(res.stdout, /9%/); // statusline 一行含 5h%
});

test("missing rate_limits → no write, still exit 0 (never crash CC)", () => {
  const { res, path } = run({ model: { display_name: "Sonnet" } });
  assert.equal(res.status, 0);
  assert.equal(existsSync(path), false);
  assert.match(res.stdout, /5h --/);
  assert.match(res.stdout, /wk --/);
});

test("malformed stdin → exit 0, no write", () => {
  const out = mkdtempSync(join(tmpdir(), "cpb-bridge-"));
  const path = join(out, "cpb-usage.json");
  const res = spawnSync("node", [BRIDGE], { input: "not json{", env: { ...process.env, CPB_USAGE_PATH: path }, encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.equal(existsSync(path), false);
  assert.match(res.stdout, /5h --/);
  assert.match(res.stdout, /wk --/);
});

test("missing rate_limits preserves existing good usage file byte-for-byte", () => {
  const out = mkdtempSync(join(tmpdir(), "cpb-bridge-"));
  const path = join(out, "cpb-usage.json");
  const existing = '{"fiveHourPct":17,"weeklyPct":63,"writtenAt":1750000000}';
  writeFileSync(path, existing);

  const res = spawnSync("node", [BRIDGE], {
    input: JSON.stringify({ model: { display_name: "Sonnet" } }),
    env: { ...process.env, CPB_USAGE_PATH: path },
    encoding: "utf8",
  });

  assert.equal(res.status, 0);
  assert.equal(readFileSync(path, "utf8"), existing);
  assert.match(res.stdout, /5h --/);
  assert.match(res.stdout, /wk --/);
});
