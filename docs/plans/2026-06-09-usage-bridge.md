# Usage Bridge（官方 statusline rate_limits）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 执行（本项目派发走 codeagent CLI `--backend claude`，铁律#2；codex credit block 到 2026-06-11，用户已授权暂用 claude backend）。Steps 用 checkbox（`- [ ]`）跟踪。每个 task TDD：写失败测试 → 验证失败 → 最小实现 → 验证通过 → commit。

**Goal:** 把 buddy 的 5h/周用量百分比从"ccusage totalTokens÷固定预算（含 93% cacheRead，永远爆 100%）"换成 Claude Code 官方 statusline `rate_limits` 的真实值；ccusage 保留只出 today cost/token。

**Architecture:** 朋友用 CC 时，CC 经 `statusLine` command 把含 `rate_limits` 的 JSON 喂给一个 Node bridge 脚本（stdin）→ bridge 原子写 `~/.claude/cpb-usage.json` → buddy host 读它出官方 5h/周% + reset；host 的 ccusage 路径只保留 cost/token。字段形状（`p5h/pweek/resets5h/resetsWeek/todayCost/todayTokens`）保持不变，渲染层（`layout.js`/`viewmodel.js`）零改动。

**Tech Stack:** Node.js (ESM)、`node:test`、Claude Code statusLine（v2.1.80+）、ccusage（npx，保留）。

**契约约束（所有 task 共同遵守）:**
- `resets5h`/`resetsWeek` 必须是 **ISO 字符串**（`layout.js:466` `formatReset` 只认 string，非 string → "reset unknown"）；statusline `resets_at` 是 epoch 秒，须 `new Date(sec*1000).toISOString()` 转换。
- `p5h`/`pweek` 是数字或 `null`（缺失）；`null` 经 `percentText` 天然显示 `"--"`，不要填 0/100。
- usage.json 路径统一 `~/.claude/cpb-usage.json`（bridge 写、host 读，两进程不同 cwd，用 `os.homedir()` 定位）。

---

### Task 1: rate-limits 读取模块（host 侧）

**Files:**
- Create: `host/src/rate-limits.js`
- Test: `host/test/rate-limits.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/rate-limits.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRateLimits } from "../src/rate-limits.js";

function fixture(obj) {
  const dir = mkdtempSync(join(tmpdir(), "cpb-rl-"));
  const path = join(dir, "cpb-usage.json");
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

const NOW = 1_750_000_000_000; // 固定基准（ms）
const NOW_SEC = Math.floor(NOW / 1000);

test("parses official 5h/week percent and converts epoch reset to ISO", () => {
  const path = fixture({
    fiveHourPct: 9, fiveHourReset: NOW_SEC + 3600,
    weeklyPct: 52, weeklyReset: NOW_SEC + 86400,
    writtenAt: NOW_SEC,
  });
  const rl = loadRateLimits({ path, now: NOW });
  assert.equal(rl.p5h, 9);
  assert.equal(rl.pweek, 52);
  assert.equal(rl.resets5h, new Date((NOW_SEC + 3600) * 1000).toISOString());
  assert.equal(rl.resetsWeek, new Date((NOW_SEC + 86400) * 1000).toISOString());
  assert.equal(rl.official, true);
  assert.equal(rl.stale, false);
});

test("missing file → all null, not stale-crash", () => {
  const rl = loadRateLimits({ path: "/no/such/cpb-usage.json", now: NOW });
  assert.equal(rl.p5h, null);
  assert.equal(rl.pweek, null);
  assert.equal(rl.resets5h, null);
  assert.equal(rl.official, false);
});

test("missing five_hour field → p5h null but weekly still parsed", () => {
  const path = fixture({ weeklyPct: 52, weeklyReset: NOW_SEC + 10, writtenAt: NOW_SEC });
  const rl = loadRateLimits({ path, now: NOW });
  assert.equal(rl.p5h, null);
  assert.equal(rl.pweek, 52);
  assert.equal(rl.official, true); // 有任一即 official
});

test("written over 15min ago → stale=true", () => {
  const path = fixture({ fiveHourPct: 9, writtenAt: NOW_SEC - 16 * 60 });
  const rl = loadRateLimits({ path, now: NOW });
  assert.equal(rl.stale, true);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test test/rate-limits.test.js`
Expected: FAIL（`Cannot find module '../src/rate-limits.js'`）

- [ ] **Step 3: 最小实现**

`host/src/rate-limits.js`:
```js
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_PATH = join(homedir(), ".claude", "cpb-usage.json");
const STALE_SEC = 15 * 60; // 没用 CC 超过 15min → stale

export function loadRateLimits({ path = USAGE_PATH, now = Date.now() } = {}) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { p5h: null, pweek: null, resets5h: null, resetsWeek: null, official: false, stale: true };
  }
  const writtenAt = Number(data.writtenAt);
  const stale = !Number.isFinite(writtenAt) || Math.floor(now / 1000) - writtenAt > STALE_SEC;
  const p5h = numOrNull(data.fiveHourPct);
  const pweek = numOrNull(data.weeklyPct);
  return {
    p5h,
    pweek,
    resets5h: epochToIso(data.fiveHourReset),
    resetsWeek: epochToIso(data.weeklyReset),
    official: p5h != null || pweek != null,
    stale,
  };
}

function numOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function epochToIso(sec) {
  return typeof sec === "number" && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test test/rate-limits.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add host/src/rate-limits.js host/test/rate-limits.test.js
git commit -m "feat(usage): rate-limits.js 读官方 statusline usage.json"
```

---

### Task 2: usage-bridge.mjs（CC statusLine command）

**Files:**
- Create: `host/src/usage-bridge.mjs`
- Test: `host/test/usage-bridge.test.js`

- [ ] **Step 1: 写失败测试**（用子进程喂 stdin，验证写出的 usage.json）

`host/test/usage-bridge.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE = fileURLToPath(new URL("../src/usage-bridge.mjs", import.meta.url));

function run(stdinObj) {
  const out = mkdtempSync(join(tmpdir(), "cpb-bridge-"));
  const path = join(out, "cpb-usage.json");
  const res = spawnSync("node", [BRIDGE], {
    input: JSON.stringify(stdinObj),
    env: { ...process.env, CPB_USAGE_PATH: path },
    encoding: "utf8",
  });
  return { res, path };
}

test("extracts rate_limits and writes usage.json + prints statusline", () => {
  const { res, path } = run({
    rate_limits: {
      five_hour: { used_percentage: 9, resets_at: 1_750_003_600 },
      seven_day: { used_percentage: 52, resets_at: 1_750_086_400 },
    },
  });
  assert.equal(res.status, 0);
  const j = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(j.fiveHourPct, 9);
  assert.equal(j.weeklyPct, 52);
  assert.equal(j.fiveHourReset, 1_750_003_600);
  assert.equal(typeof j.writtenAt, "number");
  assert.match(res.stdout, /9%/); // statusline 一行含 5h%
});

test("missing rate_limits → nulls, still exit 0 (never crash CC)", () => {
  const { res, path } = run({ model: { display_name: "Sonnet" } });
  assert.equal(res.status, 0);
  const j = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(j.fiveHourPct, null);
  assert.equal(j.weeklyPct, null);
});

test("malformed stdin → exit 0, nulls", () => {
  const out = mkdtempSync(join(tmpdir(), "cpb-bridge-"));
  const path = join(out, "cpb-usage.json");
  const res = spawnSync("node", [BRIDGE], { input: "not json{", env: { ...process.env, CPB_USAGE_PATH: path }, encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).fiveHourPct, null);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test test/usage-bridge.test.js`
Expected: FAIL（bridge 不存在 / 非 0 退出）

- [ ] **Step 3: 最小实现**

`host/src/usage-bridge.mjs`:
```js
#!/usr/bin/env node
// Claude Code statusLine command. CC spawns this each update and pipes the
// session JSON (incl. rate_limits) on stdin. We extract official 5h/week usage,
// atomically write ~/.claude/cpb-usage.json for the buddy host to read, and
// print a one-line statusline so the user's status bar still shows something.
// MUST never throw — a crashing statusLine command degrades the CC UI.
import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

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
  mkdirSync(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify(out));
  renameSync(tmp, OUT);
} catch { /* never crash CC over a write failure */ }

const f = out.fiveHourPct == null ? "--" : `${Math.round(out.fiveHourPct)}%`;
const w = out.weeklyPct == null ? "--" : `${Math.round(out.weeklyPct)}%`;
process.stdout.write(`Buddy · 5h ${f} · wk ${w}`);
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test test/usage-bridge.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add host/src/usage-bridge.mjs host/test/usage-bridge.test.js
git commit -m "feat(usage): usage-bridge.mjs — CC statusLine 写官方 rate_limits"
```

---

### Task 3: usage.js 改造（ccusage 专注 cost/token，百分比让位 rate-limits）

**Files:**
- Modify: `host/src/usage.js`（`normalizeUsage` 的 percent 计算移除，`p5h/pweek/resets5h/resetsWeek` 输出 `null`；保留 `todayCost/todayTokens/weekTokens/activeTokens/todayPeriod`）
- Modify: `host/test/usage.test.js`（断言从"p5h==50"改为"p5h===null 且 cost/token 仍正确"）

**契约**：`normalizeUsage` 仍接收 `blocksJson/dailyJson`，仍 fail-closed（schema drift throw）；但不再算/不再需要 `budget5h/budgetWeek`，`p5h/pweek/resets5h/resetsWeek` 一律返回 `null`（百分比改由 rate-limits 提供）。`loadUsageSnapshot`/`usageForDisplay` 的降级结构保持不变（它们本就把 p5h 等设 null）。

- [ ] **Step 1: 改测试（先让它失败）**

`host/test/usage.test.js` 第一个测试（"normalizeUsage computes 5H%..."）改为只验证 cost/token，并断言 percent 已让位：
```js
test("normalizeUsage outputs cost/token and leaves percent null (rate-limits owns %)", () => {
  const lastDaily = dailyFixture.daily.at(-1);
  const weekTokens = dailyFixture.daily.slice(-7).reduce((s, d) => s + d.totalTokens, 0);
  const u = normalizeUsage({ blocksJson, dailyJson });

  assert.equal(u.p5h, null);
  assert.equal(u.pweek, null);
  assert.equal(u.resets5h, null);
  assert.equal(u.resetsWeek, null);
  assert.equal(u.todayTokens, lastDaily.totalTokens);
  assert.equal(u.todayCost, lastDaily.totalCost);
  assert.equal(u.weekTokens, weekTokens);
});
```
删掉/替换原"clamps percentages to 0..100"测试（percent 不再由此模块算）。保留"fail-closed on bad JSON / schema drift"（仍验 cost/token 路径 throw）、"loadUsageSnapshot fail-closes"、"usageForDisplay keeps last-known"。

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test test/usage.test.js`
Expected: FAIL（现 `normalizeUsage` 仍算 p5h=数值，断言 `null` 失败）

- [ ] **Step 3: 改 `normalizeUsage`**

`host/src/usage.js` 中：
- `normalizeUsage({ blocksJson, dailyJson })` 签名去掉 `budget5h/budgetWeek`。
- 返回对象的 `p5h/pweek/resets5h/resetsWeek` 改为 `null`；`modelled` 改为 `false`（百分比已非建模、且不再由此出，UI 的 modelled 标记由合并层按 official 决定）。
- 保留 `activeTokens/todayPeriod/todayTokens/todayCost/weekTokens/perType`。
- 删除现在不再被引用的 `percent()`/`nextWeeklyReset()`/`clampPct()` 辅助（YAGNI；若 `loadUsageSnapshot` 还引用 budget 参数也一并清掉）。
- `loadUsageSnapshot` 不再传 budget，调用 `normalizeUsage({ blocksJson, dailyJson })`。

关键返回片段（改后）：
```js
return {
  modelled: false,
  p5h: null,
  pweek: null,
  resets5h: null,
  resetsWeek: null,
  activeTokens,
  todayPeriod,
  todayTokens: numberField(today.totalTokens, "daily.totalTokens"),
  todayCost: numberField(today.totalCost, "daily.totalCost"),
  weekTokens,
  perType: {},
};
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test test/usage.test.js`
Expected: PASS（cost/token 路径 + fail-closed + display 降级）

- [ ] **Step 5: Commit**

```bash
git add host/src/usage.js host/test/usage.test.js
git commit -m "refactor(usage): ccusage 只出 cost/token, 百分比让位 rate-limits"
```

---

### Task 4: index.js 合并（rate-limits 官方% + ccusage cost/token）

**Files:**
- Modify: `host/src/index.js`（顶部 import `loadRateLimits`；`main()` 的 `tick()` 内合并）
- Test: `host/test/usage-merge.test.js`

**契约**：合并后 usage 对象 = ccusage 的 `{todayCost,todayTokens,...}` + rate-limits 覆盖的 `{p5h,pweek,resets5h,resetsWeek}` + `official`。`runOneTick`（注入 usage）不变，合并只发生在 `main()` 的 `tick()`。

- [ ] **Step 1: 写失败测试**（纯函数化合并，避免测 tick 的串口副作用）

先在 `index.js` 导出一个纯函数 `mergeUsage(ccusageUsage, rateLimits)`，测它：

`host/test/usage-merge.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeUsage } from "../src/index.js";

test("rate-limits 覆盖百分比/reset, ccusage 保留 cost/token", () => {
  const cc = { p5h: null, pweek: null, resets5h: null, resetsWeek: null, todayCost: 183.8, todayTokens: 186_000_000, modelled: false };
  const rl = { p5h: 9, pweek: 52, resets5h: "2026-06-09T14:09:59.000Z", resetsWeek: "2026-06-14T02:00:00.000Z", official: true, stale: false };
  const u = mergeUsage(cc, rl);
  assert.equal(u.p5h, 9);
  assert.equal(u.pweek, 52);
  assert.equal(u.resets5h, "2026-06-09T14:09:59.000Z");
  assert.equal(u.todayCost, 183.8);
  assert.equal(u.todayTokens, 186_000_000);
  assert.equal(u.official, true);
});

test("rate-limits 缺失时百分比为 null（UI 显示 --），cost/token 仍在", () => {
  const cc = { todayCost: 12.3, todayTokens: 1000, p5h: null, pweek: null };
  const rl = { p5h: null, pweek: null, resets5h: null, resetsWeek: null, official: false, stale: true };
  const u = mergeUsage(cc, rl);
  assert.equal(u.p5h, null);
  assert.equal(u.official, false);
  assert.equal(u.todayCost, 12.3);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test test/usage-merge.test.js`
Expected: FAIL（`mergeUsage` 未导出）

- [ ] **Step 3: 实现 `mergeUsage` + 接进 tick**

`host/src/index.js`:
- 顶部加 `import { loadRateLimits } from "./rate-limits.js";`
- 新增导出：
```js
export function mergeUsage(ccusageUsage, rateLimits) {
  return {
    ...ccusageUsage,
    p5h: rateLimits.p5h,
    pweek: rateLimits.pweek,
    resets5h: rateLimits.resets5h,
    resetsWeek: rateLimits.resetsWeek,
    official: rateLimits.official,
    rateStale: rateLimits.stale,
  };
}
```
- `main()` 的 `tick()` 内，把
```js
const usage = selected.usage;
```
改为
```js
const usage = mergeUsage(selected.usage, loadRateLimits());
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test test/usage-merge.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: 全量回归 + Commit**

```bash
cd host && node --test test/rate-limits.test.js test/usage-bridge.test.js test/usage.test.js test/usage-merge.test.js
git add host/src/index.js host/test/usage-merge.test.js
git commit -m "feat(usage): tick 合并官方 rate-limits 百分比 + ccusage cost/token"
```
Expected: 全 PASS。

---

### Task 5: statusLine 配置 + Mac 试运行端到端验证

**Files:**
- Create: `host/docs/usage-bridge-setup.md`（朋友 Windows + 本机 Mac 两套配置说明）
- 无代码改动，纯配置 + 真机验证

- [ ] **Step 1: 写配置文档**

`host/docs/usage-bridge-setup.md`，内容包含：
- **CC 版本要求**：`claude --version` ≥ 2.1.80。
- **Windows（朋友/产品）**：`C:\Users\<name>\.claude\settings.json` 加（路径用正斜杠避免 Git Bash 转义）：
  ```json
  { "statusLine": { "type": "command", "command": "node C:/Users/<name>/path/to/host/src/usage-bridge.mjs" } }
  ```
- **Mac（本机试运行）**：`~/.claude/settings.json` 同理指向本仓库 `host/src/usage-bridge.mjs`。
- **已有 statusline 共存警告**：若已配 claude-hud 等，此配置会**替换**它；如需保留，让 bridge 脚本内部再 spawn 原命令并拼接输出（plan 留作可选增强，默认替换）。
- **缺失说明**：`rate_limits` 仅 Pro/Max、会话首个 API 响应后出现；首次启动 CC 后发一条消息触发即可。

- [ ] **Step 2: Mac 配置 statusLine（备份现有）**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-cpb 2>/dev/null || true
```
然后按文档把 `statusLine.command` 指向本仓库绝对路径的 `host/src/usage-bridge.mjs`（若已有 statusLine 先记下原值）。

- [ ] **Step 3: 触发一次 statusline 写出 usage.json**

在本机 CC 里发一条消息（触发 statusLine + 首个 API 响应）。然后：
Run: `cat ~/.claude/cpb-usage.json`
Expected: 含 `fiveHourPct`/`weeklyPct`（数字，如 9/52）+ `writtenAt`。

- [ ] **Step 4: 重启 buddy 常驻验证官方%**

```bash
# 停旧常驻（查 PID）
pkill -x node 2>/dev/null || true   # 谨慎：仅当确认无其他关键 node；否则用精确 PID
cd host && CPB_ONCE=1 node src/index.js   # 或起常驻
curl -s http://127.0.0.1:8765/api/state | node -e 'const s=JSON.parse(require("fs").readFileSync(0));console.log("p5h",s.usage?.p5h,"pweek",s.usage?.pweek)'
```
Expected: `p5h`/`pweek` 显示官方值（如 9/52），**不再是 100/100**；dashboard 与设备屏左栏同步显示真实%。

- [ ] **Step 5: 恢复 + Commit 文档**

```bash
# 如需恢复原 statusline: cp ~/.claude/settings.json.bak-cpb ~/.claude/settings.json
git add host/docs/usage-bridge-setup.md
git commit -m "docs(usage): statusLine bridge 配置 + Mac 试运行验证步骤"
```

---

## Self-Review

**1. Spec 覆盖**（对照 spec §7）：
- 官方 5h/周% ← Task 1（rate-limits 读）+ Task 2（bridge 写）+ Task 4（合并）✓
- ccusage 保留 cost/token ← Task 3 ✓
- 缺失/stale 兜底 ← Task 1（null + stale）+ Task 2（never crash）✓
- Windows 配置 + Mac 试运行 ← Task 5 ✓
- 字段形状不变（渲染零改） ← 契约约束 + Task 3/4 保持字段名 ✓

**2. Placeholder 扫描**：无 TBD；所有新代码、测试给完整内容；改造点给关键片段 + 契约。Task 5 Step 4 的 `pkill -x node` 标注了谨慎（避免误杀，呼应项目"pkill 误伤"教训）——执行时用精确 PID 更稳。

**3. 类型一致性**：`loadRateLimits` 返回 `{p5h,pweek,resets5h,resetsWeek,official,stale}`（Task 1）↔ `mergeUsage` 消费同名字段（Task 4）↔ bridge 写 `{fiveHourPct,fiveHourReset,weeklyPct,weeklyReset,writtenAt}`（Task 2）↔ rate-limits 读同名（Task 1）。一致。`resets5h` ISO string 契约 ↔ `layout.js formatReset` 期望 string。一致。

修订：Task 5 Step 4 的 `pkill -x node` 风险已在 review 标注，执行时优先精确 PID（`lsof -nP -iTCP:8765 -sTCP:LISTEN` 找 PID 再 kill）。
