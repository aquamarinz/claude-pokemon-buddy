import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, saveConfig } from "../src/config.js";

test("loadConfig fills defaults when file missing", () => {
  const c = loadConfig("/nonexistent.json");

  assert.equal(c.planTokenBudget5h > 0, true);
  assert.equal(typeof c.lat, "number");
  assert.ok(Array.isArray(c.box) && c.box.includes("eevee"));
  assert.deepEqual(c.quietHours, { start: 22, end: 8 });
});

test("loadConfig falls back to a parseable backup when primary is corrupt", (t) => {
  const { file } = tempConfig(t);
  const warnings = [];
  writeFileSync(file, "{corrupt");
  writeFileSync(`${file}.bak`, JSON.stringify({ name: "备份", volume: 30 }));

  const config = loadConfig(file, {
    logger: {
      warn(message, meta) {
        warnings.push({ message, meta });
      },
    },
  });

  assert.equal(config.name, "备份");
  assert.equal(config.volume, 30);
  assert.equal(config.planTokenBudget5h > 0, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /backup/i);
});

test("loadConfig snapshots corrupt primary and returns defaults when primary and backup are corrupt", (t) => {
  const { file } = tempConfig(t);
  const warnings = [];
  writeFileSync(file, "{corrupt-primary");
  writeFileSync(`${file}.bak`, "{corrupt-backup");

  const config = loadConfig(file, {
    logger: {
      warn(message, meta) {
        warnings.push({ message, meta });
      },
    },
  });

  assert.equal(config.name, "阿布");
  assert.equal(config.volume, 70);
  assert.equal(existsSync(`${file}.corrupt`), true);
  assert.equal(readFileSync(`${file}.corrupt`, "utf8"), "{corrupt-primary");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /invalid/i);
});

test("saveConfig does not refresh backup from a corrupt primary", (t) => {
  const { file } = tempConfig(t);
  writeFileSync(file, "{corrupt-primary");
  writeFileSync(`${file}.bak`, JSON.stringify({ name: "good backup", volume: 15 }));

  saveConfig(file, { name: "new primary", volume: 40 });

  assert.equal(JSON.parse(readFileSync(file, "utf8")).name, "new primary");
  assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, "utf8")), {
    name: "good backup",
    volume: 15,
  });
});

test("saveConfig writes tmp, fsyncs it, renames, then fsyncs the directory", () => {
  const configUrl = new URL("../src/config.js", import.meta.url).href;
  const fakeFsSource = `
const files = globalThis.__files;
const log = globalThis.__log;
const fds = globalThis.__fds;

export function mkdirSync(path, options) {
  log.push(["mkdirSync", path, Boolean(options?.recursive)]);
}

export function existsSync(path) {
  log.push(["existsSync", path]);
  return files.has(path);
}

export function readFileSync(path, encoding) {
  log.push(["readFileSync", path, encoding]);
  if (!files.has(path)) {
    const error = new Error("ENOENT");
    error.code = "ENOENT";
    throw error;
  }
  return files.get(path);
}

export function copyFileSync(from, to) {
  log.push(["copyFileSync", from, to]);
  files.set(to, files.get(from));
}

export function writeFileSync(path, data) {
  log.push(["writeFileSync", path, data]);
  files.set(path, data);
}

export function openSync(path, flags) {
  log.push(["openSync", path, flags]);
  const fd = globalThis.__nextFd++;
  fds.set(fd, path);
  return fd;
}

export function fsyncSync(fd) {
  log.push(["fsyncSync", fds.get(fd)]);
}

export function closeSync(fd) {
  log.push(["closeSync", fds.get(fd)]);
  fds.delete(fd);
}

export function renameSync(from, to) {
  log.push(["renameSync", from, to]);
  files.set(to, files.get(from));
  files.delete(from);
}
`;
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const fakeFsSource = ${JSON.stringify(fakeFsSource)};
globalThis.__files = new Map([["/cfg/config.json", "{\\"name\\":\\"old\\"}"]]);
globalThis.__log = [];
globalThis.__fds = new Map();
globalThis.__nextFd = 10;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:fs") {
      return {
        url: "data:text/javascript," + encodeURIComponent(fakeFsSource),
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { saveConfig } = await import(${JSON.stringify(`${configUrl}?atomic-order`)});
saveConfig("/cfg/config.json", { name: "new" });

const log = globalThis.__log;
const indexOf = (name, predicate = () => true) => log.findIndex((entry) => entry[0] === name && predicate(entry));
const writeTmp = indexOf("writeFileSync", (entry) => entry[1] === "/cfg/config.json.tmp");
const fsyncTmp = indexOf("fsyncSync", (entry) => entry[1] === "/cfg/config.json.tmp");
const renameTmp = indexOf("renameSync", (entry) => entry[1] === "/cfg/config.json.tmp" && entry[2] === "/cfg/config.json");
const fsyncDir = indexOf("fsyncSync", (entry) => entry[1] === "/cfg");

assert.ok(writeTmp >= 0, JSON.stringify(log));
assert.ok(fsyncTmp > writeTmp, JSON.stringify(log));
assert.ok(renameTmp > fsyncTmp, JSON.stringify(log));
assert.ok(fsyncDir > renameTmp, JSON.stringify(log));
assert.equal(globalThis.__files.has("/cfg/config.json.tmp"), false);
assert.deepEqual(JSON.parse(globalThis.__files.get("/cfg/config.json")), { name: "new" });
assert.deepEqual(JSON.parse(globalThis.__files.get("/cfg/config.json.bak")), { name: "old" });
`;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

function tempConfig(t) {
  const dir = mkdtempSync(join(tmpdir(), "cpb-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, "config.json") };
}
