export function clampDailyTokens(today, recent, factor = 3) {
  if (recent.length === 0) return today;

  const sorted = [...recent].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.min(today, median * factor);
}
