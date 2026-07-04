import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_PATH = join(homedir(), ".claude", "cpb-usage.json");
const STALE_SEC = 15 * 60; // 没用 CC 超过 15min → stale

export function loadRateLimits({ path = USAGE_PATH, now = Date.now() } = {}) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return staleAllNull();
  }
  if (!isPlainObject(data)) return staleAllNull();
  try {
    const writtenAt = Number(data.writtenAt);
    const stale = !Number.isFinite(writtenAt) || Math.floor(now / 1000) - writtenAt > STALE_SEC;
    const p5h = numOrNull(data.fiveHourPct);
    const pweek = numOrNull(data.weeklyPct);
    return {
      p5h,
      pweek,
      resets5h: epochToIso(data.fiveHourReset),
      resetsWeek: epochToIso(data.weeklyReset),
      official: p5h != null || pweek != null,
      stale,
    };
  } catch {
    return staleAllNull();
  }
}

function staleAllNull() {
  return { p5h: null, pweek: null, resets5h: null, resetsWeek: null, official: false, stale: true };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function epochToIso(sec) {
  return Number.isFinite(sec) && Math.abs(sec) < 8.64e12 ? new Date(sec * 1000).toISOString() : null;
}
