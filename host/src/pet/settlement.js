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

  for (const day of days) {
    if (usedDays.has(day)) {
      streak += 1;
    } else if (shield > 0) {
      shield -= 1;
    } else {
      streak = 0;
      bond = Math.max(0, bond - bondDecayPerMissed);
    }
  }

  return { ...pet, bond, streak, shield, lastSettled: days.at(-1) };
}

export function settlementWindow(lastSettled, today, maxCatchupDays = 30) {
  if (!lastSettled) return [];
  return cappedDays(daysBetween(lastSettled, today), maxCatchupDays);
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

function cappedDays(days, maxCatchupDays) {
  const start = Math.max(0, days.length - maxCatchupDays);
  return days.slice(start);
}

function daysBetween(from, to) {
  const days = [];
  let current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (true) {
    current = new Date(Number(current) + DAY_MS);
    if (current >= end) break;
    days.push(toYmd(current));
  }

  return days;
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}
