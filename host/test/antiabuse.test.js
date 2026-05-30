import { test } from "node:test";
import assert from "node:assert/strict";
import { clampDailyTokens } from "../src/pet/antiabuse.js";

test("truncates anomalous daily tokens vs recent median", () => {
  const recent = [1_000_000, 1_200_000, 900_000, 1_100_000];

  assert.equal(clampDailyTokens(50_000_000, recent), 3_300_000);
  assert.equal(clampDailyTokens(1_100_000, recent), 1_100_000);
});

test("leaves today unchanged when no recent history exists", () => {
  assert.equal(clampDailyTokens(50_000_000, []), 50_000_000);
});
