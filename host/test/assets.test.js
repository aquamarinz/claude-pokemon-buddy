import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSpriteGray } from "../src/render/sprites.js";

test("oak asset exists and loads as a real (non-placeholder) 1-bit sprite", async () => {
  const path = fileURLToPath(new URL("../seed/oak.png", import.meta.url));
  assert.ok(existsSync(path), "seed/oak.png must be committed");
  const s = await loadSpriteGray(path, { size: null });
  assert.equal(s.placeholder, false);
  assert.ok(s.w > 20 && s.h > 30, "oak sprite has real dimensions");
});
