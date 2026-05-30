import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadUsageSnapshot, normalizeUsage, usageForDisplay } from "../src/usage.js";

const blocksJson = readFileSync(
  new URL("./fixtures/ccusage-blocks.json", import.meta.url),
  "utf8",
);
const dailyJson = readFileSync(
  new URL("./fixtures/ccusage-daily.json", import.meta.url),
  "utf8",
);
const blocksFixture = JSON.parse(blocksJson);
const dailyFixture = JSON.parse(dailyJson);

test("normalizeUsage computes 5H%, WEEK%, and daily totals from real ccusage fixtures", () => {
  const active = blocksFixture.blocks.find((block) => block.isActive);
  const lastDaily = dailyFixture.daily.at(-1);
  const weekTokens = dailyFixture.daily
    .slice(-7)
    .reduce((sum, day) => sum + day.totalTokens, 0);

  const u = normalizeUsage({
    blocksJson,
    dailyJson,
    budget5h: active.totalTokens * 2,
    budgetWeek: weekTokens * 2,
  });

  assert.equal(u.modelled, true);
  assert.equal(u.p5h, 50);
  assert.equal(u.pweek, 50);
  assert.equal(u.activeTokens, active.totalTokens);
  assert.equal(u.activeCost, active.costUSD);
  assert.equal(u.resets5h, active.endTime);
  assert.equal(u.resetsWeek, "2026-06-01T00:00:00");
  assert.equal(u.todayPeriod, lastDaily.period);
  assert.equal(u.todayTokens, lastDaily.totalTokens);
  assert.equal(u.todayCost, lastDaily.totalCost);
  assert.equal(u.weekTokens, weekTokens);
  assert.deepEqual(u.perType, {});
});

test("normalizeUsage clamps percentages to 0..100", () => {
  const u = normalizeUsage({
    blocksJson,
    dailyJson,
    budget5h: 1,
    budgetWeek: 1,
  });

  assert.equal(u.p5h, 100);
  assert.equal(u.pweek, 100);
});

test("normalizeUsage fail-closed on bad JSON or schema drift", () => {
  assert.throws(() =>
    normalizeUsage({
      blocksJson: "{bad",
      dailyJson,
      budget5h: 1,
      budgetWeek: 1,
    }),
  );
  assert.throws(() =>
    normalizeUsage({
      blocksJson: JSON.stringify({ blocks: [{ isActive: true }] }),
      dailyJson,
      budget5h: 1,
      budgetWeek: 1,
    }),
  );
});

test("loadUsageSnapshot fail-closes when ccusage command fails", async () => {
  const snapshot = await loadUsageSnapshot({
    budget5h: 1,
    budgetWeek: 1,
    run: async () => {
      throw new Error("ccusage unavailable");
    },
  });

  assert.deepEqual(snapshot, { ok: false });
});

test("usageForDisplay keeps last-known usage stale instead of using fake defaults", () => {
  const lastKnown = {
    ok: true,
    modelled: true,
    p5h: 12,
    pweek: 34,
    resets5h: "2026-05-30T10:00:00Z",
    todayTokens: 1234,
    todayCost: 1.23,
    weekTokens: 5678,
    perType: {},
  };

  const { usage, lastKnown: nextLastKnown } = usageForDisplay({ ok: false }, lastKnown);

  assert.equal(nextLastKnown, lastKnown);
  assert.equal(usage.p5h, 12);
  assert.equal(usage.todayTokens, 1234);
  assert.equal(usage.stale, true);
  assert.equal(usage.degraded, true);
  assert.notEqual(usage.todayTokens, 5_300_000);
});
