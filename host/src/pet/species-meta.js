export const SPECIES_ZH = {
  eevee: "伊布",
  vaporeon: "水伊布",
  jolteon: "雷伊布",
  flareon: "火伊布",
  espeon: "太阳伊布",
  umbreon: "月亮伊布",
  leafeon: "叶伊布",
  glaceon: "冰伊布",
  sylveon: "仙子伊布",
  bulbasaur: "妙蛙种子",
  ivysaur: "妙蛙草",
  venusaur: "妙蛙花",
  charmander: "小火龙",
  charmeleon: "火恐龙",
  charizard: "喷火龙",
  squirtle: "杰尼龟",
  wartortle: "卡咪龟",
  blastoise: "水箭龟",
};

export function zhName(species) {
  return SPECIES_ZH[species] ?? species;
}
