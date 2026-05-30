export function diffRect(prevBits, nextBits, w, h) {
  if (!prevBits) return { x: 0, y: 0, w, h, bytes: nextBits };

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (bitAt(prevBits, w, x, y) !== bitAt(nextBits, w, x, y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0) return null;

  const x = Math.floor(minX / 8) * 8;
  const right = Math.min(w, Math.ceil((maxX + 1) / 8) * 8);
  const rectW = right - x;
  const rectH = maxY - minY + 1;
  return {
    x,
    y: minY,
    w: rectW,
    h: rectH,
    bytes: copyRectBytes(nextBits, w, x, minY, rectW, rectH),
  };
}

function bitAt(bytes, w, x, y) {
  const rowBytes = Math.ceil(w / 8);
  const b = bytes[y * rowBytes + (x >> 3)];
  return (b >> (7 - (x & 7))) & 1;
}

function copyRectBytes(bytes, w, x, y, rectW, rectH) {
  const rowBytes = Math.ceil(w / 8);
  const rectRowBytes = Math.ceil(rectW / 8);
  const out = new Uint8Array(rectRowBytes * rectH);
  const startByte = x >> 3;

  for (let row = 0; row < rectH; row += 1) {
    const sourceStart = (y + row) * rowBytes + startByte;
    out.set(bytes.slice(sourceStart, sourceStart + rectRowBytes), row * rectRowBytes);
  }

  return out;
}
