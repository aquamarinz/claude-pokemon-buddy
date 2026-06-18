import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 单一真源：物种顺序即 firmware 音表索引（soundId = soundBase + index）。
const data = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../seed/species-cries.json", import.meta.url)), "utf8"),
);

export const SND_SPECIES_BASE = data.soundBase;
export const SPECIES_SOUND_ORDER = data.species.map((s) => s.key);
const INDEX = new Map(SPECIES_SOUND_ORDER.map((key, i) => [key, i]));

export function cryAudioId(species) {
  const i = INDEX.get(species);
  return i === undefined ? null : SND_SPECIES_BASE + i;
}
