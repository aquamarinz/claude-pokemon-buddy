import { createCanvas } from "@napi-rs/canvas";

import { thresholdTo1bpp } from "./dither.js";
import { drawGray } from "./layout.js";
import { H, W } from "./palette.js";

export async function renderFrame(model) {
  const image = drawGray(model);
  const gray = rgbaToGray(image.data, W, H);
  const bitmap = grayToBitmap(gray, W, H);
  const pngBuffer = await bitmapToPng(bitmap);

  return { pngBuffer, bitmap };
}

export function grayToBitmap(gray, w, h) {
  return thresholdTo1bpp(gray, w, h);
}

function rgbaToGray(data, w, h) {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i += 1) {
    const offset = i * 4;
    gray[i] = (data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114) | 0;
  }
  return gray;
}

async function bitmapToPng(bitmap) {
  const canvas = createCanvas(bitmap.w, bitmap.h);
  const g = canvas.getContext("2d");
  const out = g.createImageData(bitmap.w, bitmap.h);
  const rowBytes = Math.ceil(bitmap.w / 8);

  for (let y = 0; y < bitmap.h; y += 1) {
    for (let x = 0; x < bitmap.w; x += 1) {
      const on = (bitmap.bytes[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = on ? 0 : 255;
      const offset = (y * bitmap.w + x) * 4;
      out.data[offset] = v;
      out.data[offset + 1] = v;
      out.data[offset + 2] = v;
      out.data[offset + 3] = 255;
    }
  }

  g.putImageData(out, 0, 0);
  return canvas.encode("png");
}
