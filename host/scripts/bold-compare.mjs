// 一次性目检：把全 18 物种 plain 与 bold 并排渲染到 out/bold-compare/<species>.png
import { mkdirSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";

import { loadBuddySprite } from "../src/render/sprites.js";
import { drawSprite } from "../src/render/layout.js";

const SPECIES = [
  "eevee", "vaporeon", "jolteon", "flareon", "espeon", "umbreon",
  "leafeon", "glaceon", "sylveon", "bulbasaur", "ivysaur", "venusaur",
  "charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise",
];
const SLOT = 136;
mkdirSync("out/bold-compare", { recursive: true });
for (const species of SPECIES) {
  const s = await loadBuddySprite(species);
  const canvas = createCanvas(SLOT * 2 + 12, SLOT);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  const opts = { maxSize: SLOT, srcW: s.w, srcH: s.h };
  drawSprite(g, s.gray, { ...opts, x: 0, y: 0 });                      // 左：plain
  drawSprite(g, s.gray, { ...opts, x: SLOT + 12, y: 0, bold: true });  // 右：bold
  writeFileSync(`out/bold-compare/${species}.png`, await canvas.encode("png"));
  console.log(`wrote out/bold-compare/${species}.png`);
}
