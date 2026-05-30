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
