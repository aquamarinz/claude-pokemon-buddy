import { spawn } from "node:child_process";

export async function loadUsageSnapshot({
  run = runCcusage,
  budget5h,
  budgetWeek,
  planTokenBudget5h,
  planTokenBudgetWeek,
} = {}) {
  try {
    const blocksJson = await run("npx", ["ccusage", "blocks", "--json"]);
    const dailyJson = await run("npx", ["ccusage", "daily", "--json"]);
    return {
      ok: true,
      ...normalizeUsage({
        blocksJson,
        dailyJson,
        budget5h: budget5h ?? planTokenBudget5h,
        budgetWeek: budgetWeek ?? planTokenBudgetWeek,
      }),
    };
  } catch {
    return { ok: false };
  }
}

export function usageForDisplay(snapshot, lastKnown = null) {
  if (snapshot?.ok) {
    return { usage: snapshot, lastKnown: snapshot };
  }

  if (lastKnown) {
    return {
      usage: { ...lastKnown, ok: false, degraded: true, stale: true },
      lastKnown,
    };
  }

  return {
    usage: {
      ok: false,
      degraded: true,
      stale: false,
      modelled: false,
      p5h: null,
      pweek: null,
      resets5h: null,
      resetsWeek: null,
      activeTokens: null,
      activeCost: null,
      todayPeriod: null,
      todayTokens: null,
      todayCost: null,
      weekTokens: null,
      perType: {},
    },
    lastKnown: null,
  };
}

export function normalizeUsage({ blocksJson, dailyJson, budget5h, budgetWeek }) {
  const blocksRoot = JSON.parse(blocksJson);
  const dailyRoot = JSON.parse(dailyJson);
  const blocks = arrayField(blocksRoot.blocks, "ccusage blocks schema drift");
  const daily = arrayField(dailyRoot.daily, "ccusage daily schema drift");
  const active = blocks.find((block) => block?.isActive === true);
  if (!active) throw new Error("ccusage active block missing");
  if (daily.length === 0) throw new Error("ccusage daily history missing");

  const activeTokens = numberField(active.totalTokens, "block.totalTokens");
  const activeCost = numberField(active.costUSD, "block.costUSD");
  const weekTokens = daily
    .slice(-7)
    .reduce((sum, day) => sum + numberField(day.totalTokens, "daily.totalTokens"), 0);
  const today = daily.at(-1);

  return {
    modelled: true,
    p5h: percent(activeTokens, budget5h),
    pweek: percent(weekTokens, budgetWeek),
    resets5h: stringField(active.endTime, "block.endTime"),
    activeTokens,
    activeCost,
    todayPeriod: stringField(today.period, "daily.period"),
    todayTokens: numberField(today.totalTokens, "daily.totalTokens"),
    todayCost: numberField(today.totalCost, "daily.totalCost"),
    weekTokens,
    perType: {},
  };
}

function runCcusage(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`ccusage exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function arrayField(value, message) {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function numberField(value, label) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`expected number: ${label}`);
}

function stringField(value, label) {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`expected string: ${label}`);
}

function percent(tokens, budget) {
  const denom = numberField(budget, "budget");
  if (denom <= 0) throw new Error("budget must be positive");
  return clampPct((tokens / denom) * 100);
}

function clampPct(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
