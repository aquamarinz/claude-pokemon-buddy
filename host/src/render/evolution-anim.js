import { createCanvas } from "@napi-rs/canvas";

import { zhName } from "../pet/species-meta.js";
import { SOUND } from "../transport/proto.js";
import { imageDataToFrame } from "./frame.js";
import { drawSprite } from "./layout.js";
import { H, INK, PAPER, W } from "./palette.js";
import { loadBuddySprite } from "./sprites.js";

const MONO = '"Zpix"';
const ALT_GAPS = [420, 360, 300, 250, 210, 170, 140, 110];

export async function playEvolutionAnimation({ transport, fromSpecies, toSpecies, delay = realDelay }) {
  const seq = [
    { kind: "black", gap: 180 },
    { kind: "black", gap: 120 },
    ...ALT_GAPS.map((gap, i) => ({
      kind: "sprite",
      species: i % 2 === 0 ? fromSpecies : toSpecies,
      gap,
    })),
    { kind: "black", gap: 120 },
    { kind: "black", gap: 120 },
    { kind: "reveal", species: toSpecies, gap: 1000 },
  ];

  for (let i = 0; i < seq.length; i += 1) {
    const step = seq[i];
    const frame = await renderEvolutionFrame(step.kind, {
      species: step.species,
      fromSpecies,
      toSpecies,
    });
    await transport.push(frame);
    if (i === 0) transport.playSound?.(SOUND.EVOLVE);
    await delay(step.gap);
  }
}

export async function renderEvolutionFrame(kind, { species, fromSpecies, toSpecies } = {}) {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);

  if (kind === "black") {
    g.fillStyle = INK;
    g.fillRect(0, 0, W, H);
    return imageDataToFrame(g.getImageData(0, 0, W, H));
  }

  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 2;
  g.strokeRect(6, 6, W - 12, H - 12);

  const target = species ?? toSpecies ?? fromSpecies ?? "eevee";
  if (kind === "reveal") {
    rays(g, W / 2, 116, 76, 106, 12);
    await drawCenteredSprite(g, target, 44, 156);
    px(g, `★ ${zhName(fromSpecies)} 进化成了 ${zhName(toSpecies)}！ ★`, W / 2, 240, 12, "center", 800); // ★+12px (✦缺字形/18非整数倍→糊; 12px 长物种名也不溢出)
  } else {
    px(g, "进化中…", W / 2, 44, 24, "center", 800);
    await drawCenteredSprite(g, target, 68, 156);
  }

  return imageDataToFrame(g.getImageData(0, 0, W, H));
}

async function drawCenteredSprite(g, species, y, maxSize) {
  const sprite = await loadBuddySprite(species);
  drawSprite(g, sprite.gray, {
    x: W / 2 - maxSize / 2,
    y,
    maxSize,
    srcW: sprite.w,
    srcH: sprite.h,
    scale: 3,
  });
}

function rays(g, cx, cy, inner, outer, count) {
  g.save();
  g.lineWidth = 2;
  for (let i = 0; i < count; i += 1) {
    const a = (Math.PI * 2 * i) / count;
    line(
      g,
      cx + Math.cos(a) * inner,
      cy + Math.sin(a) * inner,
      cx + Math.cos(a) * outer,
      cy + Math.sin(a) * outer,
    );
  }
  g.restore();
}

function px(g, t, x, y, size, align = "left", weight = 700) {
  g.font = `${weight} ${size}px ${MONO}`;
  g.textBaseline = "alphabetic";
  // Zpix 过 1-bit 阈值需左边缘落整数像素 (center/right 半像素错位会碎裂)
  g.textAlign = "left";
  const width = align === "left" ? 0 : g.measureText(t).width;
  const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  g.fillText(t, Math.round(left), Math.round(y));
}

function line(g, x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function realDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
