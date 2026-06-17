import { test } from "node:test";
import assert from "node:assert/strict";

import { SND_SPECIES_BASE, SPECIES_SOUND_ORDER, cryAudioId } from "../src/pet/cry-audio.js";

test("SND_SPECIES_BASE is 3 (after BUI/EVOLVE/HOUR)", () => {
  assert.equal(SND_SPECIES_BASE, 3);
});

test("18 species map to contiguous, unique ids [3,20]", () => {
  assert.equal(SPECIES_SOUND_ORDER.length, 18);
  const ids = SPECIES_SOUND_ORDER.map((s) => cryAudioId(s));
  assert.deepEqual(ids, Array.from({ length: 18 }, (_, i) => 3 + i));
  assert.equal(new Set(ids).size, 18);
});

test("cryAudioId follows JSON order (eevee=3, blastoise=20)", () => {
  assert.equal(cryAudioId("eevee"), 3);
  assert.equal(cryAudioId("blastoise"), 20);
});

test("cryAudioId returns null for unknown species", () => {
  assert.equal(cryAudioId("不存在"), null);
  assert.equal(cryAudioId(undefined), null);
});
