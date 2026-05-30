import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const cache = new Map();

export async function loadSpriteGray(path, { size = 96 } = {}) {
  const key = `${path}:${size}`;
  const cached = cache.get(key);
  if (cached) return cloneSprite(cached);

  const sprite = existsSync(path)
    ? await loadPngSprite(path, size)
    : makePlaceholderSprite(size);

  cache.set(key, sprite);
  return cloneSprite(sprite);
}

export async function loadBuddySprite(species = "eevee", options = {}) {
  const spriteUrl = new URL(`../../seed/sprites/${species}.png`, import.meta.url);
  return loadSpriteGray(fileURLToPath(spriteUrl), options);
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

async function loadPngSprite(path, size) {
  try {
    const image = await loadImage(path);
    const canvas = createCanvas(size, size);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = false;
    g.drawImage(image, 0, 0, size, size);
    const data = g.getImageData(0, 0, size, size).data;
    const gray = new Uint8Array(size * size);

    for (let i = 0; i < gray.length; i += 1) {
      const offset = i * 4;
      const alpha = data[offset + 3] / 255;
      const r = data[offset] * alpha + 255 * (1 - alpha);
      const gg = data[offset + 1] * alpha + 255 * (1 - alpha);
      const b = data[offset + 2] * alpha + 255 * (1 - alpha);
      gray[i] = (r * 0.299 + gg * 0.587 + b * 0.114) | 0;
    }

    return { gray, w: size, h: size, placeholder: false };
  } catch {
    return makePlaceholderSprite(size);
  }
}

function cloneSprite(sprite) {
  return {
    ...sprite,
    gray: new Uint8Array(sprite.gray),
  };
}
