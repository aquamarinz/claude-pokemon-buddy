import { spawn } from "node:child_process";

export async function loadUsageSnapshot({ run = runCcusage, today = localYmd(new Date()) } = {}) {
  try {
    // --yes skips npx's first-run "Ok to proceed?" prompt. With stdin ignored
    // that prompt hangs forever and wedges the whole tick loop.
    const blocksJson = await run("npx", ["--yes", "ccusage", "blocks", "--json"]);
    const dailyJson = await run("npx", ["--yes", "ccusage", "daily", "--json"]);
    return {
      ok: true,
      ...normalizeUsage({ blocksJson, dailyJson, today }),
    };
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
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
      activeDays: null,
      todayTokens: null,
      todayCost: null,
      weekTokens: null,
      perType: {},
    },
    lastKnown: null,
  };
}

export function normalizeUsage({ blocksJson, dailyJson, today = localYmd(new Date()) }) {
  const blocksRoot = JSON.parse(blocksJson);
  const dailyRoot = JSON.parse(dailyJson);
  const blocks = arrayField(blocksRoot.blocks, "ccusage blocks schema drift");
  const daily = arrayField(dailyRoot.daily, "ccusage daily schema drift");
  const active = blocks.find((block) => block?.isActive === true);
  if (!active) throw new Error("ccusage active block missing");
  if (daily.length === 0) throw new Error("ccusage daily history missing");

  const activeTokens = numberField(active.totalTokens, "block.totalTokens");
  const weekTokens = daily
    .slice(-7)
    .reduce((sum, day) => sum + numberField(day.totalTokens, "daily.totalTokens"), 0);
  const latest = daily.at(-1);
  const todayPeriod = stringField(latest.period, "daily.period");
  const latestTokens = numberField(latest.totalTokens, "daily.totalTokens");
  const latestCost = numberField(latest.totalCost, "daily.totalCost");
  const latestIsToday = todayPeriod === today;

  const activeDays = daily
    .filter((day) => numberField(day.totalTokens, "daily.totalTokens") > 0)
    .map((day) => stringField(day.period, "daily.period"));

  // Percentages/resets are owned by the official statusline rate-limits feed
  // (see rate-limits.js); ccusage here only sources cost/token totals.
  return {
    modelled: false,
    p5h: null,
    pweek: null,
    resets5h: null,
    resetsWeek: null,
    activeTokens,
    todayPeriod,
    activeDays,
    todayTokens: latestIsToday ? latestTokens : 0,
    todayCost: latestIsToday ? latestCost : 0,
    weekTokens,
    perType: {},
  };
}

function runCcusage(command, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    // Hard ceiling so a hung child (network stall, npx download wedge) can never
    // block the tick loop forever — fail-closed to degraded usage instead.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ccusage timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
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

function errorReason(error) {
  return error?.message ? error.message : "error";
}

function localYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
