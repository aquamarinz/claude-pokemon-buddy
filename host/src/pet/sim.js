export const PARAMS = {
  dailyExpCap: 100,
  expPerKTok: 2,
  levelExp: 100,
  dailyBondCap: 6,
  bondPerActiveDay: 4,
  bondSoftCap: 180,
  evolveBond: 160,
  costSpikeUSD: 30,
};

export function deriveMood({ p5h, todayCost }) {
  if (todayCost >= PARAMS.costSpikeUSD) return "shocked";
  if (p5h >= 100) return "fainted";
  if (p5h >= 80) return "strained";
  if (p5h >= 50) return "focused";
  return "happy";
}

export function applyDailyGrowth(pet, { todayTokens }) {
  const expGain = Math.min(
    PARAMS.dailyExpCap,
    Math.floor(todayTokens / 1000) * PARAMS.expPerKTok,
  );
  const totalExp = pet.exp + expGain;
  const level = pet.level + Math.floor(totalExp / PARAMS.levelExp);
  const bondGain = todayTokens > 0 ? Math.min(PARAMS.dailyBondCap, PARAMS.bondPerActiveDay) : 0;
  const bond = Math.min(PARAMS.bondSoftCap, pet.bond + bondGain);

  return {
    ...pet,
    level,
    exp: totalExp % PARAMS.levelExp,
    bond,
    expGain,
  };
}
