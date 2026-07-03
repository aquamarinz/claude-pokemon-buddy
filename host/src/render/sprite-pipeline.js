import { createCanvas } from "@napi-rs/canvas";

import {
  ditherSpriteGray,
  dilate1bpp,
  makePlaceholderSprite,
  SPRITE_CRISP_THRESHOLD,
  thresholdSpriteGray,
} from "./sprites.js";

const MONO = '"Zpix"';
const DEFAULT_SPRITE_SCALE = 3;

export function drawSprite(g, spriteGray, {
  x,
  y,
  maxSize = 156,
  size,
  srcW,
  srcH,
  scale = DEFAULT_SPRITE_SCALE,
  mode = "threshold",
  threshold = SPRITE_CRISP_THRESHOLD,
  bold = false,
  boldRadius = 1,
} = {}) {
  const pixels = spriteGray instanceof Uint8Array ? spriteGray : makePlaceholderSprite(96).gray;
  const side = Math.max(1, Math.round(Math.sqrt(pixels.length)));
  const sourceW = Number.isInteger(srcW) && srcW > 0 ? srcW : (side * side === pixels.length ? side : 96);
  const sourceH = Number.isInteger(srcH) && srcH > 0 ? srcH : Math.max(1, Math.floor(pixels.length / sourceW));
  let rendered = mode === "dither"
    ? ditherSpriteGray(pixels, sourceW, sourceH)
    : thresholdSpriteGray(pixels, sourceW, sourceH, { threshold });
  if (bold) rendered = dilate1bpp(rendered, sourceW, sourceH, boldRadius);
  const spriteCanvas = createCanvas(sourceW, sourceH);
  const sg = spriteCanvas.getContext("2d");
  const img = sg.createImageData(sourceW, sourceH);

  for (let i = 0; i < sourceW * sourceH; i += 1) {
    const v = rendered[i] ?? 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = v > 245 ? 0 : 255;
  }

  sg.putImageData(img, 0, 0);
  const slot = Math.max(1, Math.floor(maxSize ?? size ?? Math.max(sourceW, sourceH)));
  const integerScale = Math.max(1, Math.floor(scale));
  const fitScale = Math.max(1, Math.min(integerScale, Math.floor(slot / Math.max(sourceW, sourceH)) || 1));
  const targetW = sourceW * fitScale;
  const targetH = sourceH * fitScale;
  g.imageSmoothingEnabled = false;
  g.drawImage(
    spriteCanvas,
    x + Math.floor((slot - targetW) / 2),
    y + Math.floor((slot - targetH) / 2),
    targetW,
    targetH,
  );
}

export function px(g, t, x, y, size, align = "left", weight = 700) {
  g.font = `${weight} ${size}px ${MONO}`;
  g.textBaseline = "alphabetic";
  // Zpix over a 1-bit threshold needs an integer left edge; centered/right
  // text is measured manually and rounded before drawing.
  g.textAlign = "left";
  const width = align === "left" ? 0 : g.measureText(t).width;
  const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  g.fillText(t, Math.round(left), Math.round(y));
}

export function line(g, x1, y1, x2, y2) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}
