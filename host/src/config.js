import { readFileSync } from "node:fs";

const DEFAULTS = {
  planTokenBudget5h: 220_000,
  planTokenBudgetWeek: 2_000_000,
  lat: -36.8485,
  lon: 174.7633,
  box: ["eevee"],
  quietHours: { start: 22, end: 8 },
  volume: 70,
};

export function loadConfig(path = "config.json") {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}
