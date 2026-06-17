# P2 · 每只独有真声 + 三态文字气泡 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 本仓由 **codex（skill `codeagent`）实现每个 task**，Claude 作 PM 逐 task 审查并亲跑闸门。步骤用 `- [ ]` 跟踪。

**Goal:** 给 18 只各自的 chiptune 真声（固件音表）+ 让 KEY 本地播当前物种声（`T_CONFIG` 设 `g_active_cry`）+ 三态文字气泡，全部由单一真源 `host/seed/species-cries.json` 驱动（host 直接读，固件用生成的 `.inc`）。

**Architecture:** 真源 JSON 已入库。host 侧 `cry-audio.js`（物种→soundId）与 `cries.js`（三态气泡）直接 `readFileSync+JSON.parse` 真源；`gen-cries.mjs` 由真源生成 `firmware/main/species_cries.inc`。transport 加 `setActiveCry`（fire-and-forget CONFIG 帧 + 重连重放）。固件 `#include` 生成的 inc，`synth_all` 多合成 18 声，`T_CONFIG` 设原子 `g_active_cry`，`on_key_single` 播之。

**Tech Stack:** Node ESM、`node:test`、ESP-IDF C++（`std::atomic`）。

**前置条件:** `cd host && npm install` 已完成。**固件部分无法在此环境上板验证**——P2 固件改动以"编译通过 + codex 审查"为闸门，真机发声由用户烧录验证。

**对应 spec:** [docs/specs/2026-06-17-buddy-cries-animations-design.md](../specs/2026-06-17-buddy-cries-animations-design.md) 支柱二（P2）。

---

### Task 1: `cry-audio.js` — 物种→soundId 映射（读真源）

**Files:**
- Create: `host/src/pet/cry-audio.js`
- Test: `host/test/cry-audio.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/cry-audio.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { SND_SPECIES_BASE, SPECIES_SOUND_ORDER, cryAudioId } from "../src/pet/cry-audio.js";

test("SND_SPECIES_BASE is 3 (after BUI/EVOLVE/HOUR)", () => {
  assert.equal(SND_SPECIES_BASE, 3);
});

test("18 species map to contiguous, unique ids [3,20]", () => {
  assert.equal(SPECIES_SOUND_ORDER.length, 18);
  const ids = SPECIES_SOUND_ORDER.map((s) => cryAudioId(s));
  assert.deepEqual(ids, Array.from({ length: 18 }, (_, i) => 3 + i));
  assert.equal(new Set(ids).size, 18);
});

test("cryAudioId follows JSON order (eevee=3, blastoise=20)", () => {
  assert.equal(cryAudioId("eevee"), 3);
  assert.equal(cryAudioId("blastoise"), 20);
});

test("cryAudioId returns null for unknown species", () => {
  assert.equal(cryAudioId("不存在"), null);
  assert.equal(cryAudioId(undefined), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/cry-audio.test.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`host/src/pet/cry-audio.js`：

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 单一真源：物种顺序即 firmware 音表索引（soundId = soundBase + index）。
const data = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../seed/species-cries.json", import.meta.url)), "utf8"),
);

export const SND_SPECIES_BASE = data.soundBase;
export const SPECIES_SOUND_ORDER = data.species.map((s) => s.key);
const INDEX = new Map(SPECIES_SOUND_ORDER.map((key, i) => [key, i]));

export function cryAudioId(species) {
  const i = INDEX.get(species);
  return i === undefined ? null : SND_SPECIES_BASE + i;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/cry-audio.test.js`
Expected: PASS（4 用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add seed/species-cries.json src/pet/cry-audio.js test/cry-audio.test.js
git commit -m "feat(cries): species->soundId map from single-source JSON"
```

---

### Task 2: `cries.js` 三态气泡（向后兼容）

**Files:**
- Modify: `host/src/pet/cries.js`（改为读真源；保留 `CRIES`/`EEVEE_IDLE_CRY` 导出；`cryFor` 加 mood）
- Test: `host/test/cries.test.js`（追加三态用例；既有断言不变）

- [ ] **Step 1: 追加失败测试**

在 `host/test/cries.test.js` 末尾追加（不动既有断言）：

```js
test("cryFor returns happy/strained variants by mood", () => {
  assert.equal(cryFor("eevee", "happy"), "Bui♪");
  assert.equal(cryFor("eevee", "strained"), "bui…");
  assert.equal(cryFor("charmander", "happy"), "噗噗!");
});

test("cryFor maps fainted/shocked to strained, focused to idle", () => {
  assert.equal(cryFor("vaporeon", "fainted"), "凛~");
  assert.equal(cryFor("vaporeon", "shocked"), "凛~");
  assert.equal(cryFor("vaporeon", "focused"), "咻~");
  assert.equal(cryFor("vaporeon"), "咻~"); // 无 mood -> idle
});

test("cryFor unknown species still falls back to ♪ regardless of mood", () => {
  assert.equal(cryFor("不存在", "happy"), "♪");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/cries.test.js`
Expected: FAIL（mood 变体未实现，happy 仍返回 idle）。

- [ ] **Step 3: 实现**

`host/src/pet/cries.js` 整体替换为：

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Idle bubble cries + happy/strained variants, single-sourced from species-cries.json.
const data = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../seed/species-cries.json", import.meta.url)), "utf8"),
);

const VARIANTS = Object.fromEntries(data.species.map((s) => [s.key, s.bubble]));

// Back-compat: CRIES stays a species->idle-string map; EEVEE_IDLE_CRY is layout's fallback.
export const CRIES = Object.fromEntries(data.species.map((s) => [s.key, s.bubble.idle]));
export const EEVEE_IDLE_CRY = CRIES.eevee;

// mood ∈ {happy, focused, strained, fainted, shocked} (deriveMood) or undefined.
export function cryFor(species, mood) {
  const v = VARIANTS[species];
  if (!v) return "♪";
  if (mood === "happy") return v.happy;
  if (mood === "strained" || mood === "fainted" || mood === "shocked") return v.strained;
  return v.idle; // focused / undefined / 其余
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/cries.test.js`
Expected: PASS（既有 4 + 新增 3 = 7 用例）。说明：cries.test 既有断言只覆盖 eevee/bulbasaur/charizard 三只，其 idle 与真源一致故不破；flareon/espeon/leafeon/glaceon/sylveon/wartortle/blastoise 的 idle 是本轮**有意升级**的新气泡（设计四件套），不在既有断言内。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/pet/cries.js test/cries.test.js
git commit -m "feat(cries): three-state bubble (idle/happy/strained) from JSON"
```

---

### Task 3: `gen-cries.mjs` → `firmware/main/species_cries.inc` + 一致性测试

**Files:**
- Create: `host/scripts/gen-cries.mjs`（导出 `generateInc(data)` 纯函数 + CLI 写文件）
- Create: `firmware/main/species_cries.inc`（生成产物，入库）
- Test: `host/test/gen-cries.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/gen-cries.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { generateInc } from "../scripts/gen-cries.mjs";

const data = JSON.parse(
  readFileSync(fileURLToPath(new URL("../seed/species-cries.json", import.meta.url)), "utf8"),
);

test("generated inc declares base/count and one table per species", () => {
  const inc = generateInc(data);
  assert.match(inc, /#define SND_SPECIES_BASE 3/);
  assert.match(inc, /#define SND_SPECIES_COUNT 18/);
  assert.match(inc, /SPECIES_CRY_0\[\] = \{ \{520\.f, 780\.f, 110\}/); // eevee
  assert.equal((inc.match(/static const Note SPECIES_CRY_\d+\[\]/g) ?? []).length, 18);
});

test("committed species_cries.inc matches regenerated output (no drift)", () => {
  const inc = generateInc(data);
  const committed = readFileSync(
    fileURLToPath(new URL("../../firmware/main/species_cries.inc", import.meta.url)), "utf8");
  assert.equal(committed, inc);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/gen-cries.test.js`
Expected: FAIL（`gen-cries.mjs` / inc 不存在）。

- [ ] **Step 3: 实现生成器 + 跑出 inc**

`host/scripts/gen-cries.mjs`：

```js
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fnum = (v) => (Number.isInteger(v) ? `${v}.f` : `${v}f`);

export function generateInc(data) {
  const lines = [
    "// AUTO-GENERATED by host/scripts/gen-cries.mjs from host/seed/species-cries.json",
    "// Do not edit by hand. Regenerate: cd host && node scripts/gen-cries.mjs",
    `#define SND_SPECIES_BASE ${data.soundBase}`,
    `#define SND_SPECIES_COUNT ${data.species.length}`,
    "",
  ];
  data.species.forEach((s, i) => {
    const notes = s.notes.map((n) => `{${fnum(n.f0)}, ${fnum(n.f1)}, ${n.ms}}`).join(", ");
    lines.push(`static const Note SPECIES_CRY_${i}[] = { ${notes} }; // ${s.key} -> sound id ${data.soundBase + i}`);
  });
  lines.push("", "struct SpeciesCry { const Note *notes; int count; };",
    "static const SpeciesCry SPECIES_CRIES[SND_SPECIES_COUNT] = {");
  data.species.forEach((s, i) => lines.push(`  { SPECIES_CRY_${i}, ${s.notes.length} }, // ${s.key}`));
  lines.push("};", "");
  return lines.join("\n");
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const data = JSON.parse(
    readFileSync(fileURLToPath(new URL("../seed/species-cries.json", import.meta.url)), "utf8"));
  const out = fileURLToPath(new URL("../../firmware/main/species_cries.inc", import.meta.url));
  writeFileSync(out, generateInc(data));
  console.log(`wrote ${out}`);
}
```

生成 inc：Run `cd host && node scripts/gen-cries.mjs`
Expected: 打印 `wrote .../firmware/main/species_cries.inc`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/gen-cries.test.js`
Expected: PASS（2 用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git -C .. add firmware/main/species_cries.inc host/scripts/gen-cries.mjs host/test/gen-cries.test.js
git -C .. commit -m "feat(cries): gen-cries.mjs single-source -> firmware species_cries.inc"
```

---

### Task 4: transport `setActiveCry`（CONFIG 帧 + 重连重放）

**Files:**
- Modify: `host/src/transport/serial.js`（return 对象加 `setActiveCry`）
- Modify: `host/src/transport/index.js`（wrap 加 `setActiveCry` + 重连重放；mock wrap 加 no-op）
- Test: `host/test/transport-cry.test.js`（wrap 行为）+ `host/test/serial.test.js`（追加：真写 CONFIG 帧）

- [ ] **Step 1: 写失败测试（两处）**

(a) `host/test/transport-cry.test.js`（验 wrap 调底层 + 重连重放 + mock no-op）：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { createTransport } from "../src/transport/index.js";

// 假串口：记录写出的帧 + 可触发 reconnect
function fakeSerialFactory() {
  const writes = [];
  let reconnectCb = null;
  const serial = {
    pushFrame: async () => ({ ok: true }),
    playSound() {},
    setActiveCry(id) { writes.push(["cry", id]); },
    onReconnect(cb) { reconnectCb = cb; return () => {}; },
    onButton() { return () => {}; },
    onSensor() { return () => {}; },
    feedSensor() { return null; },
    close() {},
    _fireReconnect: () => reconnectCb?.(),
    _writes: writes,
  };
  return async () => serial;
}

test("setActiveCry sends a CONFIG frame with the sound id", async () => {
  const fake = fakeSerialFactory();
  const t = await createTransport({ serialTransportFactory: fake });
  t.setActiveCry(7);
  // fake.setActiveCry 记录的是底层调用；断言其被调用且带 id
  const serial = await fake();
  assert.deepEqual(serial._writes.at(-1), ["cry", 7]);
});

test("setActiveCry is replayed after reconnect", async () => {
  const fake = fakeSerialFactory();
  const serial = await fake();
  const t = await createTransport({ serialTransportFactory: () => Promise.resolve(serial) });
  t.setActiveCry(9);
  serial._writes.length = 0;
  serial._fireReconnect();
  assert.deepEqual(serial._writes.at(-1), ["cry", 9]); // 重放
});

test("mock transport exposes a no-op setActiveCry", async () => {
  const t = await createTransport({ serialTransportFactory: async () => null });
  assert.equal(typeof t.setActiveCry, "function");
  assert.doesNotThrow(() => t.setActiveCry(5));
});
```

(b) 在 `host/test/serial.test.js` **末尾追加**（验底层 serial 真写出 `T.CONFIG` 帧；`FakePort`/`makeTransport`/`decodeFrame`/`T` 该文件已在用）：

```js
test("setActiveCry writes a CONFIG frame with the sound id", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  transport.setActiveCry(7);
  const frame = decodeFrame(port.writes.at(-1));
  assert.equal(frame.type, T.CONFIG);
  assert.equal(frame.seq, 0);
  assert.deepEqual([...frame.payload], [7]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/transport-cry.test.js test/serial.test.js`
Expected: FAIL（`setActiveCry` 未定义 / 未写 CONFIG 帧）。

- [ ] **Step 3: 实现**

① `host/src/transport/serial.js` return 对象内、`playSound` 之后追加：

```js
    setActiveCry(soundId) {
      if (!connected) return;
      // Fire-and-forget CONFIG frame: device stores it as the KEY-press cry id.
      try {
        currentPort.write(encodeFrame({ type: T.CONFIG, seq: 0, payload: Uint8Array.from([soundId & 0xff]) }));
      } catch {
        // Ignore fire-and-forget write failures.
      }
    },
```

② `host/src/transport/index.js`：`wrapSerialTransport` 加 `lastActiveCry` 重放 + 暴露 `setActiveCry`；`wrapMockTransport` 加 no-op：

```js
function wrapSerialTransport(serial, { framePath }) {
  let previousBytes = null;
  let lastActiveCry = null;
  serial.onReconnect?.(() => {
    previousBytes = null;
    if (lastActiveCry != null) serial.setActiveCry(lastActiveCry); // 重连重放设备态
  });

  return {
    ...serial,
    kind: "serial",
    setActiveCry(id) {
      lastActiveCry = id & 0xff;
      serial.setActiveCry(lastActiveCry);
    },
    async push({ pngBuffer, bitmap }) {
      // ...（原样不变）
    },
  };
}
```

`wrapMockTransport` 内补：

```js
function wrapMockTransport(mock) {
  return {
    ...mock,
    kind: "mock",
    setActiveCry() {},
    async push(frame) {
      return mock.push(frame?.pngBuffer ?? frame);
    },
    close() {},
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/transport-cry.test.js test/serial.test.js`
Expected: PASS（transport-cry 3 用例 + serial 既有用例 + 新增 CONFIG 帧用例）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/transport/serial.js src/transport/index.js test/transport-cry.test.js test/serial.test.js
git commit -m "feat(transport): setActiveCry CONFIG frame + reconnect replay"
```

---

### Task 5: `index.js` 接线（按物种下发 cry id + 三态气泡）

**Files:**
- Modify: `host/src/index.js`（runOneTick：setActiveCry + bubble 带 mood）
- Test: `host/test/integration.test.js`（追加：物种 → setActiveCry 调用）

- [ ] **Step 1: 追加失败测试**

在 `host/test/integration.test.js` 追加（用该文件既有 helper `usageWithTokens`/`sampleWeather` + `mock: createMockTransport({framePath})` 注入路径——`runOneTick` 对 `mock` 走 `adaptPngTransport`，spread 保留我们挂的 `setActiveCry` spy）：

```js
test("runOneTick sets the active cry id for the pet's species", async () => {
  const statePath = join("out", "test-cry-state.json");
  const framePath = join("out", "test-cry-frame.png");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  rmSync(framePath, { force: true });

  const cryCalls = [];
  const mock = createMockTransport({ framePath });
  mock.setActiveCry = (id) => cryCalls.push(id);

  await runOneTick({
    usage: usageWithTokens(1_000),
    weather: sampleWeather(),
    room: { t: 23.4, h: 56 },
    statePath,
    framePath,
    mock,
    today: "2026-05-30",
  });

  // 无 hatched 存档 → ensurePet 出 eevee → cryAudioId=3
  assert.ok(cryCalls.includes(3));
});
```

> 实现者注：`usageWithTokens`/`sampleWeather` 是 integration.test.js 内既有 helper；若签名不同按文件实际对齐。核心断言：`setActiveCry` 被以 `cryAudioId(pet.species)` 调用。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/integration.test.js`
Expected: FAIL（setActiveCry 未被调用）。

- [ ] **Step 3: 实现**

`host/src/index.js`：① 顶部 import 增 `import { cryAudioId } from "./pet/cry-audio.js";`。
② `runOneTick` 内 `const mood = deriveMood(usage);`（line ~112）之后、`renderFrame` 之前加（未知物种返回 null 时**显式跳过**，避免 `null & 0xff = 0` 误播 BUI）：

```js
  const cryId = cryAudioId(pet.species);
  if (cryId != null) activeTransport.setActiveCry?.(cryId);
```

③ buddy 的 bubble 改带 mood：

```js
      bubble: sprite.placeholder ? "BUDDY" : cryFor(pet.species, mood),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/integration.test.js`
Expected: PASS。

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd host && node --test`（除你本机 host 占串口致 `scripts/play-test.js` 环境失败外应 0 fail）
```bash
cd host && git add src/index.js test/integration.test.js
git commit -m "feat(cries): drive per-species active cry id + mood bubble in runOneTick"
```

---

### Task 6: 固件 — 18 音表 + T_CONFIG active-cry（编译闸门 + 上板由用户验证）

**Files:**
- Modify: `firmware/main/main.cpp`

- [ ] **Step 1: 改动（按以下 6 处精确修改）**

1. 头部加 `#include <atomic>`（与现有 `#include` 同区）。
2. **把 `struct Note { float f0, f1; int ms; };`（现 ~line 247）上移**到音频全局区之前（`g_snd` 声明之前），紧接其后 `#include "species_cries.inc"`（inc 内用到 `Note`，必须在其后）。**务必删除原 line 247 处的 `struct Note` 定义**，避免重复定义编译错误。
3. `SND_COUNT`：删除 `static constexpr int SND_COUNT = 3;`，改为在 inc 之后：

```cpp
static constexpr uint8_t T_CONFIG = 0x04;          // host -> device: set active KEY cry
static constexpr int SND_COUNT = SND_SPECIES_BASE + SND_SPECIES_COUNT; // 3 + 18 = 21
static_assert(SND_SPECIES_BASE == 3, "species ids must start after BUI/EVOLVE/HOUR");
```

4. `g_active_cry`（与 `g_snd` 等音频全局同区）：

```cpp
static std::atomic<uint8_t> g_active_cry{SND_BUI};  // KEY-press cry; set by host CONFIG
```

5. `synth_all` 末尾追加物种循环（保留原 BUI/EVOLVE/HOUR 三段不动）：

```cpp
    size_t free_before = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
    for (int i = 0; i < SND_SPECIES_COUNT; i++)
        synth_tone(SPECIES_CRIES[i].notes, SPECIES_CRIES[i].count,
                   &g_snd[SND_SPECIES_BASE + i], &g_snd_bytes[SND_SPECIES_BASE + i]);
    ESP_LOGI(TAG, "synth: %d species cries, spiram %u -> %u",
             SND_SPECIES_COUNT, (unsigned)free_before,
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
```

6. `parse_frames` 增 `T_CONFIG` 分支（在 `T_PLAY` 分支旁）+ `on_key_single` 改播 active：

```cpp
            } else if (f[1] == T_CONFIG && len >= 1) {
                if (f[5] < SND_COUNT) g_active_cry.store(f[5]); // 非法 id 拒绝, 不改值
            }
```
```cpp
static void on_key_single(Button *)  { btn_emit(KEY_ID_KEY, KIND_SHORT); play_sound(g_active_cry.load()); }
```

7. **更新过期注释/日志**：文件头注释「Three chiptune voices are synthesized」与 `app_main` 末尾 `ESP_LOGI(TAG, "B5: codec up; 3 sounds ...")` 改为反映 3 系统音 + 18 物种音、KEY 播 active cry、新增 T_CONFIG。

- [ ] **Step 2: 编译闸门**

Run（若 IDF 环境就绪）: `cd firmware && idf.py build`
Expected: 编译通过（含生成的 `species_cries.inc`）。若本机无 IDF，跳过并在交付说明里标注"待用户 `idf.py build` + 烧录验证"。

- [ ] **Step 3: 提交**

```bash
git -C /Users/zeus/Projects/claude-pokemon-buddy/.claude/worktrees/stoic-jang-b1dd16 add firmware/main/main.cpp
git -C /Users/zeus/Projects/claude-pokemon-buddy/.claude/worktrees/stoic-jang-b1dd16 commit -m "feat(firmware): 18 species cries + T_CONFIG active cry (atomic)"
```

---

## 自检（plan vs spec）

- **Spec 覆盖**：固件 18 音表 + SND_COUNT=21 + T_CONFIG atomic + 非法 id 拒绝（Task 6）；单一真源 JSON→host 读 + 生成 inc（Task 1/3）；setActiveCry + 重连重放（Task 4）；三态气泡 cryFor(species,mood) 自映射（Task 2）；index 接线（Task 5）。
- **占位扫描**：无 TBD；各 code step 含完整代码（Task 5 integration 测试因需对齐文件内既有 helper 命名，已显式标注）。
- **类型/签名一致**：`cryAudioId`/`SPECIES_SOUND_ORDER`/`SND_SPECIES_BASE`（Task1）→ Task5 使用一致；`setActiveCry(id)`（Task4）→ Task5 调用一致；固件 `SND_SPECIES_BASE/COUNT/SPECIES_CRIES`（inc，Task3）→ Task6 使用一致。
- **向后兼容**：`CRIES`/`EEVEE_IDLE_CRY` 保留；`cryFor` 无 mood = idle，既有 cries.test 不破；`SND_BUI/EVOLVE/HOUR` + T_PLAY/进化/整点链路不动。
- **非目标守住**：不动养成/渲染布局；动画（idle/招牌）属 P3/P4，本期不碰。
- **闸门说明**：host 全 TDD 可验；固件以编译 + codex 审查为闸门，发声真机由用户烧录确认。
