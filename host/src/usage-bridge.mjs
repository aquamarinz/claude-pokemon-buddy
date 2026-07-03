#!/usr/bin/env node
// Claude Code statusLine command. CC spawns this each update and pipes the
// session JSON (incl. rate_limits) on stdin. We extract official 5h/week usage,
// atomically write ~/.claude/cpb-usage.json for the buddy host to read, and
// print a one-line statusline so the user's status bar still shows something.
// MUST never throw — a crashing statusLine command degrades the CC UI.
import { homedir } from "node:os";
import { join } from "node:path";

import { writeUsageFile } from "./usage-poll.mjs";

const OUT = process.env.CPB_USAGE_PATH || join(homedir(), ".claude", "cpb-usage.json");

function readStdin() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => resolve(s));
    process.stdin.on("error", () => resolve(""));
  });
}

const raw = await readStdin();
let j = {};
try { j = JSON.parse(raw); } catch { /* keep {} */ }

const rl = (j && j.rate_limits) || {};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const out = {
  fiveHourPct: num(rl.five_hour?.used_percentage),
  fiveHourReset: num(rl.five_hour?.resets_at),
  weeklyPct: num(rl.seven_day?.used_percentage),
  weeklyReset: num(rl.seven_day?.resets_at),
  writtenAt: Math.floor(Date.now() / 1000),
};

try {
  writeUsageFile(OUT, out);
} catch { /* never crash CC over a write failure */ }

const f = out.fiveHourPct == null ? "--" : `${Math.round(out.fiveHourPct)}%`;
const w = out.weeklyPct == null ? "--" : `${Math.round(out.weeklyPct)}%`;
process.stdout.write(`Buddy · 5h ${f} · wk ${w}`);
