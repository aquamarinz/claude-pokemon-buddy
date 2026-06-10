// Idle bubble cries, kept species-themed and 2-4 chars wide for the narrow bubble.
// Eevee's Japanese cry is ブイ, commonly romanized as "Bui".
export const CRIES = {
  eevee: "Bui!",
  vaporeon: "咻~",
  jolteon: "滋滋!",
  flareon: "呼!",
  espeon: "喵~",
  umbreon: "呜…",
  leafeon: "沙沙",
  glaceon: "凛!",
  sylveon: "铃~",
  bulbasaur: "种子!",
  ivysaur: "蛙草!",
  venusaur: "蛙花!",
  charmander: "嘎喔!",
  charmeleon: "嘎欧!",
  charizard: "吼!!",
  squirtle: "杰尼!",
  wartortle: "咪龟!",
  blastoise: "轰!",
};

// Eevee's cry doubles as the layout fallback; keep the named export pointing at the map.
export const EEVEE_IDLE_CRY = CRIES.eevee;

export function cryFor(species) {
  return CRIES[species] ?? "♪";
}
