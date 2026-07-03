export const PARAMS = {
  dailyExpCap: 100,
  expPerKTok: 2,
  levelExp: 100,
  bondPerActiveDay: 4,
  bondSoftCap: 180,
  evolveBond: 56,
  costSpikeUSD: 30,
};

export function deriveMood({ p5h, todayCost } = {}) {
  if (Number.isFinite(todayCost) && todayCost >= PARAMS.costSpikeUSD) return "shocked";
  if (!Number.isFinite(p5h)) return "focused"; // unknown utilization -> neutral, never falsely happy
  if (p5h >= 100) return "fainted";
  if (p5h >= 80) return "strained";
  if (p5h >= 50) return "focused";
  return "happy";
}

export function applyDailyGrowth(pet, { todayTokens, today } = {}) {
  if (typeof today !== "string" || today.length === 0) {
    throw new Error("today is required");
  }
  const credited = dailyGrowthCredit(todayTokens);
  const dateRegressed = typeof pet.lastGrowthDay === "string" && pet.lastGrowthDay > today;
  const sameDay = pet.lastGrowthDay === today || dateRegressed;
  // Newborn (or never-credited) on a known day: anchor today's already-spent usage as the
  // baseline so the pet earns EXP only from tokens spent AFTER it was created. Without this,
  // a pet born mid-day retroactively claims the whole day's exp (= one full level, since
  // dailyExpCap === levelExp) and jumps straight to Lv.2.
  const firstEver = pet.lastGrowthDay == null;
  const creditedExp = sameDay ? Number(pet.todayCreditedExp ?? 0) : (firstEver ? credited.exp : 0);
  const creditedBond = sameDay ? Number(pet.todayCreditedBond ?? 0) : 0;
  const expGain = Math.max(0, credited.exp - creditedExp);
  const bondGain = Math.max(0, credited.bond - creditedBond);
  const totalExp = pet.exp + expGain;
  const level = pet.level + Math.floor(totalExp / PARAMS.levelExp);
  const bond = Math.min(PARAMS.bondSoftCap, pet.bond + bondGain);

  return {
    ...pet,
    level,
    exp: totalExp % PARAMS.levelExp,
    bond,
    expGain,
    todayCreditedExp: Math.max(creditedExp, credited.exp),
    todayCreditedBond: Math.max(creditedBond, credited.bond),
    lastGrowthDay: dateRegressed ? pet.lastGrowthDay : today,
  };
}

function dailyGrowthCredit(todayTokens) {
  const tokens = Math.max(0, Number(todayTokens ?? 0));
  return {
    exp: Math.min(
      PARAMS.dailyExpCap,
      Math.floor(tokens / 1000) * PARAMS.expPerKTok,
    ),
    bond: tokens > 0 ? PARAMS.bondPerActiveDay : 0,
  };
}
