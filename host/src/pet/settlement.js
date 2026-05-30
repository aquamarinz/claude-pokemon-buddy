const DAY_MS = 86_400_000;

export function settleDays(
  pet,
  today,
  { usedDays, maxCatchupDays = 30, bondDecayPerMissed = 3 },
) {
  if (!pet.lastSettled) return pet;

  const days = cappedDays(daysBetween(pet.lastSettled, today), maxCatchupDays);
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
