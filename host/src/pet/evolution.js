import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = new URL("../../seed/evolution/", import.meta.url);
const TABLE = {};
for (const file of readdirSync(DIR)) {
  if (file.endsWith(".json")) {
    Object.assign(TABLE, JSON.parse(readFileSync(fileURLToPath(new URL(file, DIR)), "utf8")));
  }
}

export function eligibleBranches(species, ctx = {}) {
  const node = TABLE[species];
  if (!node) return [];

  return node.branches
    .filter((branch) => needsMet(branch.needs, ctx))
    .sort((a, b) => a.priority - b.priority);
}

export function resolveEvolution(species, ctx = {}) {
  const candidates = eligibleBranches(species, ctx);
  if (candidates.length === 0) return { auto: null, candidates: [] };

  const stone = ctx.stone ? candidates.find((branch) => branch.needs.stone === ctx.stone) : null;
  if (stone) return { auto: stone.to, candidates };
  if (candidates.length === 1) return { auto: candidates[0].to, candidates };

  return { auto: null, candidates };
}

function needsMet(needs, ctx) {
  return Object.entries(needs).every(([key, value]) => {
    if (key === "bond") return (ctx.bond ?? 0) >= value;
    if (key === "level") return (ctx.level ?? 0) >= value;
    if (key === "stone") return ctx.stone === value;
    return ctx[key] === value;
  });
}
