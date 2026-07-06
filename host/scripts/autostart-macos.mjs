import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const LABEL = "com.claude-pokemon-buddy.host";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const HOST_DIR = resolve(dirname(SCRIPT_PATH), "..");
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

export function buildPlist({ nodePath, hostDir }) {
  const normalizedHostDir = normalize(hostDir).replace(/\/+$/, "");
  const programPath = join(normalizedHostDir, "src", "index.js");
  const logPath = join(normalizedHostDir, "out", "host.log");

  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(normalize(nodePath))}</string>
    <string>${escapeXml(programPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(normalizedHostDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// Broad pgrep pattern: any process whose command line mentions src/index.js
// is a candidate. Manual instances are commonly started as `cd host && node
// src/index.js` (relative cmdline, no project path in it), so an anchored
// absolute-path pattern misses them. Each candidate is then confirmed
// per-pid via isHostProcess (cmdline or cwd ownership).
export function candidatePattern() {
  return "src/index\\.js";
}

// Pure ownership check for a candidate pid. A process belongs to this host
// project if its command line references the absolute <hostDir>/src/index.js,
// or its working directory equals hostDir (relative invocation).
export function isHostProcess({ cmdline, cwd, hostDir }) {
  const dir = stripTrailingSlashes(normalize(String(hostDir)));
  if (typeof cmdline === "string" && cmdline.includes(join(dir, "src", "index.js"))) {
    return true;
  }
  if (typeof cwd === "string" && cwd.length > 0) {
    return stripTrailingSlashes(normalize(cwd)) === dir;
  }
  return false;
}

function stripTrailingSlashes(value) {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

const STABLE_NODE_CANDIDATES = [
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node",
];

// process.execPath under Homebrew points at a versioned Cellar path that dies
// on `node` upgrade. Prefer a stable symlink that currently resolves to the
// same binary as execPath; otherwise fall back to execPath.
export function resolveStableNodePath({ execPath, candidates, exists, realpath }) {
  let execReal;
  try {
    execReal = realpath(execPath);
  } catch {
    return execPath;
  }

  for (const candidate of candidates) {
    if (!exists(candidate)) continue;
    let candidateReal;
    try {
      candidateReal = realpath(candidate);
    } catch {
      continue;
    }
    if (candidateReal === execReal) return candidate;
  }
  return execPath;
}

export async function main(argv, { platform = process.platform } = {}) {
  if (platform !== "darwin") {
    console.error("autostart-macos: macOS only");
    return 1;
  }

  const command = argv[0];
  if (argv.length !== 1 || !["install", "uninstall", "status"].includes(command)) {
    printUsage();
    return 1;
  }

  if (command === "install") return install();
  if (command === "uninstall") return uninstall();
  return status();
}

async function install() {
  launchctl(["bootout", serviceTarget()], { ignoreFailure: true });

  // Wait for bootout to settle before probing for manual instances, otherwise
  // the just-booted-out managed instance can be misread as a manual one.
  if (!(await waitForServiceGone())) {
    console.error("launchctl bootout did not settle; aborting install.");
    return 1;
  }

  const manual = findManualHostPids();
  if (!manual.ok) return 1;
  if (manual.pids.length > 0) {
    console.error(`Found existing host process(es): ${manual.pids.join(", ")}`);
    console.error("Kill them first, then run this install command again.");
    return 1;
  }

  const nodePath = resolveStableNodePath({
    execPath: process.execPath,
    candidates: STABLE_NODE_CANDIDATES,
    exists: existsSync,
    realpath: realpathSync,
  });

  mkdirSync(join(HOST_DIR, "out"), { recursive: true });
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  writeFileSync(PLIST_PATH, buildPlist({ nodePath, hostDir: HOST_DIR }));

  if (!launchctl(["bootstrap", serviceDomain(), PLIST_PATH])) return 1;
  console.log(`Installed ${LABEL}`);
  console.log(`Plist: ${PLIST_PATH}`);
  return 0;
}

async function waitForServiceGone() {
  for (let i = 0; i < 25; i++) {
    const result = runCommand("launchctl", ["print", serviceTarget()]);
    if (result.status !== 0) return true;
    await sleep(200);
  }
  return false;
}

function uninstall() {
  const result = runCommand("launchctl", ["bootout", serviceTarget()]);
  if (result.status !== 0 && !isMissingService(result)) {
    printCommandFailure("launchctl", ["bootout", serviceTarget()], result);
    return 1;
  }

  if (existsSync(PLIST_PATH)) unlinkSync(PLIST_PATH);
  console.log(`Uninstalled ${LABEL}`);
  console.log(`Plist: ${PLIST_PATH}`);
  return 0;
}

function status() {
  console.log(`plist: ${existsSync(PLIST_PATH) ? "installed" : "not installed"} (${PLIST_PATH})`);

  const result = runCommand("launchctl", ["print", serviceTarget()]);
  if (result.status !== 0) {
    console.log("launchctl: not loaded");
    console.log("running: no");
    return 0;
  }

  const state = parseLaunchctlState(result.stdout);
  console.log("launchctl: loaded");
  console.log(`state: ${state ?? "unknown"}`);
  console.log(`running: ${state === "running" ? "yes" : "no"}`);
  return 0;
}

// Two-stage detection: broad pgrep scan for candidates, then per-pid
// ownership confirmation via cmdline (ps) and cwd (lsof).
export function findManualHostPids(hostDir = HOST_DIR) {
  const pattern = candidatePattern();
  const result = runCommand("pgrep", ["-f", pattern]);
  if (result.status === 1) return { ok: true, pids: [] };
  if (result.status !== 0) {
    printCommandFailure("pgrep", ["-f", pattern], result);
    return { ok: false, pids: [] };
  }

  const candidates = result.stdout
    .split(/\s+/)
    .map((pid) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  const hostDirs = [...new Set([hostDir, realpathSafe(hostDir)])];
  const pids = candidates.filter((pid) => {
    const cmdline = processCmdline(pid);
    if (cmdline === null) return false;
    const cwd = processCwd(pid);
    return hostDirs.some((dir) => isHostProcess({ cmdline, cwd, hostDir: dir }));
  });
  return { ok: true, pids };
}

function processCmdline(pid) {
  const result = runCommand("ps", ["-p", String(pid), "-o", "command="]);
  if (result.status !== 0) return null;
  const cmdline = result.stdout.trim();
  return cmdline.length > 0 ? cmdline : null;
}

function processCwd(pid) {
  const result = runCommand("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  if (result.status !== 0) return null;
  const line = result.stdout.split("\n").find((l) => l.startsWith("n"));
  if (!line) return null;
  return realpathSafe(line.slice(1));
}

function realpathSafe(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function launchctl(args, { ignoreFailure = false } = {}) {
  const result = runCommand("launchctl", args);
  if (result.status === 0) return true;
  if (!ignoreFailure) printCommandFailure("launchctl", args, result);
  return false;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function printCommandFailure(command, args, result) {
  const stderr = result.stderr.trim();
  if (stderr) {
    console.error(stderr);
    return;
  }
  if (result.error) {
    console.error(`${command}: ${result.error.message}`);
    return;
  }
  console.error(`${command} ${args.join(" ")} exited ${result.status}`);
}

function parseLaunchctlState(output) {
  return output.match(/^\s*state\s*=\s*(\S+)/m)?.[1] ?? null;
}

function isMissingService(result) {
  const text = `${result.stdout}\n${result.stderr}`;
  return /could not find service|no such process|not found|service is not loaded/i.test(text);
}

function serviceDomain() {
  return `gui/${uid()}`;
}

function serviceTarget() {
  return `${serviceDomain()}/${LABEL}`;
}

function uid() {
  return process.getuid();
}

function printUsage() {
  console.error(`Usage: node scripts/autostart-macos.mjs <install|uninstall|status>`);
}

if (process.argv[1] === SCRIPT_PATH) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(err?.message ?? String(err));
    process.exitCode = 1;
  });
}
