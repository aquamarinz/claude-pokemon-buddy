import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const DEFAULTS = {
  name: "阿布",
  planTokenBudget5h: 220_000,
  planTokenBudgetWeek: 2_000_000,
  lat: -36.8485,
  lon: 174.7633,
  box: ["eevee"],
  quietHours: { start: 22, end: 8 },
  volume: 70,
};

export function loadConfig(path = "config.json") {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(path = "config.json", config) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const bak = `${path}.bak`;

  if (existsSync(path)) {
    copyFileSync(path, bak);
  }

  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fsyncFile(tmp);
  renameSync(tmp, path);
  fsyncDirectory(dirname(path));
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
