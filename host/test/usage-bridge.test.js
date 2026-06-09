import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
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

test("missing rate_limits → nulls, still exit 0 (never crash CC)", () => {
  const { res, path } = run({ model: { display_name: "Sonnet" } });
  assert.equal(res.status, 0);
  const j = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(j.fiveHourPct, null);
  assert.equal(j.weeklyPct, null);
});

test("malformed stdin → exit 0, nulls", () => {
  const out = mkdtempSync(join(tmpdir(), "cpb-bridge-"));
  const path = join(out, "cpb-usage.json");
  const res = spawnSync("node", [BRIDGE], { input: "not json{", env: { ...process.env, CPB_USAGE_PATH: path }, encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).fiveHourPct, null);
});
