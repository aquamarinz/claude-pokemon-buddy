import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

import { BUDDY_SPRITE_SLOT, drawSprite } from "../src/render/layout.js";
import { INK, LIGHT, PAPER } from "../src/render/palette.js";
import { loadSpriteGray } from "../src/render/sprites.js";

const CANDIDATES = [
  "eevee-gen1-yellow.png",
  "eevee-gen2-gold.png",
  "eevee-gen2-silver.png",
  "eevee-gen2-crystal.png",
];
const MODES = ["threshold", "dither"];
const PANEL_W = 184;
const PANEL_H = 300;
const OUT_DIR = new URL("../out/sprite-preview/", import.meta.url);

rmSync(fileURLToPath(OUT_DIR), { recursive: true, force: true });
mkdirSync(fileURLToPath(OUT_DIR), { recursive: true });

for (const file of CANDIDATES) {
  const sprite = await loadSpriteGray(fileURLToPath(new URL(`../seed/sprites/_candidates/${file}`, import.meta.url)), {
    size: null,
  });

  for (const mode of MODES) {
    const canvas = createCanvas(PANEL_W, PANEL_H);
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.fillStyle = PAPER;
    g.fillRect(0, 0, PANEL_W, PANEL_H);
    g.fillStyle = LIGHT;
    g.beginPath();
    g.ellipse(PANEL_W / 2, 190, 57, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    drawSprite(g, sprite.gray, {
      x: Math.floor((PANEL_W - BUDDY_SPRITE_SLOT) / 2),
      y: 60,
      maxSize: BUDDY_SPRITE_SLOT,
      srcW: sprite.w,
      srcH: sprite.h,
      mode,
    });

    const name = file.replace(/^eevee-/, "").replace(/\.png$/, "");
    writeFileSync(new URL(`${name}-${mode}.png`, OUT_DIR), await canvas.encode("png"));
  }
}
