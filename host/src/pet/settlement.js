const DAY_MS = 86_400_000;

export function settleDays(
  pet,
  today,
  { usedDays, maxCatchupDays = 30, bondDecayPerMissed = 3 },
) {
  if (!pet.lastSettled) return pet;

  const days = settlementWindow(pet.lastSettled, today, maxCatchupDays);
  if (days.length === 0) return pet;

  let bond = pet.bond;
  let streak = pet.streak;
  let shield = pet.shield;
  let careCount = Math.max(0, Number(pet.careCount ?? 0));

  for (const day of days) {
    careCount = Math.max(0, careCount - 1);
    if (usedDays.has(day)) {
      streak += 1;
      if (streak % 7 === 0) shield = Math.min(2, shield + 1);
    } else if (shield > 0) {
      shield -= 1;
    } else {
      streak = 0;
      bond = Math.max(0, bond - bondDecayPerMissed);
    }
  }

  return { ...pet, bond, streak, shield, careCount, lastSettled: days.at(-1) };
}

export function settlementWindow(lastSettled, today, maxCatchupDays = 30) {
  if (!lastSettled) return [];
  return daysBetween(lastSettled, today, maxCatchupDays);
}

export function activeDaysFromUsage(usage) {
  if (!usage || usage.ok === false) return null;
  // Empty array == "no history we can trust" -> null -> fail-open (never punish
  // for data we cannot see). Non-array (missing field) is treated the same.
  if (!Array.isArray(usage.activeDays) || usage.activeDays.length === 0) return null;
  return new Set(usage.activeDays);
}

export function buildUsedDays(pet, today, usage, { maxCatchupDays = 30 } = {}) {
  const window = settlementWindow(pet.lastSettled, today, maxCatchupDays);
  const used = new Set();
  if (window.length === 0) return used;

  const active = activeDaysFromUsage(usage);
  if (!active) {
    // History unavailable -> cannot prove inactivity -> fail-open (no decay).
    for (const day of window) used.add(day);
    return used;
  }

  // Earliest day ccusage knows about; days before it are unknown -> fail-open.
  let knownFrom = null;
  for (const day of active) {
    if (knownFrom === null || day < knownFrom) knownFrom = day;
  }

  for (const day of window) {
    if (active.has(day) || (knownFrom !== null && day < knownFrom)) used.add(day);
  }

  // The in-progress last growth day, if it already earned, counts as used.
  if (
    pet.lastGrowthDay &&
    pet.lastGrowthDay < today &&
    ((pet.todayCreditedExp ?? 0) > 0 || (pet.todayCreditedBond ?? 0) > 0)
  ) {
    used.add(pet.lastGrowthDay);
  }

  return used;
}

function daysBetween(from, to, maxCatchupDays) {
  const days = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const deltaDays = Math.floor((Number(end) - Number(start)) / DAY_MS);
  if (!Number.isFinite(deltaDays) || deltaDays <= 1) return days;

  const count = Math.min(deltaDays - 1, Math.max(0, Math.floor(maxCatchupDays)));
  const firstOffset = deltaDays - count;
  for (let offset = firstOffset; offset < deltaDays; offset += 1) {
    const current = new Date(Number(start) + offset * DAY_MS);
    days.push(toYmd(current));
  }

  return days;
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}
