import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Idle bubble cries + happy/strained variants, single-sourced from species-cries.json.
const data = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../seed/species-cries.json", import.meta.url)), "utf8"),
);

const VARIANTS = Object.fromEntries(data.species.map((s) => [s.key, s.bubble]));

// Back-compat: CRIES stays a species->idle-string map; EEVEE_IDLE_CRY is layout's fallback.
export const CRIES = Object.fromEntries(data.species.map((s) => [s.key, s.bubble.idle]));
export const EEVEE_IDLE_CRY = CRIES.eevee;

// mood ∈ {happy, focused, strained, fainted, shocked} (deriveMood) or undefined.
export function cryFor(species, mood) {
  const v = VARIANTS[species];
  if (!v) return "♪";
  if (mood === "happy") return v.happy;
  if (mood === "strained" || mood === "fainted" || mood === "shocked") return v.strained;
  return v.idle; // focused / undefined / 其余
}
