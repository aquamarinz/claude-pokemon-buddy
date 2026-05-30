const DAY_MS = 86_400_000;

export function settleDays(
  pet,
  today,
  { usedDays, maxCatchupDays = 30, bondDecayPerMissed = 3 },
) {
  if (!pet.lastSettled || pet.lastSettled >= today) return pet;

  const days = cappedDays(daysBetween(pet.lastSettled, today), maxCatchupDays);
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

  return { ...pet, bond, streak, shield, lastSettled: today };
}

function cappedDays(days, maxCatchupDays) {
  const start = Math.max(0, days.length - maxCatchupDays);
  return days.slice(start);
}

function daysBetween(from, to) {
  const days = [];
  let current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  while (current < end) {
    current = new Date(Number(current) + DAY_MS);
    days.push(toYmd(current));
  }

  return days;
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}
