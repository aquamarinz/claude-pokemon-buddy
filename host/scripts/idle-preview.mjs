// 验证用（不入库）：每物种 buddy 区域 4 相位并排，看呼吸 bob + accent。
import { mkdirSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";

const LEFT_W = 216, W = 400, H = 300, BW = W - LEFT_W;
const SPECIES = ["eevee", "charmander", "jolteon", "vaporeon"];
mkdirSync("out/idle-preview", { recursive: true });

for (const sp of SPECIES) {
  const s = await loadBuddySprite(sp);
  const gap = 10;
  const strip = createCanvas(BW * 4 + gap * 3, H);
  const sg = strip.getContext("2d");
  sg.fillStyle = "#fff";
  sg.fillRect(0, 0, strip.width, H);
  for (let phase = 0; phase < 4; phase += 1) {
    const model = {
      p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000,
      now: new Date("2026-06-17T08:00:00"),
      weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
      buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
               species: sp, bond: 40, expPct: 50, bubble: "", animPhase: phase },
    };
    const { pngBuffer } = await renderFrame(model);
    const img = await loadImage(pngBuffer);
    sg.drawImage(img, LEFT_W, 0, BW, H, phase * (BW + gap), 0, BW, H);
  }
  writeFileSync(`out/idle-preview/${sp}.png`, await strip.encode("png"));
  console.log(`wrote out/idle-preview/${sp}.png`);
}
