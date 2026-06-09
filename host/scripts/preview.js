// Design preview: render one representative frame to out/preview.png through
// the real pipeline (renderFrame -> layout -> 1bpp), WITHOUT touching the
// device. Lets us review layout changes on the Mac before pushing to hardware.
//
//   cd host && node scripts/preview.js   ->   out/preview.png

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";

const sprite = await loadBuddySprite("eevee");
const now = new Date();
const in5h = new Date(now.getTime() + (4 * 60 + 44) * 60_000);
const week = new Date(now.getTime() + 6 * 24 * 3600_000);
week.setHours(0, 0, 0, 0);

const { pngBuffer } = await renderFrame({
  p5h: 100,
  pweek: 100,
  resets5h: in5h.toISOString(),
  resetsWeek: week.toISOString(),
  todayCost: 83.65,
  todayTokens: 68_300_000,
  streak: 0,
  now,
  weather: { cond: "晴", temp: 16, feels: 12, hi: 16, lo: 10, precip: 0, wind: 25, humidity: 59 },
  room: null,
  out: { t: 16, h: 59 },
  buddy: {
    spriteGray: sprite.gray,
    spriteW: sprite.w,
    spriteH: sprite.h,
    mood: "shocked",
    level: 7,
    bond: 3,
    expPct: 35,
    bubble: "Bui!",
  },
});

const outDir = fileURLToPath(new URL("../out", import.meta.url));
const outPath = fileURLToPath(new URL("../out/preview.png", import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, pngBuffer);
console.log(`wrote ${outPath}`);
