const NATURES = ["急性子", "慢性子", "实干", "话痨", "佛系1", "佛系2"];
const STAT_KEYS = ["HP", "ATK", "DEF", "SPD", "SPA", "SPD2"];
const CHARACTERISTICS = {
  HP: "爱睡午觉",
  ATK: "爱逞强",
  DEF: "耐打",
  SPD: "坐不住",
  SPA: "好奇心强",
  SPD2: "倔强",
};

export function rollPersonality(rng = Math.random) {
  const iv = Array.from({ length: 6 }, () => Math.floor(rng() * 32));
  const maxIdx = iv.indexOf(Math.max(...iv));

  return {
    iv,
    nature: NATURES[Math.floor(rng() * NATURES.length)],
    characteristic: CHARACTERISTICS[STAT_KEYS[maxIdx]],
  };
}
