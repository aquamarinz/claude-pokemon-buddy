import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { ditherTo1bpp } from "./dither.js";

// Flat official pixel sprites read cleaner on 1-bit LCDs when body tones become ink.
export const SPRITE_CRISP_THRESHOLD = 200;

const cache = new Map();

export async function loadSpriteGray(path, { size = 96 } = {}) {
  const key = `${path}:${size ?? "native"}`;
  const cached = cache.get(key);
  if (cached) return cloneSprite(cached);

  const sprite = existsSync(path)
    ? await loadPngSprite(path, size)
    : makePlaceholderSprite(size ?? 96);

  cache.set(key, sprite);
  return cloneSprite(sprite);
}

export async function loadBuddySprite(species = "eevee", options = {}) {
  const spriteUrl = new URL(`../../seed/sprites/${species}.png`, import.meta.url);
  return loadSpriteGray(fileURLToPath(spriteUrl), { size: null, ...options });
}

export async function loadOakSprite(options = {}) {
  const url = new URL("../../seed/oak.png", import.meta.url);
  return loadSpriteGray(fileURLToPath(url), { size: null, ...options });
}

export function makePlaceholderSprite(size = 96) {
  const gray = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const border = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      gray[y * size + x] = border || (((x >> 3) + (y >> 3)) & 1) ? 0 : 255;
    }
  }

  return { gray, w: size, h: size, placeholder: true };
}

export function ditherSpriteGray(gray, w, h, { transparentThreshold = 245 } = {}) {
  if (!(gray instanceof Uint8Array) || gray.length !== w * h) {
    throw new Error("sprite gray buffer size does not match dimensions");
  }

  const prepared = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    prepared[i] = gray[i] > transparentThreshold ? 255 : gray[i];
  }

  const bitmap = ditherTo1bpp(prepared, w, h);
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(gray.length).fill(255);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const on = (bitmap.bytes[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      if (on) out[y * w + x] = 0;
    }
  }

  return out;
}

export function thresholdSpriteGray(gray, w, h, { threshold = SPRITE_CRISP_THRESHOLD } = {}) {
  if (!(gray instanceof Uint8Array) || gray.length !== w * h) {
    throw new Error("sprite gray buffer size does not match dimensions");
  }

  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = gray[i] < threshold ? 0 : 255;
  }
  return out;
}

// Morphological dilation of ink (value 0) on a 1-bit-valued buffer
// (0 = ink, 255 = paper). Returns a NEW buffer; never mutates input.
// Each radius step grows ink into its 4-neighbours so thin 1px strokes read as
// solid on the 1-bit LCD instead of breaking into dashes. Expects a thresholded
// (0/255) buffer; non-zero, non-255 values are treated as paper.
export function dilate1bpp(gray, w, h, radius = 1) {
  if (!(gray instanceof Uint8Array) || gray.length !== w * h) {
    throw new Error("dilate1bpp: gray buffer size does not match dimensions");
  }
  let src = gray;
  const steps = Math.max(0, Math.floor(radius)); // 归一化，防小数多膨胀一圈
  for (let r = 0; r < steps; r += 1) {
    const out = new Uint8Array(src.length).fill(255);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        const ink =
          src[i] === 0 ||
          (x > 0 && src[i - 1] === 0) ||
          (x < w - 1 && src[i + 1] === 0) ||
          (y > 0 && src[i - w] === 0) ||
          (y < h - 1 && src[i + w] === 0);
        out[i] = ink ? 0 : 255;
      }
    }
    src = out;
  }
  return src === gray ? new Uint8Array(gray) : src; // radius 0 → 非 mutate 拷贝
}

async function loadPngSprite(path, size) {
  try {
    const image = await loadImage(path);
    const w = size == null ? image.width : size;
    const h = size == null ? image.height : size;
    const canvas = createCanvas(w, h);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = false;
    g.drawImage(image, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);

    for (let i = 0; i < gray.length; i += 1) {
      const offset = i * 4;
      const alpha = data[offset + 3] / 255;
      const r = data[offset] * alpha + 255 * (1 - alpha);
      const gg = data[offset + 1] * alpha + 255 * (1 - alpha);
      const b = data[offset + 2] * alpha + 255 * (1 - alpha);
      gray[i] = (r * 0.299 + gg * 0.587 + b * 0.114) | 0;
    }

    return { gray, w, h, placeholder: false };
  } catch {
    return makePlaceholderSprite(size ?? 96);
  }
}

function cloneSprite(sprite) {
  return {
    ...sprite,
    gray: new Uint8Array(sprite.gray),
  };
}
