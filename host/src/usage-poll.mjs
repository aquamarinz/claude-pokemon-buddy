import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
export const USAGE_PATH = join(homedir(), ".claude", "cpb-usage.json");

const DEFAULT_VERSION = "2.1.0";
const OAUTH_BETA = "oauth-2025-04-20";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

export function readOAuthToken({
  platform = process.platform,
  home = homedir(),
  exec = runCommand,
  readFile = readFileSync,
} = {}) {
  try {
    const raw = platform === "darwin"
      ? exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { timeoutMs: 2_000 })
      : readFile(join(home, ".claude", ".credentials.json"), "utf8");
    return tokenFromCredentials(outputText(raw));
  } catch {
    return null;
  }
}

export function ccVersion({ exec = runCommand } = {}) {
  try {
    const out = outputText(exec("claude", ["--version"], { timeoutMs: 2_000 }));
    return out.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

export async function fetchUsage(token, { version = DEFAULT_VERSION, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (!token || typeof fetchImpl !== "function") return null;
    const res = await fetchImpl(USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": OAUTH_BETA,
        "User-Agent": `claude-code/${version || DEFAULT_VERSION}`,
        "Content-Type": "application/json",
      },
    });
    if (res?.status !== 200) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function toUsageFileShape(apiResp, nowMs) {
  return {
    fiveHourPct: numOrNull(apiResp?.five_hour?.utilization),
    fiveHourReset: isoToEpoch(apiResp?.five_hour?.resets_at),
    weeklyPct: numOrNull(apiResp?.seven_day?.utilization),
    weeklyReset: isoToEpoch(apiResp?.seven_day?.resets_at),
    writtenAt: Math.floor(nowMs / 1000),
  };
}

export async function pollUsageOnce({
  usagePath = USAGE_PATH,
  now = Date.now(),
  minIntervalSec = 180,
  platform = process.platform,
  home = homedir(),
  exec = runCommand,
  readFile = readFileSync,
  fetchImpl = globalThis.fetch,
  version,
  readOAuthTokenImpl = readOAuthToken,
  ccVersionImpl = ccVersion,
  fetchUsageImpl = fetchUsage,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
  rename = renameSync,
} = {}) {
  try {
    const nowMs = typeof now === "function" ? now() : now;
    if (isThrottled({ usagePath, nowMs, minIntervalSec, readFile })) {
      return { ok: true, skipped: true };
    }

    const token = await readOAuthTokenImpl({ platform, home, exec, readFile });
    if (!token) return { ok: false, reason: "no-token" };

    const resolvedVersion = version ?? ccVersionImpl({ exec });
    const apiResp = await fetchUsageImpl(token, { version: resolvedVersion, fetchImpl });
    if (!apiResp) return { ok: false, reason: "fetch-failed" };

    const out = toUsageFileShape(apiResp, nowMs);
    writeUsageFile(usagePath, out, { mkdir, writeFile, rename });
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function runCommand(command, args, { timeoutMs = 2_000 } = {}) {
  const res = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: timeoutMs,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${command} exited ${res.status}`);
  return res.stdout ?? "";
}

function tokenFromCredentials(raw) {
  const parsed = JSON.parse(raw);
  const token = parsed?.claudeAiOauth?.accessToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function outputText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value?.stdout === "string") return value.stdout;
  if (Buffer.isBuffer(value?.stdout)) return value.stdout.toString("utf8");
  return "";
}

function isThrottled({ usagePath, nowMs, minIntervalSec, readFile }) {
  try {
    const data = JSON.parse(readFile(usagePath, "utf8"));
    const writtenAt = Number(data?.writtenAt);
    return Number.isFinite(writtenAt) && Math.floor(nowMs / 1000) - writtenAt < minIntervalSec;
  } catch {
    return false;
  }
}

function writeUsageFile(path, out, { mkdir, writeFile, rename }) {
  mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFile(tmp, JSON.stringify(out));
  rename(tmp, path);
}

function numOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoToEpoch(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
