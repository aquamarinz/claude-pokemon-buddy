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
const fixtureToday = dailyFixture.daily.at(-1).period;

test("normalizeUsage outputs cost/token and leaves percent null (rate-limits owns %)", () => {
  const lastDaily = dailyFixture.daily.at(-1);
  const weekTokens = dailyFixture.daily
    .slice(-7)
    .reduce((sum, day) => sum + day.totalTokens, 0);
  const u = normalizeUsage({ blocksJson, dailyJson, today: fixtureToday });

  assert.equal(u.p5h, null);
  assert.equal(u.pweek, null);
  assert.equal(u.resets5h, null);
  assert.equal(u.resetsWeek, null);
  assert.equal(u.todayTokens, lastDaily.totalTokens);
  assert.equal(u.todayCost, lastDaily.totalCost);
  assert.equal(u.weekTokens, weekTokens);
});

test("normalizeUsage surfaces activeDays (periods with usage)", () => {
  const expected = dailyFixture.daily
    .filter((day) => day.totalTokens > 0)
    .map((day) => day.period);
  const u = normalizeUsage({ blocksJson, dailyJson, today: fixtureToday });

  assert.deepEqual(u.activeDays, expected);
  assert.equal(u.activeDays.at(-1), dailyFixture.daily.at(-1).period);
});

test("normalizeUsage zeroes today fields when latest daily period is stale", () => {
  const u = normalizeUsage({ blocksJson, dailyJson, today: "2026-05-31" });

  assert.equal(u.todayPeriod, fixtureToday);
  assert.equal(u.todayTokens, 0);
  assert.equal(u.todayCost, 0);
  assert.ok(u.weekTokens > 0);
});

test("usageForDisplay degraded with no last-known reports activeDays null", () => {
  const { usage } = usageForDisplay({ ok: false }, null);
  assert.equal(usage.activeDays, null);
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

  assert.deepEqual(snapshot, { ok: false, reason: "ccusage unavailable" });
});

test("loadUsageSnapshot includes schema drift failure reason", async () => {
  const snapshot = await loadUsageSnapshot({
    run: async () => {
      throw new Error("schema drift");
    },
  });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.reason, "schema drift");
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
