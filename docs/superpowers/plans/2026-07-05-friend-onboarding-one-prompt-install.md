# 朋友侧"一条指令安装" + 完整 Onboarding 体验 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **本项目实际执行方式（覆盖上一行）**：Claude Code 任 PM，逐任务经 skill(`codeagent`)（codex backend）派发实现；PM 亲自跑门禁。

**Goal:** 让拿到空白设备的 Windows 朋友只发一条指令给他的 Claude 即完成全部安装，并补全孵化后设备屏轻教程 + 玩家手册的新手体验。

**Architecture:** 固件不动（哑终端）；host 侧新增孵化后教程状态机（复用 oak 渲染 kind）并把落档时序改为"诞生即落档、教程完再补记"；新增跨平台 statusline fan-out wrapper；其余交付物全部是面向 agent 执行的 markdown 文档（README / SETUP-WINDOWS / PLAYER-GUIDE / 固件发布手册）。

**Tech Stack:** Node.js (ESM, node:test)、esptool v5（owner Mac 合并 bin / 朋友侧 Windows 独立 exe）、GitHub Releases、PowerShell（SETUP 文档内命令）。

**Spec:** `docs/specs/2026-07-05-friend-onboarding-one-prompt-install-design.md`（已过 codex 2 轮评审）。

## Global Constraints

- host 不得新增 npm 依赖（保持仅 `serialport` + `@napi-rs/canvas`）。
- 所有用户可见文案为简体中文；文档中命令必须完整可复制（无占位符时给出发现步骤）。
- 门禁命令：`cd host && node --test --test-concurrency=4`（并发必须锁 4）；`play-test.js` 的 "Cannot lock port" 属环境失败、非回归。
- 教程/存档字段语义（spec §4 第 4 幕）：诞生确认后**立即**落档 `hatched:true, tutorialDone:false` → 播教程 → 落 `tutorialDone:true`；仅显式 `false` 补播；老档缺字段不补播。
- `usage-bridge.mjs`、现有孵化流程 `runOnboarding` 的行为不得改变。
- 本 worktree 跑测试前置：`ln -s /Users/zeus/Projects/claude-pokemon-buddy/host/node_modules host/node_modules`（勿提交 symlink）。
- 提交信息遵循仓库惯例（`feat:`/`docs:`/`test:` 前缀，中文正文可）。

## File Structure（全景）

```
host/src/pet/onboarding-data.js      # +TUTORIAL_PAGES（教程文案，每页 ≤4 行）
host/src/pet/onboarding.js           # +runTutorial（复用 kind:"oak" 渲染，零渲染层改动）
host/src/index.js                    # runOnboardingGate 落档时序改造 + 调用点接线 tutorial
host/scripts/cpb-statusline-fanout.mjs  # 新增：跨平台 statusline fan-out（共存分支）
host/test/onboarding.test.js         # +runTutorial 用例
host/test/onboarding-gate.test.js    # +时序/补播用例
host/test/statusline-fanout.test.js  # 新增
README.md                            # 新增（仓库门面）
SETUP-WINDOWS.md                     # 新增（agent 化安装手册 + 指令正文 + 微信话术）
PLAYER-GUIDE.md                      # 新增（玩家手册，Claude 讲解底稿）
docs/firmware-release.md             # 新增（owner 固件发布手册）
docs/plans/BACKLOG.md                # 追加 P2 项
```

---

### Task 1: 教程文案数据 + runTutorial 状态机

**Files:**
- Modify: `host/src/pet/onboarding-data.js`
- Modify: `host/src/pet/onboarding.js`
- Test: `host/test/onboarding.test.js`（追加用例）

**Interfaces:**
- Consumes: 现有 `renderOnboarding`（`kind:"oak"` 场景接受 `{lines,page,total}`，每页 ≤4 行、居中 190+i*27 布局）；io 契约 `{push,nextButton,playSound,delay}`。
- Produces: `export const TUTORIAL_PAGES: string[][]`（onboarding-data.js）；`export async function runTutorial(io, { render = renderOnboarding } = {}): Promise<void>`（onboarding.js）——KEY 短按翻页、KEY 长按任意页跳过全部、BOOT/其它忽略。Task 2 依赖这两个导出名。

- [ ] **Step 1: 写失败测试**（追加到 `host/test/onboarding.test.js`，复用文件顶部已有的 `mockIo`）

```js
import { runTutorial } from "../src/pet/onboarding.js";
import { TUTORIAL_PAGES } from "../src/pet/onboarding-data.js";
// （import 合并进文件顶部现有 import 行）

test("runTutorial: KEY 短按逐页推进，推完所有页返回", async () => {
  const buttons = TUTORIAL_PAGES.map(() => ({ key: "KEY", kind: "short" }));
  const { io, pushed } = mockIo(buttons);
  await runTutorial(io);
  assert.equal(pushed.length, TUTORIAL_PAGES.length);
});

test("runTutorial: 第1页 KEY 长按 → 跳过全部，只推了1帧", async () => {
  const { io, pushed } = mockIo([{ key: "KEY", kind: "long" }]);
  await runTutorial(io);
  assert.equal(pushed.length, 1);
});

test("runTutorial: BOOT 被忽略不前进", async () => {
  const buttons = [{ key: "BOOT", kind: "short" }, ...TUTORIAL_PAGES.map(() => ({ key: "KEY", kind: "short" }))];
  const { io, pushed } = mockIo(buttons);
  await runTutorial(io);
  assert.equal(pushed.length, TUTORIAL_PAGES.length);
});

test("runTutorial 每页传 {kind:'oak', lines=该页文案, page, total}", async () => {
  const scenes = [];
  const buttons = TUTORIAL_PAGES.map(() => ({ key: "KEY", kind: "short" }));
  const { io } = mockIo(buttons);
  await runTutorial(io, { render: async (scene) => { scenes.push(scene); return Buffer.alloc(0); } });
  assert.equal(scenes.length, TUTORIAL_PAGES.length);
  scenes.forEach((scene, i) => {
    assert.equal(scene.kind, "oak");
    assert.deepEqual(scene.lines, TUTORIAL_PAGES[i]);
    assert.equal(scene.page, i + 1);
    assert.equal(scene.total, TUTORIAL_PAGES.length);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test --test-concurrency=4 test/onboarding.test.js`
Expected: FAIL（`runTutorial`/`TUTORIAL_PAGES` 未导出）

- [ ] **Step 3: 实现**

`host/src/pet/onboarding-data.js` 追加（文案已按真实按键语义核对：KEY 短按=招牌表演、KEY 长按=照顾 careCount、BOOT 日常无功能；每页 ≤4 行适配 oak 布局）：

```js
export const TUTORIAL_PAGES = [
  ["KEY 短按：打个招呼，", "它会给你表演。", "KEY 长按：摸摸头，", "悉心照顾它。"],
  ["屏幕左边的仪表盘，", "是你的 Claude 用量：", "上：5 小时额度", "下：每周额度"],
  ["它靠你的用量成长；", "冷落它会蔫、会退步，", "但永远救得回来。", "去吧，好好相处！"],
];
```

`host/src/pet/onboarding.js`：import 行加 `TUTORIAL_PAGES`，文件末尾追加：

```js
export async function runTutorial(io, { render = renderOnboarding } = {}) {
  for (let i = 0; i < TUTORIAL_PAGES.length; i += 1) {
    await io.push(await render({
      kind: "oak",
      lines: TUTORIAL_PAGES[i],
      page: i + 1,
      total: TUTORIAL_PAGES.length,
    }));
    if (await waitKeyOrSkip(io)) return;
  }
}

async function waitKeyOrSkip(io) {
  for (;;) {
    const b = await io.nextButton();
    if (b?.key === "KEY" && b.kind === "long") return true;
    if (b?.key === "KEY") return false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test --test-concurrency=4 test/onboarding.test.js`
Expected: PASS（全部，含既有用例）

- [ ] **Step 5: Commit**

```bash
git add host/src/pet/onboarding-data.js host/src/pet/onboarding.js host/test/onboarding.test.js
git commit -m "feat(onboarding): 孵化后设备屏轻教程 runTutorial（复用 oak 渲染）"
```

---

### Task 2: runOnboardingGate 落档时序改造 + 调用点接线

**Files:**
- Modify: `host/src/index.js`（`runOnboardingGate`，约 :546；调用点约 :263）
- Test: `host/test/onboarding-gate.test.js`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `runTutorial(io)`；现有 `loadState`/`saveState`/`makeNewborn`/`makeOnboardingIo`（同文件内已有）。
- Produces: `runOnboardingGate({ statePath, today, onboarding, tutorial, personalityRng })` 新增可选参 `tutorial: () => Promise<void>`（默认 no-op）。返回的存档含 `tutorialDone: true`。

- [ ] **Step 1: 写失败测试**（追加到 `host/test/onboarding-gate.test.js`）

```js
test("新孵化：教程开始前存档已是 hatched:true+tutorialDone:false；结束后 true", async () => {
  const statePath = join("out", "test-gate-tutorial.json");
  rmSync(statePath, { force: true });
  let midState = null;
  const result = await runOnboardingGate({
    statePath, today: "2026-07-05",
    onboarding: async () => ({ species: "eevee", name: "伊布" }),
    tutorial: async () => { midState = JSON.parse(readFileSync(statePath, "utf8")); },
    personalityRng: () => 0.5,
  });
  assert.equal(midState.hatched, true);
  assert.equal(midState.tutorialDone, false);   // 教程前已落档 → 断电不重孵化
  assert.equal(result.tutorialDone, true);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).tutorialDone, true);
});

test("hatched+tutorialDone:false（教程中断电）→ 只补播教程，不重孵化", async () => {
  const statePath = join("out", "test-gate-replay.json");
  rmSync(statePath, { force: true });
  writeFileSync(statePath, JSON.stringify({ hatched: true, species: "squirtle", level: 3, tutorialDone: false }));
  let onboardingCalled = false, tutorialCalled = false;
  const result = await runOnboardingGate({
    statePath, today: "2026-07-05",
    onboarding: async () => { onboardingCalled = true; return { species: "x", name: "x" }; },
    tutorial: async () => { tutorialCalled = true; },
  });
  assert.equal(onboardingCalled, false);
  assert.equal(tutorialCalled, true);
  assert.equal(result.species, "squirtle");     // 存档其余字段不丢
  assert.equal(result.level, 3);
  assert.equal(result.tutorialDone, true);
});

test("老存档（hatched 无 tutorialDone 字段）→ 不补播", async () => {
  const statePath = join("out", "test-gate-legacy.json");
  rmSync(statePath, { force: true });
  writeFileSync(statePath, JSON.stringify({ hatched: true, species: "umbreon", level: 9 }));
  let tutorialCalled = false;
  const result = await runOnboardingGate({
    statePath, today: "2026-07-05",
    onboarding: async () => ({ species: "x", name: "x" }),
    tutorial: async () => { tutorialCalled = true; },
  });
  assert.equal(tutorialCalled, false);
  assert.equal(result.species, "umbreon");
  assert.equal("tutorialDone" in result, false); // 老档不补写字段
});

test("hatched+tutorialDone:true → 都不调用", async () => {
  const statePath = join("out", "test-gate-done.json");
  rmSync(statePath, { force: true });
  writeFileSync(statePath, JSON.stringify({ hatched: true, species: "eevee", tutorialDone: true }));
  let called = 0;
  await runOnboardingGate({
    statePath, today: "2026-07-05",
    onboarding: async () => { called += 1; return { species: "x", name: "x" }; },
    tutorial: async () => { called += 1; },
  });
  assert.equal(called, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test --test-concurrency=4 test/onboarding-gate.test.js`
Expected: FAIL（`tutorialDone` 未实现 / tutorial 参数被忽略）

- [ ] **Step 3: 实现**（`host/src/index.js`，替换现有 `runOnboardingGate` 函数体）

```js
export async function runOnboardingGate({
  statePath,
  today = localYmd(new Date()),
  onboarding,             // 注入：() => Promise<{species,name}>（真实由 transport io 驱动）
  tutorial = async () => {}, // 注入：() => Promise<void>；诞生落档后播放
  personalityRng = Math.random,
}) {
  const existing = loadState(statePath);
  if (existing?.hatched) {
    if (existing.tutorialDone === false) return finishTutorial(statePath, existing, tutorial);
    return existing;
  }
  const { species, name } = await onboarding();
  mkdirSync(dirname(statePath), { recursive: true });
  // 诞生即落档（tutorialDone:false）→ 教程中断电也不会重孵化
  const newborn = { ...makeNewborn(species, name, today, personalityRng), tutorialDone: false };
  saveState(statePath, newborn);
  return finishTutorial(statePath, newborn, tutorial);
}

async function finishTutorial(statePath, pet, tutorial) {
  await tutorial();
  const done = { ...pet, tutorialDone: true };
  saveState(statePath, done);
  return done;
}
```

调用点（约 `host/src/index.js:263`，在现有 `onboarding:` 注入旁并列加 `tutorial:` 注入；`runTutorial` 加入文件顶部对 `./pet/onboarding.js` 的既有 import）：

```js
await runOnboardingGate({
  statePath,
  onboarding: async () => {
    const { io, off } = makeOnboardingIo(hostTransport);
    try { return await runOnboarding(io); } finally { off?.(); }
  },
  tutorial: async () => {
    const { io, off } = makeOnboardingIo(hostTransport);
    try { await runTutorial(io); } finally { off?.(); }
  },
});
```

（保留调用点原有的其它实参不动；只新增 `tutorial`。）

- [ ] **Step 4: 跑全量门禁**

Run: `cd host && node --test --test-concurrency=4`
Expected: 全绿（`play-test.js` 的 "Cannot lock port" 为环境失败可豁免）

- [ ] **Step 5: Commit**

```bash
git add host/src/index.js host/test/onboarding-gate.test.js
git commit -m "feat(onboarding): 诞生即落档+教程补播时序（tutorialDone 字段）"
```

---

### Task 3: 跨平台 statusline fan-out wrapper

**Files:**
- Create: `host/scripts/cpb-statusline-fanout.mjs`
- Test: `host/test/statusline-fanout.test.js`

**Interfaces:**
- Consumes: `host/src/usage-bridge.mjs`（stdin 进、写 `CPB_USAGE_PATH`/`~/.claude/cpb-usage.json`、stdout 出一行）。
- Produces: CLI `node cpb-statusline-fanout.mjs <original-command...>`——stdin 完整喂 bridge（丢弃其 stdout）与原 command（shell 方式执行，stdout 透传为本进程输出）；原 command 失败/缺省 → 退回 bridge 的一行输出；永不抛错、退出码恒 0。SETUP-WINDOWS.md（Task 6）的共存分支引用此用法。

- [ ] **Step 1: 写失败测试**（新建 `host/test/statusline-fanout.test.js`）

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FANOUT = new URL("../scripts/cpb-statusline-fanout.mjs", import.meta.url).pathname;
const INPUT = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 7 } } });

function run(args, input, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [FANOUT, ...args], { env: { ...process.env, ...env } },
      (error, stdout) => resolve({ code: error?.code ?? 0, stdout }));
    child.stdin.end(input);
  });
}

test("fan-out：bridge 写出 usage 文件，且原 command 的 stdout 原样透传", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cpb-fanout-"));
  const usagePath = join(dir, "cpb-usage.json");
  const original = `${process.execPath} -e "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('HUD-LINE'))"`;
  const { code, stdout } = await run([original], INPUT, { CPB_USAGE_PATH: usagePath });
  assert.equal(code, 0);
  assert.equal(stdout, "HUD-LINE");
  const usage = JSON.parse(readFileSync(usagePath, "utf8"));
  assert.equal(usage.fiveHourPct, 42);
  rmSync(dir, { recursive: true, force: true });
});

test("原 command 失败 → 退回 bridge 一行输出，usage 文件仍写出，退出码 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cpb-fanout-"));
  const usagePath = join(dir, "cpb-usage.json");
  const { code, stdout } = await run(["definitely-not-a-command-xyz"], INPUT, { CPB_USAGE_PATH: usagePath });
  assert.equal(code, 0);
  assert.match(stdout, /5h 42%/);
  assert.equal(JSON.parse(readFileSync(usagePath, "utf8")).weeklyPct, 7);
  rmSync(dir, { recursive: true, force: true });
});

test("无原 command 参数 → 直接输出 bridge 一行", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cpb-fanout-"));
  const usagePath = join(dir, "cpb-usage.json");
  const { code, stdout } = await run([], INPUT, { CPB_USAGE_PATH: usagePath });
  assert.equal(code, 0);
  assert.match(stdout, /wk 7%/);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test --test-concurrency=4 test/statusline-fanout.test.js`
Expected: FAIL（脚本不存在）

- [ ] **Step 3: 实现**（新建 `host/scripts/cpb-statusline-fanout.mjs`）

```js
#!/usr/bin/env node
// 跨平台 statusline fan-out：CC 的 statusline JSON 同时喂
//   1) buddy usage-bridge（写 cpb-usage.json，丢弃其单行输出）
//   2) 用户原有的 statusline command（stdout 透传，状态栏显示不变）
// 原 command 失败/缺省 → 退回 bridge 的一行。永不抛错（statusLine 崩溃会劣化 CC UI）。
// 用法：node cpb-statusline-fanout.mjs <原 statusline command 完整字符串>
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, "..", "src", "usage-bridge.mjs");
const original = process.argv.slice(2).join(" ").trim();

const input = await new Promise((resolve) => {
  let s = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => resolve(s));
  process.stdin.on("error", () => resolve(""));
});

const [bridgeOut, primaryOut] = await Promise.all([
  runChild(process.execPath, [BRIDGE], input, {}),
  original ? runChild(original, null, input, { shell: true }) : Promise.resolve(null),
]);

process.stdout.write(primaryOut?.ok ? primaryOut.stdout : bridgeOut.stdout);
process.exit(0);

function runChild(cmd, args, stdinText, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = args ? spawn(cmd, args, opts) : spawn(cmd, opts);
    } catch {
      resolve({ ok: false, stdout: "" });
      return;
    }
    let out = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (c) => (out += c));
    child.on("error", () => resolve({ ok: false, stdout: "" }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout: out }));
    child.stdin?.on("error", () => {});
    child.stdin?.end(stdinText);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test --test-concurrency=4 test/statusline-fanout.test.js`
Expected: PASS（3/3）

- [ ] **Step 5: Commit**

```bash
git add host/scripts/cpb-statusline-fanout.mjs host/test/statusline-fanout.test.js
git commit -m "feat(usage): 跨平台 statusline fan-out wrapper（Windows 共存分支）"
```

---

### Task 4: README.md（仓库门面）

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 无代码依赖；链接 Task 6 的 `SETUP-WINDOWS.md` 与 Task 5 的 `PLAYER-GUIDE.md`（先建文件引用即可，两文件由并行任务交付）。
- Produces: 仓库根 README；朋友的 Claude clone 后第一眼读到的导航。

- [ ] **Step 1: 写入以下完整内容**

```markdown
# Claude Pokémon Buddy

一台桌面小设备：**左半屏是你的 Claude 用量仪表盘，右半屏是一只用你的 Claude 用量"养"大的宝可梦**——会表演、会进化、几天不理会蔫（但永远救得回来）。单色 1-bit 反射屏，原生 GB 质感。

- 硬件：Waveshare **ESP32-S3-RLCD-4.2**（4.2" 反射屏 400×300、喇叭、温湿度、RTC、KEY/BOOT 两键、18650 电池、USB-C）
- 架构：**固件只是"笨显示器"**（收帧/回按键/放音），全部逻辑与存档在电脑侧 Node host（Windows/Mac）
- 数据源：Claude Code 官方 statusline `rate_limits`（5h/周额度）+ ccusage（费用/token）

## 我收到了这台设备，怎么装？

把 [`SETUP-WINDOWS.md`](SETUP-WINDOWS.md) 交给你的 Claude 执行——它是写给 Claude 的安装手册，从零环境到屏幕亮起全自动。手册顶部有可以直接转发的那条指令。

装好后想了解怎么玩：[`PLAYER-GUIDE.md`](PLAYER-GUIDE.md)（也可以让你的 Claude 讲给你听）。

## 开发（owner）

- host：`cd host && npm install && node src/index.js`（无板时自动 mock，输出 `out/frame.png`）
- 测试：`cd host && node --test --test-concurrency=4`
- 固件：ESP-IDF 项目在 `firmware/`；发布流程见 [`docs/firmware-release.md`](docs/firmware-release.md)
- 设计文档：`docs/specs/`（自 2026-05-30 起的全部设计与增量修订）

## 声明

粉丝作品（fan project），非商业、不出售、与任天堂/宝可梦公司无关；仓库不含任何官方 ROM/游戏资产。Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc.
```

- [ ] **Step 2: 验证**

Run: `test -f README.md && head -3 README.md`
Expected: 输出标题行

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: 仓库 README（导航 + 声明）"
```

---

### Task 5: PLAYER-GUIDE.md（玩家手册 / Claude 讲解底稿）

**Files:**
- Create: `PLAYER-GUIDE.md`

**Interfaces:**
- Consumes: 已核实的按键/机制事实（KEY 短按=招牌表演、进化待确认时任意 KEY 按下=确认进化、KEY 长按=照顾 careCount+1、BOOT 日常无功能；bond 从 0、约 2 周首进化；dashboard `127.0.0.1:8765`）。
- Produces: SETUP-WINDOWS.md（Task 6）末步引用的讲解底稿。

- [ ] **Step 1: 写入以下完整内容**

```markdown
# 玩家手册（PLAYER-GUIDE）

> 给 Claude 的指示：主人让你讲解本手册时，请用大木博士的口吻、按章节顺序讲，讲完问一句"还有什么想问的吗"。不要剧透"彩蛋"章节之外的隐藏内容。

## 1. 两个按键

| 操作 | 效果 |
|---|---|
| **KEY 短按** | 打招呼——它会给你表演招牌动作（每只宝可梦不一样） |
| **KEY 长按** | 摸摸头/照顾——它会记住你的悉心照料（影响某些成长方向） |
| **KEY（当屏幕提示进化时）** | 确认进化 |
| **BOOT** | 日常没有功能（那是维修/刷机按钮，别管它） |

## 2. 它怎么长大

- 它吃的是**你的 Claude 用量**：你用 Claude 越多，它经验涨得越快。
- **亲密度从 0 开始**，天天见面稳步上涨；大约 **2 周**迎来第一次进化。
- 进化路线和你相处的方式有关——温度、时间、照顾方式都可能留下痕迹。**不剧透，自己养养看。**

## 3. 冷落了它会怎样

- 几天不用 Claude / 不理它：它会**蔫**，亲密度回落，长期会**退化**。
- 但**永远没有 Game Over**：回来继续相处，一切都救得回来。连续陪伴还有护盾。

## 4. 左半屏仪表盘

- 上条：**5 小时**额度用量；下条：**每周**额度用量（来自 Claude Code 官方数据）。
- 显示 `--` = 暂无数据（比如刚开机还没发过消息，或订阅档位不含额度数据）。
- 下方小字：今日费用/token（ccusage 统计）。

## 5. 电脑上的图鉴（dashboard）

浏览器打开 `http://127.0.0.1:8765`（host 运行时）：

- 看它的完整状态（等级/亲密/性格）；
- **改名字**：设置里改（默认名"阿布"）；
- 调音量、安静时段。

## 6. 常见问题

- **拔掉 USB 会怎样？** 设备断电休眠；进度都存在电脑上，**不会丢**。插回去几秒内自动恢复。
- **电脑重启/睡醒会怎样？** host 开机自启 + 自动重连，不用管。
- **屏幕不动了？** 先拔插一次 USB；还不行，把仓库里的 `SETUP-WINDOWS.md` 排障章节发给你的 Claude。
- **想换一只重新养？** 可以，但要跟送你设备的人聊聊（存档在电脑上，删档重开是不可逆的）。

## 7. 彩蛋

有。不剧透。是老玩家就会遇到。
```

- [ ] **Step 2: 验证**

Run: `test -f PLAYER-GUIDE.md && grep -c "^## " PLAYER-GUIDE.md`
Expected: `7`

- [ ] **Step 3: Commit**

```bash
git add PLAYER-GUIDE.md
git commit -m "docs: 玩家手册 PLAYER-GUIDE（Claude 讲解底稿）"
```

---

### Task 6: SETUP-WINDOWS.md（agent 化安装手册，核心交付物）

**Files:**
- Create: `SETUP-WINDOWS.md`

**Interfaces:**
- Consumes: Task 3 的 fan-out 用法（共存分支）；Task 5 的 PLAYER-GUIDE.md（末步讲解）；`host/docs/usage-bridge-setup.md`（bridge 原理）；固件 Release 资产名 `cpb-firmware-merged.bin`（tag `fw-v1`，见 Task 7）。
- Produces: 朋友的 Claude 端到端执行的安装手册 + 顶部权威版"那条指令"与微信话术。

- [ ] **Step 1: 写入以下完整内容**

````markdown
# SETUP-WINDOWS.md — 写给 Claude 的安装手册

> **如果你是人类**：把下面"发给 Claude 的指令"原样发给你的 Claude Code 就行，剩下交给它。
>
> **发给 Claude 的指令（复制这段）**：
> 请打开并严格执行 https://raw.githubusercontent.com/aquamarinz/claude-pokemon-buddy/main/SETUP-WINDOWS.md —— 这是一份写给你（Claude）的安装手册。我桌上有一台连着 USB 的宝可梦小设备，请按手册把它从零装好，每一步都要跑手册里的验证命令确认成功再继续。
>
> **送礼人转发话术**：送你的小设备到了！它是一只用你的 Claude 用量养大的宝可梦。用 USB **数据线**把它连上电脑，然后把上面那段指令原样发给你的 Claude Code。

---

## 0. 给 Claude 的执行契约（先读这节）

1. **逐步执行**：每步跑完"验证"命令、确认符合预期输出才进入下一步。
2. **失败先走该步的"失败分支"**，分支穷尽后再自行诊断；连续两次无法推进 → 停下向主人清晰描述卡点。
3. 需要主人动手（按设备按键、拔插线、确认屏幕）时，用一句人话明确说"请你……"。
4. 除第 5 步问城市外，**不要问不必要的问题**。
5. 全程 PowerShell；工作目录约定 `$HOME\claude-pokemon-buddy`。

## 1. 环境自举

```powershell
winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
```

**装完开一个新的 PowerShell 会话**（刷新 PATH），验证：

```powershell
git --version; node --version; claude --version
```

预期：三个都出版本号；`claude` ≥ **2.1.80**（低于则先让主人升级 Claude Code）。
失败分支：winget 被组织策略禁用 → 改用官方安装包（git-scm.com / nodejs.org）下载安装后重试验证。

下载 esptool（官方 Windows 独立 exe，免 Python）：

```powershell
$asset = (Invoke-RestMethod https://api.github.com/repos/espressif/esptool/releases/latest).assets |
  Where-Object name -like '*win64*' | Select-Object -First 1
Invoke-WebRequest $asset.browser_download_url -OutFile "$HOME\esptool-win64.zip"
Expand-Archive "$HOME\esptool-win64.zip" -DestinationPath "$HOME\esptool" -Force
$esptool = (Get-ChildItem "$HOME\esptool" -Recurse -Filter esptool.exe | Select-Object -First 1).FullName
& $esptool version
```

预期：输出 esptool 版本号（v5+）。

## 2. 取码 + 装依赖

```powershell
cd $HOME
git clone https://github.com/aquamarinz/claude-pokemon-buddy.git
cd claude-pokemon-buddy\host
npm install
npm ls --depth=0
```

预期：`npm ls` 列出 `serialport` 与 `@napi-rs/canvas`，无 `ERR`。
失败分支：公司代理导致 npm 超时 → `npm config set registry https://registry.npmmirror.com` 后重试。

## 3. 烧录固件（设备此时是空白的，屏幕不亮属正常）

**3a. 烧前预检**——找到设备的 COM 口：

```powershell
Get-PnpDevice -Class Ports -Status OK | Where-Object InstanceId -match 'VID_303A'
```

预期：一行 `USB 串行设备 (COMx)`。记下 `COMx`。
失败分支（按顺序试）：
- a) 什么都没有 → 大概率是**充电线**（无数据芯）。请主人换一条 USB **数据线**、换一个 USB 口，重跑预检。
- b) 设备管理器里有带叹号的未知设备 → 按 Espressif 官方 USB-Serial/JTAG 驱动指引安装驱动后重试（Win10/11 通常免驱）。
- c) 仍无 → **手动进下载模式**。注意：**设备装了电池，拔 USB 不等于断电**。请主人：把设备背面电池电源开关拨到 OFF → 按住 **BOOT** 键不放 → 插上 USB（或拨回 ON 上电）→ 松开。重跑预检。

**3b. 下载固件并烧录**（把 `COMx` 换成预检结果）：

```powershell
cd $HOME\claude-pokemon-buddy
Invoke-WebRequest https://github.com/aquamarinz/claude-pokemon-buddy/releases/latest/download/cpb-firmware-merged.bin -OutFile cpb-firmware-merged.bin
& $esptool --chip esp32s3 --port COMx write-flash 0x0 cpb-firmware-merged.bin
```

预期：输出含 **`Hash of data verified`**。烧完设备自动重启，屏幕出现待机画面。
失败分支：串口被占用（`could not open port`）→ 关掉占用程序（常见：其它串口工具/上次残留的 node 进程 `Get-Process node | Stop-Process`）；写入中途失败 → 走 3a-c 手动下载模式流程再烧一次；再失败 → 停下报告主人。

## 4. 接通 Claude 用量数据（statusline bridge）

读 `$HOME\.claude\settings.json`（不存在则视为空 `{}`）：

- **没有 `statusLine` 字段（预期情况）**：merge 写入（**保留文件里其它字段**，路径用正斜杠）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/<用户名>/claude-pokemon-buddy/host/src/usage-bridge.mjs"
  }
}
```

- **已有 `statusLine`**：先把原文件备份为 `settings.json.bak`，再把原 command 接到 fan-out 后面（原状态栏显示不变）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Users/<用户名>/claude-pokemon-buddy/host/scripts/cpb-statusline-fanout.mjs <原来的 command 字符串>"
  }
}
```

验证：`Get-Content $HOME\.claude\settings.json | ConvertFrom-Json` 不报错。

## 5. 个性化（唯一需要提问的一步）

问主人："你在哪个城市？（用于屏幕上的天气）"，把城市换算成经纬度，写入 `$HOME\claude-pokemon-buddy\host\config.json`：

```json
{ "lat": <纬度>, "lon": <经度> }
```

（其它字段走默认；名字默认"阿布"，主人以后可在 dashboard 改。）

## 6. 开机自启

写 `$HOME\claude-pokemon-buddy\start-buddy.vbs`（把 `<用户名>` 替换为真实用户名）：

```vbscript
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\<用户名>\claude-pokemon-buddy\host"
sh.Run "cmd /c node src\index.js >> out\host-autostart.log 2>&1", 0, False
```

复制进 Startup 文件夹并**实测一次**：

```powershell
Copy-Item "$HOME\claude-pokemon-buddy\start-buddy.vbs" "$([Environment]::GetFolderPath('Startup'))"
Get-Process node -ErrorAction SilentlyContinue | Stop-Process   # 清掉手动起的实例
wscript "$HOME\claude-pokemon-buddy\start-buddy.vbs"
Start-Sleep 8; Get-Process node                                  # 预期：node 进程存在
```

预期：`Get-Process node` 有输出，且**屏幕出现画面**（问主人确认）。

## 7. 端到端验证

1. 屏幕有画面（第 6 步已确认）。
2. 请主人在 Claude Code 里**随便发一条消息**，然后：

```powershell
Get-Content $HOME\.claude\cpb-usage.json
```

预期：JSON 含 `writtenAt`，且 `fiveHourPct`/`weeklyPct` 是**数字**。
若是 `null`：问主人订阅档位——Pro/Max 才有官方额度数据；是 Pro/Max 就再发一条消息重查；不是也没关系（屏上显示 `--`，养成不受影响），继续。
3. 请主人**短按一下设备右侧 KEY 键**，确认屏幕有反应。

## 8. 交接仪式（最后一步）

对主人说安装完成，然后：**用大木博士的口吻，把仓库里的 `PLAYER-GUIDE.md` 讲给主人听**（按手册第一行的指示讲）。设备屏幕此刻应该正在等主人选蛋——让他跟着屏幕指引，开始孵化。

## 排障速查（装完以后出问题看这里）

| 症状 | 处理 |
|---|---|
| 屏幕不动/黑屏 | 拔插 USB（host 会 ~2s 自动重连）；不行则重启电脑（自启会拉起） |
| 用量一直 `--` | 在 Claude Code 发一条消息触发 statusline；检查 `settings.json` 的 statusLine 配置还在 |
| 换了电脑/重装系统 | 重新把顶部那条指令发给 Claude 即可（存档在 `host\out\state.json`，记得先备份拷走） |
````

- [ ] **Step 2: 验证**

Run: `test -f SETUP-WINDOWS.md && grep -c "^## " SETUP-WINDOWS.md`
Expected: `10`（0-8 节 + 排障速查）

- [ ] **Step 3: Commit**

```bash
git add SETUP-WINDOWS.md
git commit -m "docs: agent 化 Windows 安装手册 SETUP-WINDOWS（含指令正文+微信话术）"
```

---

### Task 7: 固件发布手册 + BACKLOG 追加

**Files:**
- Create: `docs/firmware-release.md`
- Modify: `docs/plans/BACKLOG.md`（文件末尾追加一节）

**Interfaces:**
- Consumes: `firmware/` ESP-IDF 工程；esptool v5（owner Mac）。
- Produces: owner 手动发布流程（SETUP-WINDOWS.md 第 3b 步依赖 Release 资产名 `cpb-firmware-merged.bin`）。

- [ ] **Step 1: 写入 `docs/firmware-release.md` 完整内容**

````markdown
# 固件发布手册（owner，Mac）

朋友侧安装依赖 GitHub Release 的预编译合并固件。固件极少变更，流程手动执行（YAGNI，不建 CI）。

## 1. 构建

```bash
cd firmware
idf.py build
```

## 2. 合并为单文件（0x0 起烧）

```bash
cd build
esptool --chip esp32s3 merge-bin -o cpb-firmware-merged.bin @flash_args
```

> `flash_args` 是 idf.py build 生成的烧录参数清单（含 bootloader/分区表/app 的偏移），merge-bin 直接消费它，偏移永不手抄。

## 3. 空白态实测（发布前必做）

```bash
esptool --chip esp32s3 --port /dev/cu.usbmodem1301 erase-flash
esptool --chip esp32s3 --port /dev/cu.usbmodem1301 write-flash 0x0 cpb-firmware-merged.bin
```

预期：`Hash of data verified`；设备重启后屏幕出待机画面；host 连上后功能正常（注意先停本机 host 释放串口）。

## 4. 发布

```bash
gh release create fw-v1 firmware/build/cpb-firmware-merged.bin \
  --title "Firmware v1" \
  --notes "目标板：Waveshare ESP32-S3-RLCD-4.2。烧录：esptool --chip esp32s3 --port COMx write-flash 0x0 cpb-firmware-merged.bin"
```

> SETUP-WINDOWS.md 用 `releases/latest/download/cpb-firmware-merged.bin` 固定 URL 取**最新** Release 的同名资产——资产文件名必须保持 `cpb-firmware-merged.bin` 不变；后续版本换 tag（fw-v2…）即可。
````

- [ ] **Step 2: 在 `docs/plans/BACKLOG.md` 末尾追加**

```markdown
## 分发/运维（2026-07-05 onboarding spec 遗留，P2）

- [ ] host 崩溃自愈 supervisor / 托盘程序 / 单 exe 打包（原 spec §241 遗留）
- [ ] 后续更新机制（agent 化 UPDATE.md：git pull + 依赖刷新 + 重启；或自动更新）
- [ ] 网页烧录器（ESP Web Tools）作为非 Claude 用户的备选安装路径
- [ ] R2 评审 Medium 沉淀：SETUP 各失败分支随真实案例持续扩充
```

- [ ] **Step 3: 验证**

Run: `grep -c "cpb-firmware-merged.bin" docs/firmware-release.md SETUP-WINDOWS.md`
Expected: 两文件计数均 ≥2（资产名一致）

- [ ] **Step 4: Commit**

```bash
git add docs/firmware-release.md docs/plans/BACKLOG.md
git commit -m "docs: 固件发布手册 + BACKLOG 追加分发运维 P2 项"
```

---

### Task 8: Owner 手动操作检查单（发布日执行，非 codeagent 任务）

**Files:** 无代码变更；GitHub / 硬件操作。

**Interfaces:**
- Consumes: Task 1-7 全部合入 main 后执行。
- Produces: 公开仓库 + `fw-v1` Release + Windows 实测通过 = "那条指令"可用。

- [ ] **Step 1: 敏感信息历史扫查**

```bash
brew install gitleaks
cd /Users/zeus/Projects/claude-pokemon-buddy
gitleaks git . --no-banner
git log --all -p | grep -inE "api[_-]?key|token|passw|secret" | head -50   # 人工抽查兜底
```

Expected: gitleaks 无 finding；人工抽查无真实凭据。发现问题 → 先处理再公开（必要时 filter-repo 重写历史）。

- [ ] **Step 2: 转公开**

```bash
gh repo edit aquamarinz/claude-pokemon-buddy --visibility public --accept-visibility-change-consequences
curl -sI https://raw.githubusercontent.com/aquamarinz/claude-pokemon-buddy/main/SETUP-WINDOWS.md | head -1
```

Expected: `HTTP/2 200`（匿名可取 SETUP 文档 = 指令 URL 生效）。

- [ ] **Step 3: 按 `docs/firmware-release.md` 构建、空白态实测、发布 `fw-v1`**

Expected: `gh release view fw-v1` 列出 `cpb-firmware-merged.bin`；自有板 erase-flash 后用 Release 资产烧录复活。

- [ ] **Step 4: Windows 实测 SETUP-WINDOWS.md**

在 owner 的 Windows 部署机上逐步跑第 1-7 节验证命令（板子借回或用第 3 步已烧的板验证 3a 预检即可）；第 3a-c 的"电池开关/BOOT/RESET 组合"以实机为准，如与文档不符**当场修订 SETUP-WINDOWS.md 并提交**。

- [ ] **Step 5: 端到端彩排（可选但强烈建议）**

找一个干净 Windows 用户账户，只发"那条指令"，观察 Claude 能否无人工兜底走完第 1-8 节。卡点回填 SETUP 失败分支。

---

## Self-Review 记录

- **Spec 覆盖**：§4 七幕 → 幕0=Task 7/8、幕1-2=Task 6、幕3=零改动、幕4=Task 1/2、幕5=Task 5/6、幕6=Task 6 第6节；§5 交付物表 7 项全部有对应 Task；§6 测试要求 → Task 1/2/3 的用例一一映射（教程时序 4 用例、fanout 3 用例）；§7 风险 → README 声明（IP）、SETUP 共存分支（statusline）、第 7 节受控 null（rate_limits）、失败分支（Windows 差异）、Task 8 Step 4（esptool 命令实测锁定）。
- **占位符扫描**：文档内 `<用户名>`/`COMx`/`<纬度>` 是**给执行 Claude 的替换指引**（配有发现步骤），非计划占位符；无 TBD/TODO。
- **类型一致性**：`TUTORIAL_PAGES`/`runTutorial`/`tutorialDone`/`cpb-statusline-fanout.mjs`/`cpb-firmware-merged.bin` 命名在 Task 1-8 间交叉引用一致。
