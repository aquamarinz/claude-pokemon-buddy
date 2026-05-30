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

export function loadState(path) {
  for (const candidate of [path, `${path}.bak`]) {
    try {
      const state = JSON.parse(readFileSync(candidate, "utf8"));
      if (isValidState(state)) return state;
    } catch {
      // Try the backup, then rebuild below.
    }
  }

  return { schemaVersion: SCHEMA_VERSION, _rebuilt: true };
}

function isValidState(state) {
  return Boolean(
    state &&
      typeof state === "object" &&
      !Array.isArray(state) &&
      state.schemaVersion === SCHEMA_VERSION,
  );
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
