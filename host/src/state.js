import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;

export function saveState(path, state) {
  const tmp = `${path}.tmp`;
  const bak = `${path}.bak`;

  if (existsSync(path)) {
    copyFileSync(path, bak);
  }

  writeFileSync(tmp, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }));
  fsyncFile(tmp);
  renameSync(tmp, path);
  fsyncDirectory(dirname(path));
}

export function loadState(path, { logger = console } = {}) {
  const partials = [];
  let sawStateFile = false;

  for (const candidate of [path, `${path}.bak`]) {
    if (!existsSync(candidate)) continue;
    sawStateFile = true;
    try {
      const state = JSON.parse(readFileSync(candidate, "utf8"));
      if (isValidState(state)) return state;
      const salvaged = salvageState(state);
      if (Object.keys(salvaged).length > 0) partials.push(salvaged);
    } catch {
      // Try the backup, then rebuild below.
    }
  }

  const salvaged = mergeSalvage(partials);
  if (sawStateFile) {
    logger?.warn?.("state files invalid; rebuilding from salvageable fields", {
      path,
      salvaged: Object.keys(salvaged),
    });
  }
  return { schemaVersion: SCHEMA_VERSION, _rebuilt: true, ...salvaged };
}

function isValidState(state) {
  return Boolean(
    state &&
      typeof state === "object" &&
      !Array.isArray(state) &&
      state.schemaVersion === SCHEMA_VERSION,
  );
}

function salvageState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};

  const out = {};
  copyString(out, state, "species");
  copyNumber(out, state, "level");
  copyNumber(out, state, "exp");
  copyNumber(out, state, "bond");
  copyNumber(out, state, "streak");
  copyNumber(out, state, "shield");
  copyNumber(out, state, "todayCreditedExp");
  copyNumber(out, state, "todayCreditedBond");
  copyNumber(out, state, "careCount");
  copyString(out, state, "lastSettled");
  copyString(out, state, "lastGrowthDay");
  copyBoolean(out, state, "readyToEvolve");
  copyBoolean(out, state, "hatched");
  copyString(out, state, "name");
  if (Array.isArray(state.pendingCandidates)) out.pendingCandidates = state.pendingCandidates;
  return out;
}

function mergeSalvage(partials) {
  return partials.reduce((merged, partial) => ({ ...partial, ...merged }), {});
}

function copyString(out, state, key) {
  if (typeof state[key] === "string" && state[key].length > 0) out[key] = state[key];
}

function copyNumber(out, state, key) {
  if (typeof state[key] === "number" && Number.isFinite(state[key])) out[key] = state[key];
}

function copyBoolean(out, state, key) {
  if (typeof state[key] === "boolean") out[key] = state[key];
}

function fsyncFile(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path) {
  try {
    const fd = openSync(path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Directory fsync is not supported on every platform.
  }
}
