import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SPECIES_ZH } from "../src/pet/species-meta.js";
import { CANDIDATES } from "../src/pet/onboarding-data.js";

const cries = JSON.parse(
  readFileSync(fileURLToPath(new URL("../seed/species-cries.json", import.meta.url)), "utf8"),
);

test("Chinese species names agree across metadata, cries, and onboarding sources", () => {
  const sources = [
    ["species-meta", new Map(Object.entries(SPECIES_ZH))],
    ["species-cries", new Map(cries.species.map((entry) => [entry.key, entry.zh]))],
    ["onboarding-data", new Map(CANDIDATES.map((entry) => [entry.species, entry.name]))],
  ];
  const keys = new Set(sources.flatMap(([, names]) => [...names.keys()]));

  for (const key of keys) {
    const present = sources.filter(([, names]) => names.has(key));
    if (present.length < 2) continue;
    const expected = present[0][1].get(key);
    for (const [label, names] of present.slice(1)) {
      assert.equal(names.get(key), expected, `${key} mismatch in ${label}`);
    }
  }
});
