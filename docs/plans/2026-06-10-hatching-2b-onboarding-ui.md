# 孵化 2b：onboarding UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。派发走 codeagent CLI `--backend claude`（铁律#2；codex block 到 2026-06-11，用户授权暂用 claude backend）。每 task TDD：写失败测试 → 验证失败 → 最小实现 → 验证通过 → commit。**测试用 `--test-concurrency=1 --test-force-exit`**（Node 25 多文件并发抢 inspect-port + 串口 handle 泄漏，已知环境问题）。

**Goal:** 设备屏闭环孵化 onboarding——首次开机（无 hatched）依次走：大木开场白 → 选蛋（4 蛋缩略：伊布+御三家，KEY 切换/长按确认）→ 孵化动画 → 诞生+默认名 → 进日常养成；顺带修 main stop 不 close 串口的既有 bug。

**Architecture:** `render/onboarding.js`（各屏 canvas→bitmap，复用 frame.js helper + mockup 08 画法）+ `pet/onboarding.js`（`runOnboarding(io)` async 状态机，io 抽象隔离 transport 便于单测）+ `pet/onboarding-data.js`（候选池+大木文本）+ `index.js` main onboarding gate（无 hatched → runOnboarding → 写 newborn state）+ serial close fix。视觉定稿 = `mockups/08-onboarding-hatching.html`。

**Tech Stack:** @napi-rs/canvas、transport `onButton/push/playSound`、node:test。

**关键设计——io 抽象（可测核心）:** 状态机不直接碰 transport，而是依赖 `io = { push(frame), nextButton(), playSound(id), delay(ms) }`。main 用真实 transport 构造 io；测试注入 mock io（预设按键序列 + 记录 push/sound）。这样交互逻辑纯单测，无需真机。

---

### Task 1: render/onboarding.js — onboarding 各屏渲染

**Files:**
- Modify: `host/src/render/frame.js`（提取并导出 `imageDataToFrame(image)`，`renderFrame` 复用它——DRY）
- Create: `host/src/render/onboarding.js`
- Test: `host/test/onboarding-render.test.js`

**契约**：`renderOnboarding(scene)` → `{ pngBuffer, bitmap }`（bitmap.w=400 / bitmap.h=300），与 `renderFrame` 同形状，可直接喂 `transport.push`。`scene.kind ∈ {oak, choose, hatch, born}`。画法参考 `mockups/08-onboarding-hatching.html`（egg/smallEgg/critter/文本布局）+ `layout.js`（Zpix 字体、INK/PAPER、px 文本）。

- [ ] **Step 1: 写失败测试**

`host/test/onboarding-render.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOnboarding } from "../src/render/onboarding.js";

for (const scene of [
  { kind: "oak", lines: ["……这个世界，", "生活着宝可梦。"] },
  { kind: "choose", candidates: [{ species: "eevee", name: "伊布" }, { species: "bulbasaur", name: "妙蛙种子" }], sel: 1 },
  { kind: "hatch", frame: 2 },
  { kind: "born", species: "eevee", name: "伊布" },
]) {
  test(`renderOnboarding(${scene.kind}) → 400x300 bitmap, no throw`, async () => {
    const { pngBuffer, bitmap } = await renderOnboarding(scene);
    assert.equal(bitmap.w, 400);
    assert.equal(bitmap.h, 300);
    assert.ok(pngBuffer && pngBuffer.length > 0);
  });
}
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test --test-force-exit test/onboarding-render.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`host/src/render/frame.js`：把现有 `renderFrame` 里 `rgbaToGray → grayToBitmap → bitmapToPng` 的尾段提取为导出函数，`renderFrame` 改为调用它：
```js
export async function imageDataToFrame(image) {
  const gray = rgbaToGray(image.data, W, H);
  const bitmap = grayToBitmap(gray, W, H);
  const pngBuffer = await bitmapToPng(bitmap);
  return { pngBuffer, bitmap };
}
```
（`renderFrame` 改为 `const image = drawGray(model); return imageDataToFrame(image);`。`rgbaToGray`/`bitmapToPng` 保持模块内。）

`host/src/render/onboarding.js`：
```js
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { W, H, INK, PAPER } from "./palette.js";
import { imageDataToFrame, ZPIX_REGISTERED } from "./frame.js"; // 见下注
// 复用 layout.js 已注册的 Zpix 字体（import layout.js 触发注册，或直接 registerFromPath）

const MONO = '"Zpix"';
function px(g, t, x, y, size, align = "left", weight = 700) {
  g.font = `${weight} ${size}px ${MONO}`; g.textAlign = align; g.textBaseline = "alphabetic"; g.fillText(t, x, y);
}

export async function renderOnboarding(scene) {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = 2;
  g.strokeRect(6, 6, W - 12, H - 12); // 边框
  if (scene.kind === "oak") drawOak(g, scene.lines);
  else if (scene.kind === "choose") drawChoose(g, scene.candidates, scene.sel);
  else if (scene.kind === "hatch") drawHatch(g, scene.frame);
  else if (scene.kind === "born") drawBorn(g, scene.species, scene.name);
  return imageDataToFrame(g.getImageData(0, 0, W, H));
}
```
`drawOak/drawChoose/drawHatch/drawBorn` 按 mockup 08 的对应 scene 画（egg/smallEgg/critter/px 文本）。**字体注册**：`onboarding.js` 顶部 `import "./layout.js"`（layout.js 顶层已 `GlobalFonts.registerFromPath(ZPIX_FONT_PATH,"Zpix")`），或直接复用 `layout.js` 导出的 `ZPIX_FONT_PATH` 自行注册一次。`drawHatch(g, frame)` 用 `frame`(0..N) 控制蛋摇晃/裂纹/裂开阶段；`HATCH_FRAMES` 总帧数（如 6）由 onboarding.js 实现内部决定。`drawBorn` 画 critter 占位剪影（真实 sprite 后续接 `loadBuddySprite`，本期占位）。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test --test-force-exit test/onboarding-render.test.js`
Expected: PASS（4 scene）

- [ ] **Step 5: Commit**

```bash
git add host/src/render/frame.js host/src/render/onboarding.js host/test/onboarding-render.test.js
git commit -m "feat(onboarding): render/onboarding.js — 各屏 1-bit 渲染(复用 frame helper)"
```

---

### Task 2: 候选数据 + runOnboarding 状态机

**Files:**
- Create: `host/src/pet/onboarding-data.js`（CANDIDATES + OAK_LINES）
- Create: `host/src/pet/onboarding.js`（`runOnboarding(io)`）
- Test: `host/test/onboarding.test.js`

**契约**：`runOnboarding(io)` → `{ species, name }`。io = `{ push(frame), nextButton()→Promise<{key,kind}>, playSound(id), delay(ms) }`。流程：大木翻页（每页等一次 KEY）→ 选蛋（KEY short 切候选、KEY long 确认）→ 孵化动画（逐帧 push + delay）+ playSound → 诞生（等 KEY）→ return。

- [ ] **Step 1: 写失败测试**

`host/test/onboarding.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOnboarding } from "../src/pet/onboarding.js";
import { OAK_LINES, CANDIDATES } from "../src/pet/onboarding-data.js";

function mockIo(buttons) {
  let i = 0;
  const pushed = [], sounds = [];
  return {
    pushed, sounds,
    io: {
      push: async (f) => { pushed.push(f); },
      nextButton: async () => buttons[i++],
      playSound: (id) => sounds.push(id),
      delay: async () => {},
    },
  };
}

test("oak 翻页 + 切到第2候选 + 长按确认 + 诞生 → 返回该候选", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [
    ...oak,                              // 大木每页一次 KEY
    { key: "KEY", kind: "short" },       // 选蛋:切到 sel=1
    { key: "KEY", kind: "long" },        // 确认
    { key: "KEY", kind: "short" },       // 诞生屏:开始
  ];
  const { io, sounds } = mockIo(buttons);
  const r = await runOnboarding(io);
  assert.equal(r.species, CANDIDATES[1].species);
  assert.equal(r.name, CANDIDATES[1].name);
  assert.ok(sounds.length >= 1); // 播了孵化音
});

test("不切换直接确认 → 返回第1候选(伊布)", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [...oak, { key: "KEY", kind: "long" }, { key: "KEY", kind: "short" }];
  const { io } = mockIo(buttons);
  const r = await runOnboarding(io);
  assert.equal(r.species, "eevee");
});

test("BOOT/非KEY 在选蛋阶段被忽略，不前进", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [...oak, { key: "BOOT", kind: "short" }, { key: "KEY", kind: "long" }, { key: "KEY", kind: "short" }];
  const { io } = mockIo(buttons);
  const r = await runOnboarding(io);
  assert.equal(r.species, "eevee"); // BOOT 没切换，仍 sel=0
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test --test-force-exit test/onboarding.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`host/src/pet/onboarding-data.js`:
```js
export const CANDIDATES = [
  { species: "eevee", name: "伊布" },
  { species: "bulbasaur", name: "妙蛙种子" },
  { species: "charmander", name: "小火龙" },
  { species: "squirtle", name: "杰尼龟" },
];

export const OAK_LINES = [
  "……这个世界，",
  "生活着被称为「宝可梦」的",
  "神奇生物。",
  "今天，一颗蛋交到了你手上。",
];
```

`host/src/pet/onboarding.js`:
```js
import { renderOnboarding } from "../render/onboarding.js";
import { CANDIDATES, OAK_LINES } from "./onboarding-data.js";
import { SOUND } from "../transport/proto.js";

const HATCH_FRAMES = 6;
const HATCH_FRAME_MS = 220;

export async function runOnboarding(io) {
  // 大木开场白：逐页累积，每页等一次 KEY
  for (let page = 1; page <= OAK_LINES.length; page += 1) {
    await io.push(await renderOnboarding({ kind: "oak", lines: OAK_LINES.slice(0, page) }));
    await waitKey(io);
  }

  // 选蛋：KEY short 切换、KEY long 确认
  let sel = 0;
  await io.push(await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel }));
  for (;;) {
    const b = await io.nextButton();
    if (b?.key === "KEY" && b.kind === "long") break;
    if (b?.key === "KEY") {
      sel = (sel + 1) % CANDIDATES.length;
      await io.push(await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel }));
    }
    // BOOT / 其它：忽略
  }
  const chosen = CANDIDATES[sel];

  // 孵化动画 + 音
  for (let f = 0; f < HATCH_FRAMES; f += 1) {
    await io.push(await renderOnboarding({ kind: "hatch", frame: f }));
    await io.delay(HATCH_FRAME_MS);
  }
  io.playSound(SOUND.EVOLVE); // 复用进化 fanfare 作孵化音

  // 诞生
  await io.push(await renderOnboarding({ kind: "born", species: chosen.species, name: chosen.name }));
  await waitKey(io);

  return { species: chosen.species, name: chosen.name };
}

async function waitKey(io) {
  for (;;) {
    const b = await io.nextButton();
    if (b?.key === "KEY") return;
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test --test-force-exit test/onboarding.test.js`
Expected: PASS（3 个）

- [ ] **Step 5: Commit**

```bash
git add host/src/pet/onboarding.js host/src/pet/onboarding-data.js host/test/onboarding.test.js
git commit -m "feat(onboarding): runOnboarding 状态机(io 抽象) + 候选/大木数据"
```

---

### Task 3: main 接入 onboarding gate + serial close fix

**Files:**
- Modify: `host/src/index.js`（main onboarding gate + makeOnboardingIo + makeNewborn + stop close）
- Modify: `host/src/transport/index.js`（确认 mock/serial 都暴露 `close()`；mock 补 no-op close）
- Test: `host/test/onboarding-gate.test.js`

**契约**：main 在 transport 创建后、dashboard/tick 前，`loadState` 无 hatched → 用 transport 构造 io 跑 runOnboarding → `saveState(makeNewborn(species, name, today))`。stop handler 加 `transport.close?.()`（修 SIGTERM 后串口僵尸的既有 bug）。

- [ ] **Step 1: 写失败测试**（注入假 transport + 假 runOnboarding 验证 gate 落档）

`host/test/onboarding-gate.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runOnboardingGate } from "../src/index.js";

test("无 hatched → 跑 onboarding 并写 newborn(选中物种, bond 0, hatched)", async () => {
  const statePath = join("out", "test-gate-state.json");
  rmSync(statePath, { force: true });
  await runOnboardingGate({
    statePath,
    today: "2026-06-10",
    onboarding: async () => ({ species: "charmander", name: "小火龙" }),
    personalityRng: () => 0.5,
  });
  const s = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(s.hatched, true);
  assert.equal(s.species, "charmander");
  assert.equal(s.name, "小火龙");
  assert.equal(s.bond, 0);
  assert.equal(s.level, 1);
});

test("已 hatched → 跳过 onboarding，不覆盖存档", async () => {
  const statePath = join("out", "test-gate-hatched.json");
  rmSync(statePath, { force: true });
  const saved = { schemaVersion: 1, hatched: true, species: "umbreon", level: 9, bond: 70 };
  require("node:fs").writeFileSync(statePath, JSON.stringify(saved));
  let called = false;
  await runOnboardingGate({
    statePath, today: "2026-06-10",
    onboarding: async () => { called = true; return { species: "x", name: "x" }; },
  });
  assert.equal(called, false);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).species, "umbreon");
});
```
（`require` 在 ESM 测试里用 `import { writeFileSync } from "node:fs"` 替代——实现测试时用 import。）

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test --test-force-exit test/onboarding-gate.test.js`
Expected: FAIL（`runOnboardingGate` 未导出）

- [ ] **Step 3: 实现**

`host/src/index.js` 新增导出 `runOnboardingGate`（把 gate 逻辑抽出便于测试），main 调用它：
```js
export async function runOnboardingGate({
  statePath,
  today = localYmd(new Date()),
  onboarding,             // 注入：() => Promise<{species,name}>（真实由 transport io 驱动）
  personalityRng = Math.random,
}) {
  const existing = loadState(statePath);
  if (existing?.hatched) return existing;
  const { species, name } = await onboarding();
  const newborn = makeNewborn(species, name, today, personalityRng);
  saveState(statePath, newborn);
  return newborn;
}

function makeNewborn(species, name, today, personalityRng = Math.random) {
  return {
    species, name, level: 1, exp: 0, bond: 0, streak: 0, shield: 0,
    lastSettled: today, lastGrowthDay: null, todayCreditedExp: 0, todayCreditedBond: 0,
    hatched: true, ...rollPersonality(personalityRng),
  };
}

function makeOnboardingIo(transport) {
  let resolveBtn = null;
  const off = transport.onButton?.((b) => { const r = resolveBtn; resolveBtn = null; r?.(b); });
  const io = {
    push: (frame) => transport.push(frame),
    nextButton: () => new Promise((res) => { resolveBtn = res; }),
    playSound: (id) => transport.playSound?.(id),
    delay: (ms) => new Promise((res) => setTimeout(res, ms)),
  };
  return { io, off };
}
```
在 `main()` 里，`const transport = await createTransport(...)` 之后、`startDashboardServer`/首个 `tick()` 之前插入：
```js
await runOnboardingGate({
  statePath,
  onboarding: async () => {
    const { io, off } = makeOnboardingIo(transport);
    try { return await runOnboarding(io); } finally { off?.(); }
  },
});
```
import 顶部加 `import { runOnboarding } from "./pet/onboarding.js";`。
**serial close fix**：`main()` 的 `stop` handler 末尾加 `transport.close?.();`（修 SIGTERM 串口僵尸）。
`host/src/transport/index.js`：确认 `wrapMockTransport` 也有 `close()`（mock 补 `close() {}` no-op；serial 已有）。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test --test-force-exit test/onboarding-gate.test.js`
Expected: PASS（2 个）

- [ ] **Step 5: Commit**

```bash
git add host/src/index.js host/src/transport/index.js host/test/onboarding-gate.test.js
git commit -m "feat(onboarding): main gate(无hatched→孵化→落档) + serial close fix"
```

---

### Task 4: 全量回归

- [ ] **Step 1: 串行跑全套**

Run:
```bash
cd host && node --test --test-concurrency=1 --test-force-exit \
  test/onboarding-render.test.js test/onboarding.test.js test/onboarding-gate.test.js \
  test/sim.test.js test/evolution.test.js test/ensure-pet.test.js test/evolution-trigger.test.js \
  test/usage.test.js test/rate-limits.test.js test/usage-merge.test.js test/dashboard-sensors.test.js test/sounds.test.js
```
Expected: 全 PASS。报告 tests/pass/fail 统计。

---

## 真机验证（主控做，不在 codeagent 范围）

codeagent 完成后由主控执行（涉及设备/进程/state）：
1. 备份并清掉当前 state.json（或确认无 hatched），起 host。
2. 设备屏应依次：大木开场白（KEY 翻页）→ 选蛋（KEY 切 4 蛋、长按确认）→ 孵化动画+音 → 诞生+默认名 → 进养成。
3. 选不同候选验证落档 species 正确；reboot/重起 host 不重复孵化（hatched 持久化）。
4. SIGTERM 停 host 后串口立即释放（serial close fix，不再需 kill -9）。

---

## Self-Review

**1. Spec 覆盖**（spec §4 孵化 onboarding）：
- 大木开场白 ← Task 1(drawOak)+Task 2(OAK_LINES/翻页)✓
- 选蛋 4 选 1（蛋缩略）← Task 1(drawChoose)+Task 2(切换/确认)✓
- 孵化动画+音 ← Task 1(drawHatch)+Task 2(逐帧+playSound)✓
- 诞生+默认名 ← Task 1(drawBorn)+Task 2(return name)✓
- 设备屏闭环 + dashboard 改名 ← Task 3(gate 用 transport io；name 走已有 settings)✓
- hatched 持久化幂等 ← Task 3(gate 检测 hatched 跳过)✓
- serial close fix ← Task 3 ✓

**2. Placeholder 扫描**：无 TBD。渲染画法引 mockup 08（已存在、已确认），非占位。诞生用占位剪影是明确的本期决定（真实 sprite 后续）。

**3. 类型一致性**：`io` 接口（push/nextButton/playSound/delay）在 runOnboarding(Task2)/mockIo 测试(Task2)/makeOnboardingIo(Task3) 三处一致；`renderOnboarding(scene)` 返回 `{pngBuffer,bitmap}` ↔ `transport.push` 期望 ↔ `imageDataToFrame` 产出一致；`{species,name}` 贯穿 runOnboarding→gate→makeNewborn。`hatched` 与 2a 的 ensurePet/salvageState 契约一致（无 hatched=未孵化；本 gate 在 ensurePet 之前拦截并落 hatched 档）。

**4. 风险**：①渲染视觉只有单测保证"不崩+尺寸"，真实观感靠真机验证（已列）。②main gate 与 2a ensurePet 的交互——gate 先写 hatched 档，之后 runOneTick 的 ensurePet 读到 hatched 走保留分支，不会二次重置（一致性已在 §3 校验）。③onboarding 期间 transport.push 是 serial stop-and-wait，按键 onButton 异步——io 的 nextButton 单 resolver，若用户狂按可能丢中间按键（可接受，onboarding 非高频）。
