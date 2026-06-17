// Reproducible bake for all 18 buddy sprites + Oak portrait.
// Run from host/: node scripts/bake-assets.mjs
// This script downloads source assets; tests only read committed PNG outputs.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const SEED = fileURLToPath(new URL("../seed/", import.meta.url));
const SPRITES = fileURLToPath(new URL("../seed/sprites/", import.meta.url));
const DW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/dream-world";
const OAK = "https://archives.bulbagarden.net/media/upload/4/4c/Spr_FRLG_Oak.png";
const SPECIES = {
  bulbasaur: 1,
  ivysaur: 2,
  venusaur: 3,
  charmander: 4,
  charmeleon: 5,
  charizard: 6,
  squirtle: 7,
  wartortle: 8,
  blastoise: 9,
  eevee: 133,
  vaporeon: 134,
  jolteon: 135,
  flareon: 136,
  espeon: 196,
  umbreon: 197,
  leafeon: 470,
  glaceon: 471,
  sylveon: 700,
};

async function fetchBytes(url) {
  const res = await fetch(url, { headers: { "user-agent": "claude-pokemon-buddy asset baker" } });
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function bakeDW(svgText, targetMax = 134) {
  const image = await loadImage(Buffer.from(svgText));
  const scale = (targetMax * 4) / Math.max(image.width, image.height);
  const hiW = Math.max(1, Math.round(image.width * scale));
  const hiH = Math.max(1, Math.round(image.height * scale));
  const w = Math.max(1, Math.round(hiW / 4));
  const h = Math.max(1, Math.round(hiH / 4));

  const hi = createCanvas(hiW, hiH);
  const hg = hi.getContext("2d");
  hg.fillStyle = "#fff";
  hg.fillRect(0, 0, hiW, hiH);
  hg.imageSmoothingEnabled = true;
  hg.imageSmoothingQuality = "high";
  hg.drawImage(image, 0, 0, hiW, hiH);

  const canvas = createCanvas(w, h);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(hi, 0, 0, w, h);

  const data = g.getImageData(0, 0, w, h).data;
  const gray = rgbaToGray(data, w * h);
  const threshold = calibratedThreshold(gray, 0.13, 25);
  return oneBitTransparentPng(gray, w, h, threshold);
}

async function bakeOak(pngBuffer, threshold = 175) {
  const image = await loadImage(pngBuffer);
  const canvas = createCanvas(image.width, image.height);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, image.width, image.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(image, 0, 0);

  const data = g.getImageData(0, 0, image.width, image.height).data;
  const gray = rgbaToGray(data, image.width * image.height);
  const mask = new Uint8Array(gray.length);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = y * image.width + x;
      if (gray[i] < threshold) {
        mask[i] = 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) throw new Error("Oak bake produced no ink");
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cropped = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = (minY + y) * image.width + minX + x;
      if (mask[src]) cropped[y * w + x] = 0;
    }
  }

  return oneBitTransparentPng(cropped, w, h, 128);
}

function rgbaToGray(data, pixels) {
  const gray = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const offset = i * 4;
    gray[i] = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) | 0;
  }
  return gray;
}

function calibratedThreshold(gray, targetInkRatio, boost) {
  let threshold = 128;
  for (let t = 0; t <= 255; t += 1) {
    let ink = 0;
    for (const value of gray) {
      if (value < t) ink += 1;
    }
    if (ink / gray.length >= targetInkRatio) {
      threshold = t;
      break;
    }
  }
  return Math.max(0, Math.min(255, threshold + boost));
}

async function oneBitTransparentPng(gray, w, h, threshold) {
  const canvas = createCanvas(w, h);
  const g = canvas.getContext("2d");
  const image = g.createImageData(w, h);
  for (let i = 0; i < gray.length; i += 1) {
    const off = i * 4;
    const ink = gray[i] < threshold;
    image.data[off] = ink ? 0 : 255;
    image.data[off + 1] = ink ? 0 : 255;
    image.data[off + 2] = ink ? 0 : 255;
    image.data[off + 3] = ink ? 255 : 0;
  }
  g.putImageData(image, 0, 0);
  return canvas.encode("png");
}

mkdirSync(SPRITES, { recursive: true });
for (const [name, id] of Object.entries(SPECIES)) {
  const svg = (await fetchBytes(`${DW}/${id}.svg`)).toString("utf8");
  const png = await bakeDW(svg);
  writeFileSync(`${SPRITES}/${name}.png`, png);
  console.log(`wrote seed/sprites/${name}.png`);
}

const oak = await bakeOak(await fetchBytes(OAK));
writeFileSync(`${SEED}/oak.png`, oak);
console.log("wrote seed/oak.png");
