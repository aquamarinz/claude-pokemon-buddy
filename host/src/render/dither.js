const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

export function ditherTo1bpp(gray, w, h) {
  if (gray.length !== w * h) {
    throw new Error("gray buffer size does not match dimensions");
  }

  const rowBytes = Math.ceil(w / 8);
  const bytes = new Uint8Array(rowBytes * h);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const threshold = ((BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64) * 255;
      const black = gray[y * w + x] < threshold;
      if (black) {
        bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { bytes, w, h };
}
