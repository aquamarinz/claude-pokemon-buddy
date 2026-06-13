# 视觉打磨轮 P1+P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ESP32 1-bit 桌面宠物的孵化 onboarding + 日常屏 + 新增进化动画做到「礼物级」视觉（spec: `docs/specs/2026-06-13-visual-polish-design.md`，已过 codex 3 轮评审 READY）。

**Architecture:** host (Node) canvas 渲染 → 1bpp → 脏区推 ESP32，本轮只动 `host/src/render/*` + `host/src/pet/onboarding*` + 新增 `species-meta.js`/`evolution-anim.js` + 资产烘焙脚本。不改渲染管线契约、不改养成数值逻辑。项① sprite 已 merge（d050030）。

**Tech Stack:** Node 25 + `@napi-rs/canvas` + `node --test`。测试一律 `cd host && node --test --test-concurrency=1 --test-force-exit`（Node 25 必需，否则 inspect 端口冲突挂死）。设备插着时测试必须 hermetic（注入 mock/fake transport，绝不默认 `createTransport()` 探测串口）。

**参考工作代码**（用户已逐项确认，几何/坐标直接 port，勿重新推导）：
- 蛋形 4 species + crack/shard/rays：`mockups/item-eggs.html`（drawEgg 各形）、`mockups/09-visual-polish.html`（egg/shard/rays/孵化 12 帧/进化序列/选蛋反色/诞生/日常徽章）。
- /tmp 临时烘焙脚本：`/tmp/cpb-bake/bakeall.mjs`（sprite）、`/tmp/cpb-oak/oakscreen.mjs`（Oak），本轮固化入库。

---

### Task 1: SPECIES_ZH 物种中文名映射

**Files:**
- Create: `host/src/pet/species-meta.js`
- Test: `host/test/species-meta.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPECIES_ZH, zhName } from "../src/pet/species-meta.js";

const ALL = ["eevee","vaporeon","jolteon","flareon","espeon","umbreon","leafeon","glaceon","sylveon",
  "bulbasaur","ivysaur","venusaur","charmander","charmeleon","charizard","squirtle","wartortle","blastoise"];

test("all 18 species have a non-empty Chinese name", () => {
  for (const sp of ALL) {
    assert.equal(typeof SPECIES_ZH[sp], "string");
    assert.ok(SPECIES_ZH[sp].length > 0, `${sp} missing`);
  }
});

test("zhName falls back to the raw species id for unknown", () => {
  assert.equal(zhName("eevee"), "伊布");
  assert.equal(zhName("missingno"), "missingno");
});
```

- [ ] **Step 2: Run test, verify FAIL** — `node --test --test-concurrency=1 --test-force-exit test/species-meta.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// host/src/pet/species-meta.js
export const SPECIES_ZH = {
  eevee: "伊布", vaporeon: "水伊布", jolteon: "雷伊布", flareon: "火伊布",
  espeon: "太阳伊布", umbreon: "月亮伊布", leafeon: "叶伊布", glaceon: "冰伊布", sylveon: "仙子伊布",
  bulbasaur: "妙蛙种子", ivysaur: "妙蛙草", venusaur: "妙蛙花",
  charmander: "小火龙", charmeleon: "火恐龙", charizard: "喷火龙",
  squirtle: "杰尼龟", wartortle: "卡咪龟", blastoise: "水箭龟",
};

export function zhName(species) {
  return SPECIES_ZH[species] ?? species;
}
```

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `git add host/src/pet/species-meta.js host/test/species-meta.test.js && git commit -m "feat(species-meta): 全18物种中文名映射 SPECIES_ZH + zhName"`

---

### Task 2: 资产烘焙脚本固化入库（bake-assets.mjs + oak.png）

**Files:**
- Create: `host/scripts/bake-assets.mjs`
- Create: `host/seed/oak.png`（由脚本生成后入库）
- Test: `host/test/assets.test.js`

**Background:** 18 sprite 已在 `host/seed/sprites/`（d050030），本任务把临时烘焙逻辑固化为可复现脚本 + 新增 Oak 资产。脚本下载源 → 烘焙；**测试只读本地已入库资产，绝不下载**。

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSpriteGray } from "../src/render/sprites.js";

test("oak asset exists and loads as a real (non-placeholder) 1-bit sprite", async () => {
  const path = fileURLToPath(new URL("../seed/oak.png", import.meta.url));
  assert.ok(existsSync(path), "seed/oak.png must be committed");
  const s = await loadSpriteGray(path, { size: null });
  assert.equal(s.placeholder, false);
  assert.ok(s.w > 20 && s.h > 30, "oak sprite has real dimensions");
});
```

- [ ] **Step 2: Run test, verify FAIL** (oak.png 不存在).

- [ ] **Step 3: Implement bake-assets.mjs**（port `/tmp/cpb-bake/bakeall.mjs` + `/tmp/cpb-oak/oakscreen.mjs` 的 oak1bit）。脚本结构：

```js
// host/scripts/bake-assets.mjs — 可复现烘焙 18 sprite + Oak。运行: node scripts/bake-assets.mjs
// 依赖网络下载源资产；产物写入 seed/。CI/测试不跑此脚本。
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEED = fileURLToPath(new URL("../seed/", import.meta.url));
const DW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/dream-world";
const SPECIES = { bulbasaur:1, ivysaur:2, venusaur:3, charmander:4, charmeleon:5, charizard:6,
  squirtle:7, wartortle:8, blastoise:9, eevee:133, vaporeon:134, jolteon:135, flareon:136,
  espeon:196, umbreon:197, leafeon:470, glaceon:471, sylveon:700 };

// --- DW sprite 管线 (4x 超采样 → 白底 → 降 120 → 灰度 → 自动阈值+25 → 1-bit 透明 PNG) ---
async function bakeDW(svgText, targetMax = 120) { /* port /tmp/cpb-bake/bakeall.mjs bakeDW */ }
// --- Oak 像素立绘管线 (threshold 175 → bbox 裁 → 1-bit 透明 PNG) ---
async function bakeOak(pngBuffer, threshold = 175) { /* port /tmp/cpb-oak/oakscreen.mjs oak1bit, 输出 PNG */ }

// 主流程: 下载每个 DW SVG → bakeDW → 写 seed/sprites/<name>.png
// 下载 FRLG Oak (archives.bulbagarden.net/media/upload/4/4c/Spr_FRLG_Oak.png) → bakeOak → 写 seed/oak.png
```

> 关键参数（spec 已定，写死）：sprite 4x 超采样、120px 最长边、自动阈值（墨水占比首次≥13% 的阈值 +25）、透明背景（黑=不透明）。Oak：threshold 175、bbox 裁剪、透明背景。port 时保持与已入库 18 sprite 字节一致（同参数同源）。

- [ ] **Step 4: 运行脚本生成资产** — `cd host && node scripts/bake-assets.mjs`。确认 `seed/oak.png` 生成（40×63 量级），18 sprite 与现有一致（`git status` sprites 无改动或仅元数据）。

- [ ] **Step 5: Run test, verify PASS.**

- [ ] **Step 6: Commit** — `git add host/scripts/bake-assets.mjs host/seed/oak.png host/test/assets.test.js && git commit -m "feat(assets): 固化 bake-assets.mjs 入库 + 烘焙 Oak 立绘 seed/oak.png"`

---

### Task 3: loadOakSprite（sprites.js）

**Files:**
- Modify: `host/src/render/sprites.js`
- Test: `host/test/sprites.test.js`（追加）

- [ ] **Step 1: Write the failing test**（追加到现有 sprites.test.js）

```js
test("loadOakSprite loads the committed Oak asset", async () => {
  const { loadOakSprite } = await import("../src/render/sprites.js");
  const s = await loadOakSprite();
  assert.equal(s.placeholder, false);
  assert.ok(s.w > 20 && s.h > 30);
});
```

- [ ] **Step 2: Run test, verify FAIL** (loadOakSprite undefined).

- [ ] **Step 3: Implement**（sprites.js 追加，紧邻 loadBuddySprite）

```js
export async function loadOakSprite(options = {}) {
  const url = new URL("../../seed/oak.png", import.meta.url);
  return loadSpriteGray(fileURLToPath(url), { size: null, ...options });
}
```

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(sprites): loadOakSprite 读 seed/oak.png"`

---

### Task 4: drawEgg 4 species 差异化蛋（onboarding.js）

**Files:**
- Modify: `host/src/render/onboarding.js`（替换 `egg()`，新增 `drawEgg(g, species, cx, cy, scale, {crack, shake})`，保留 shard/crack overlay 共享）
- Test: `host/test/onboarding-render.test.js`（追加 + 改写 1 个反向测试）

**Port:** 4 蛋形几何从 `mockups/item-eggs.html`（eggEevee/eggBulba/eggChar/eggSquirt）；crack/shard overlay 从现有 `egg()` 的 crack 分支 + `mockups/09-visual-polish.html` 的 shard()。

- [ ] **Step 1: Write the failing test**（追加）

```js
import { CANDIDATES } from "../src/pet/onboarding-data.js";

test("drawEgg renders a distinct egg per candidate species (choose screen)", async () => {
  const bufs = await Promise.all(CANDIDATES.map((c, i) =>
    renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel: i }).then(r => r.pngBuffer)));
  for (let i = 0; i < bufs.length; i++)
    for (let j = i + 1; j < bufs.length; j++)
      assert.ok(!bufs[i].equals(bufs[j]), `egg ${i} vs ${j} must differ`);
});
```

- [ ] **Step 2: 改写现有反向测试** `"hatch mid-frame egg animation is species-agnostic"` → 反转：

```js
test("hatch mid-frame egg differs per species (species-specific eggs)", async () => {
  const bulba = await renderOnboarding({ kind: "hatch", frame: 0, species: "bulbasaur" });
  const eevee = await renderOnboarding({ kind: "hatch", frame: 0, species: "eevee" });
  assert.ok(!bulba.pngBuffer.equals(eevee.pngBuffer), "species eggs must differ even mid-hatch");
});
```

- [ ] **Step 3: Run tests, verify FAIL**（choose 各蛋当前相同 / mid-frame 当前相同）。

- [ ] **Step 4: Implement drawEgg**（onboarding.js）。新增 per-species 绘制 + 共享 crack/shard overlay；`drawChoose`/`drawHatch` 改调 `drawEgg(g, species, ...)`。port item-eggs.html 的 4 个蛋形函数，合并为按 species 分派：

```js
function drawEgg(g, species, cx, cy, scale = 1, { crack = 0, shake = 0 } = {}) {
  const fn = EGG_SHAPES[species] ?? EGG_SHAPES.eevee;
  fn(g, cx, cy, scale, shake);           // 各 species 蛋形 (port item-eggs.html)
  if (crack > 0) drawCrack(g, cx, cy, scale, crack);   // 共享裂纹 overlay (port 现 egg() crack 分支)
}
// EGG_SHAPES = { eevee, bulbasaur, charmander, squirtle } 各 (g,cx,cy,scale,shake)
```

> 注：`drawChoose` 当前用 `egg(g,W/2,112,1.0,0,0)` + `smallEgg`，改为 `drawEgg(g, candidates[sel].species, W/2,112,1.0)` + chip 内 `drawEgg(g, candidates[i].species, x+bw/2, y+28, 0.42)`。`drawHatch` 的蛋帧改 `drawEgg(g, species, W/2,150,1.4,{crack,shake})`。

- [ ] **Step 5: Run tests, verify PASS** (含改写的反向测试 + 新 choose 测试 + 现有未受影响测试).

- [ ] **Step 6: Commit** — `git commit -am "feat(onboarding): 4 species 差异化蛋 drawEgg + 共享裂纹 overlay"`

---

### Task 5: 选蛋屏中央联动 + 选中反色（drawChoose）

**Files:**
- Modify: `host/src/render/onboarding.js`（drawChoose）
- Test: `host/test/onboarding-render.test.js`（追加）

**Port:** 反色 chip 从 `mockups/item-eggs.html` drawChoose（选中 chip 黑底 + XOR/PAPER 描白蛋）。

- [ ] **Step 1: Write the failing test**（追加）

```js
test("choose screen highlights selected chip distinctly (inverted)", async () => {
  const sel0 = await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel: 0 });
  const sel1 = await renderOnboarding({ kind: "choose", candidates: CANDIDATES, sel: 1 });
  assert.ok(!sel0.pngBuffer.equals(sel1.pngBuffer), "different selection must render differently");
});
```

- [ ] **Step 2: Run test, verify** — 若 Task 4 已让中央蛋联动则可能已 PASS；本任务确保**选中 chip 反色**（黑底白蛋）落地。补一条断言：选中 chip 区域应有黑底（可通过裁剪 bitmap 选中 chip 矩形、统计黑像素占比 > 阈值验证）。

- [ ] **Step 3: Implement** — drawChoose 选中 chip：`g.fillStyle=INK; g.fillRect(x,y,bw,h)` 后以 PAPER 描白蛋 + 白字（port item-eggs.html）。未选描边。

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(onboarding): 选蛋屏中央蛋联动 + 选中 chip 反色"`

---

### Task 6: 孵化动画加戏（drawHatch 12 帧 + runOnboarding 序列 + 音效时序）

**Files:**
- Modify: `host/src/render/onboarding.js`（drawHatch：12 帧 + 末帧全黑）
- Modify: `host/src/pet/onboarding.js`（runOnboarding hatch 循环 + 闪黑帧后播音）
- Test: `host/test/onboarding-render.test.js`（改写 end-frame 反向测试 + 追加）、`host/test/onboarding.test.js`（音效时序）

**Port:** 12 帧序列（静→摇晃渐强→裂纹+碎片→闪黑×2）从 `mockups/09-visual-polish.html` HATCH 数组 + shard()。

- [ ] **Step 1: 改写现有反向测试** `"hatch end-frame shows the chosen species' real sprite"` → 改为末帧全黑：

```js
test("hatch final frame is a full-black flash (reveal moved to born screen)", async () => {
  const { bitmap } = await renderOnboarding({ kind: "hatch", frame: 9, species: "eevee" });
  const allBlack = bitmap.bytes.every(b => b === 0xff);   // 1bpp: 全墨
  assert.ok(allBlack, "final hatch frame must be a black flash");
});
```

> 注：确认 1bpp「墨=1」的字节表示（见 `render/dither.js` thresholdTo1bpp）。若墨=bit1 且打包为 0xff=全墨，则 `every(b===0xff)`；按实际打包调整断言。

- [ ] **Step 2: 追加音效时序测试**（onboarding.test.js，mock io）

```js
test("hatch plays EVOLVE sound right after the first black-flash frame", async () => {
  const calls = [];
  const io = makeRecordingIo(calls);          // push/nextButton/playSound/delay 全记录顺序
  // 驱动到 hatch 阶段... (复用现有 onboarding.test 的 mock io 模式)
  // 断言: playSound(SOUND.EVOLVE) 出现在第一个 black-flash push 之后、born push 之前, 且只 1 次
});
```

- [ ] **Step 3: Run tests, verify FAIL.**

- [ ] **Step 4: Implement** — drawHatch 改 12 帧（f0 静止蛋 / f1-4 摇晃 shake±3→±8 / f5-8 裂纹+shard / f9-10 全屏黑 `g.fillStyle=INK;g.fillRect(0,0,W,H)`），删「♪孵化音」字。runOnboarding hatch 循环：逐帧 `await io.push(...)` + `io.delay(160~230)`；**第一个 black-flash 帧 push 后立即 `io.playSound(SOUND.EVOLVE)`**（不在循环结束后）。末帧不画 sprite（揭晓交 born 屏）。

- [ ] **Step 5: Run tests, verify PASS.**

- [ ] **Step 6: Commit** — `git commit -am "feat(onboarding): 孵化12帧加戏(摇晃/裂纹/碎片/闪黑) + 闪黑帧即播EVOLVE音"`

---

### Task 7: 大木开场屏（drawOak Oak 立绘 + 页码点 + oak scene page/total）

**Files:**
- Modify: `host/src/render/onboarding.js`（drawOak）
- Modify: `host/src/pet/onboarding.js`（oak scene 传 {page,total}）
- Test: `host/test/onboarding-render.test.js` + `host/test/onboarding.test.js`

**Port:** Oak 立绘 scale 2 + 文字居中 + 页码点从 `/tmp/cpb-oak/oakscreen.mjs`（已验证布局）。

- [ ] **Step 1: Write failing tests**

```js
// onboarding-render.test.js: 页码点随 page 变化
test("oak screen page dots reflect current page", async () => {
  const p1 = await renderOnboarding({ kind: "oak", lines: ["a"], page: 1, total: 4 });
  const p4 = await renderOnboarding({ kind: "oak", lines: ["a","b","c","d"], page: 4, total: 4 });
  assert.ok(!p1.pngBuffer.equals(p4.pngBuffer), "different page must render different dots");
});
```

```js
// onboarding.test.js: runOnboarding oak scene 带 page/total
test("runOnboarding passes {page,total} to each oak scene", async () => {
  const scenes = [];
  const io = makeIoCapturingScenes(scenes);   // push 记录传入 scene
  // 驱动 oak 阶段(逐页 KEY)...
  const oakScenes = scenes.filter(s => s.kind === "oak");
  assert.ok(oakScenes.every(s => typeof s.page === "number" && s.total === oakScenes.length));
});
```

- [ ] **Step 2: Run tests, verify FAIL.**

- [ ] **Step 3: Implement** — `pet/onboarding.js` oak 循环 push `{ kind:"oak", lines: OAK_LINES.slice(0,page), page, total: OAK_LINES.length }`。`drawOak(g, lines, page, total)`：标题「大木博士」+ 下划线 → `await loadOakSprite()` drawSprite scale 2 居中 y46 → 4 行 17px 居中 y196+i*24 → 页码点（当前页实心其余描边）→「▶ KEY」。drawOak 变 async（renderOnboarding 的 oak 分支 `await`）。

- [ ] **Step 4: Run tests, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(onboarding): 大木开场屏 Oak立绘 + 页码点 + oak scene 传page/total"`

---

### Task 8: 诞生庆祝屏（drawBorn 放射线 + ✦）

**Files:**
- Modify: `host/src/render/onboarding.js`（drawBorn）
- Test: `host/test/onboarding-render.test.js`（追加）

**Port:** rays() 从 `mockups/09-visual-polish.html`。

- [ ] **Step 1: Write failing test**

```js
test("born screen renders rays + sparkle title for the species", async () => {
  const born = await renderOnboarding({ kind: "born", species: "bulbasaur", name: "妙蛙种子" });
  // 与无放射线的旧 born 不同: 这里断言渲染成功且非空; 放射线/✦ 视觉靠离线图人工确认
  assert.ok(born.pngBuffer.length > 0);
  const eevee = await renderOnboarding({ kind: "born", species: "eevee", name: "伊布" });
  assert.ok(!born.pngBuffer.equals(eevee.pngBuffer), "different species born differ");
});
```

- [ ] **Step 2: Run test, verify** (现 drawBorn 已渲不同 species → 可能 PASS；本任务加放射线+✦ 视觉).

- [ ] **Step 3: Implement** — drawBorn：sprite 背后 `rays(g, cx, cy, 82, 108, 12)` → 标题「✦ {name} 诞生了！ ✦」24px 居中 → 「默认名 {name} · 想改名去 dashboard」12px → 「▶ KEY 开始养成」。

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(onboarding): 诞生屏放射线 + ✦ 标题 + 改名提示并入"`

---

### Task 9: heartCount 半心导出纯函数（layout.js）

**Files:**
- Modify: `host/src/render/layout.js`（`heartCount` 改 raw bond→0.5 步进并 export；`drawHeart` 支持 fill 0/0.5/1）
- Test: `host/test/layout.test.js`（追加；若无则新建）

- [ ] **Step 1: Write failing test**

```js
import { heartCount } from "../src/render/layout.js";

test("heartCount maps raw bond to 0-5 in half-heart steps", () => {
  assert.equal(heartCount(0), 0);
  assert.equal(heartCount(40), 1);
  assert.equal(heartCount(60), 1.5);    // round(60/40*2)/2 = round(3)/2 = 1.5
  assert.equal(heartCount(200), 5);
  assert.equal(heartCount(9999), 5);    // clamp
});
```

- [ ] **Step 2: Run test, verify FAIL** (heartCount 未 export / 现逻辑是 round(bond) 期望 0-5 心数非 raw bond).

- [ ] **Step 3: Implement** — layout.js：

```js
export function heartCount(rawBond) {
  const v = Math.round((Number(rawBond) || 0) / 40 * 2) / 2;
  return Math.max(0, Math.min(5, v));
}
```

`drawHearts(g,x,y,filled)`：`filled` 现为整数心数 → 改按 heartCount 的 0.5 值；每颗心 `drawHeart(g, x+i*step, y, fill_i)`，`fill_i = clamp(filled - i, 0, 1)`（得 0/0.5/1）。`drawHeart(g,x,y,fill)`：fill>=1 实心；fill===0.5 clip 左半填充 + 描边；fill<=0 仅描边。心可加大 step 至 ~20-22。

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(layout): heartCount 导出纯函数, raw bond → 半心精度"`

---

### Task 10: 日常屏物种名 + 可进化徽章 + buddy model 字段（layout.js + index.js）

**Files:**
- Modify: `host/src/index.js`（buddy model 加 species/readyToEvolve/raw bond）
- Modify: `host/src/render/layout.js`（drawBuddyPanel 物种名 + 徽章）
- Test: `host/test/layout.test.js` 或经 `renderFrame` 比对

- [ ] **Step 1: Write failing test**（经 renderFrame，不暴露私有 drawBuddyPanel）

```js
import { renderFrame } from "../src/render/frame.js";
import { SPECIES_ZH } from "../src/pet/species-meta.js";

function baseModel(extra) {
  return { p5h:12, pweek:34, todayCost:1, now: new Date(2026,5,10,14),
    weather:{cond:"多云",temp:12,humidity:50}, room:{t:21,h:45}, out:{t:12,h:50},
    buddy:{ spriteGray:null, spriteW:40, spriteH:40, mood:"happy", level:5, bond:40,
      expPct:40, bubble:"Bui!", species:"eevee", readyToEvolve:false, ...extra } };
}

test("ready-to-evolve badge differs from species-name line", async () => {
  const normal = await renderFrame(baseModel({ readyToEvolve:false }));
  const ready  = await renderFrame(baseModel({ readyToEvolve:true }));
  assert.ok(!normal.pngBuffer.equals(ready.pngBuffer), "badge state must render differently");
});
```

- [ ] **Step 2: Run test, verify FAIL** (drawBuddyPanel 暂无 species/badge 渲染).

- [ ] **Step 3: Implement**
  - `index.js` buddy model：加 `species: pet.species`、`readyToEvolve: pet.readyToEvolve`，`bond: pet.bond`（删 `bondHearts(pet.bond)` 预压；`bondHearts` 函数若无其他引用则删除）。
  - `layout.js drawBuddyPanel`：sprite 下 y190 居中画 `SPECIES_ZH[buddy.species]`（14px）；若 `buddy.readyToEvolve` 则该行改反色徽章「▲ 按 KEY 进化！」（`g.fillRect` 黑 bar y184-200 + PAPER 文字）。亲密度调 `drawHearts(g, x, y, heartCount(buddy.bond))`（传 raw bond 经 heartCount）。mood/Lv/exp 坐标不动。

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(layout): 日常屏物种名 + 可进化徽章 + buddy model 传 species/readyToEvolve/raw bond"`

---

### Task 11: playEvolutionAnimation 顺序多帧推送（新模块）

**Files:**
- Create: `host/src/render/evolution-anim.js`（`playEvolutionAnimation` + evolution 帧渲染）
- Test: `host/test/evolution-anim.test.js`

**Port:** 闪黑/双 sprite 交替/放射线揭晓几何从 `mockups/09-visual-polish.html` EVO 序列（剪影改正常 sprite）。

- [ ] **Step 1: Write failing test**（fake delay + spy transport）

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { playEvolutionAnimation } from "../src/render/evolution-anim.js";
import { SOUND } from "../src/transport/proto.js";

function spyTransport() {
  const events = []; let inFlight = false;
  return {
    events,
    async push(frame) {
      assert.equal(inFlight, false, "push must not overlap (sequential)");
      inFlight = true; await Promise.resolve(); inFlight = false;
      events.push({ t:"push" }); return { ok:true };
    },
    playSound(id){ events.push({ t:"sound", id }); },
  };
}

test("evolution animation pushes frames sequentially, plays EVOLVE once", async () => {
  const tr = spyTransport();
  await playEvolutionAnimation({ transport: tr, fromSpecies:"eevee", toSpecies:"espeon", delay: async () => {} });
  const pushes = tr.events.filter(e => e.t === "push").length;
  const sounds = tr.events.filter(e => e.t === "sound" && e.id === SOUND.EVOLVE).length;
  assert.ok(pushes >= 12, "expect black×2 + alt×8 + black×2 + reveal");
  assert.equal(sounds, 1, "EVOLVE played exactly once");
});

test("alternation frames differ for from vs to species", async () => {
  // 渲染 from-frame 和 to-frame, 断言两 bitmap 不同 (导出 renderEvolutionFrame 或捕获 push 的 frame)
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Implement**

```js
// host/src/render/evolution-anim.js
import { loadBuddySprite } from "./sprites.js";
import { zhName } from "../pet/species-meta.js";
import { SOUND } from "../transport/proto.js";
// renderEvolutionFrame(kind, {species, fromName, toName}) → {pngBuffer, bitmap}  (复用 imageDataToFrame)
//   kind: "black" | "sprite"(species) | "reveal"(species+toName) ; port mockup EVO 几何

export async function playEvolutionAnimation({ transport, fromSpecies, toSpecies, delay = realDelay }) {
  const seq = ["black","black", ...alt8(fromSpecies,toSpecies), "black","black", "reveal"];
  const gaps = [/* 420→110 递减 for alt, 固定 for black, ~1000 reveal */];
  for (let i = 0; i < seq.length; i++) {
    const frame = await renderEvolutionFrame(seq[i], { fromSpecies, toSpecies });
    await transport.push(frame);                      // 顺序: await 后再 delay
    if (i === 0) transport.playSound?.(SOUND.EVOLVE); // 第一帧闪黑后播一次
    await delay(gaps[i]);
  }
}
const realDelay = (ms) => new Promise(r => setTimeout(r, ms));
```

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(evolution): playEvolutionAnimation 顺序多帧推送 GB 闪白动画"`

---

### Task 12: runOneTick 进化分支接入动画 + 持久化顺序（index.js）

**Files:**
- Modify: `host/src/index.js`（runOneTick 进化 KEY 分支：evolvePet → saveState → playEvolutionAnimation → 日常帧）
- Test: `host/test/evolution-trigger.test.js`（追加集成）

- [ ] **Step 1: Write failing test**（mock transport，断言多帧 + saveState evolved）

```js
test("KEY evolution saves evolved state and pushes the animation", async () => {
  const statePath = join("out", "test-evo-anim-state.json");
  const framePath = join("out", "test-evo-anim-frame.png");
  writeState(statePath, { species:"eevee", bond:160, readyToEvolve:true });
  const pushed = [];
  const mock = mockPressingKey(framePath);
  const origPush = mock.push?.bind(mock);
  // 包裹 transport.push 计数 (或用注入 fake delay 的 transport)
  const state = await runOneTick({
    usage: usageWithTokens(0), weather: weather({temp:12,humidity:50}),
    statePath, framePath, now: new Date(2026,4,30,21),  // 夜→umbreon
    mock,
  });
  assert.equal(state.species, "umbreon");        // evolved + persisted
  // 断言动画帧被推送 (> 单帧)
});
```

> 注：进化动画需 fake/瞬时 delay，避免测试真等。runOneTick 进化分支调 playEvolutionAnimation 时传 `delay: async()=>{}`（测试态）或经 config 注入；保持现有 evolution-trigger 4 测试通过。

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Implement** — runOneTick 进化 KEY 分支（index.js:90 附近）：`evolvePet` 后先 `saveState(statePath, pet)` 落盘，再 `await playEvolutionAnimation({ transport: activeTransport, fromSpecies, toSpecies, delay })`，最后照常渲染推日常帧。delay 在测试可注入瞬时。确认现有 evolution-trigger 4 用例仍 PASS。

- [ ] **Step 4: Run test, verify PASS（含现有 4 用例）.**

- [ ] **Step 5: Commit** — `git commit -am "feat(evolution): runOneTick 进化分支接入全屏动画 + 先存档再播"`

---

### Task 13: 全量回归 + 1-bit 全表面自验

**Files:** 无（验证任务）

- [ ] **Step 1: 全量测试** — `cd host && node --test --test-concurrency=1 --test-force-exit`。Expected: 0 fail（设备插着 + host 不跑时也 0 fail）。若有 fail，修到绿。

- [ ] **Step 2: 全表面离线渲染自验**（参考 `/tmp/cpb-audit/run.mjs`）— 经真实管线渲染：
  - onboarding 全流程：大木(Oak+页码) → 选蛋(4蛋+联动+反色) → 孵化逐帧(抖/裂/闪黑) → 诞生(放射线+✦)。
  - 日常屏 × 全 18 物种（物种名 + 半心 + 火焰）+ readyToEvolve 态徽章。
  - 进化动画逐帧（闪黑/双 sprite 交替/揭晓）≥1 条线（eevee→espeon）。
  人工 Read 每张确认清晰、无残影、无叠字。

- [ ] **Step 3: 真机重置验证**（设备接着时）— 杀 host 进程 + 删 `out/state.json` + `.bak` + `.tmp` → 重启 host → 设备走完 onboarding → 日常屏。确认真机渲染与离线一致。

- [ ] **Step 4: Commit**（若 Step 2/3 发现并修了问题）+ 准备 finishing-a-development-branch 合并 `feat/hatching-2b` → main。

---

## Self-Review（写完核对，已执行）

- **Spec 覆盖**：A→Task7、B→Task4、C→Task5、D→Task6、E→Task8、F→Task1+9+10、G→Task11+12；bake/oak→Task2+3；反向测试→Task4+6 内改写；全表面自验→Task13。✓ 无遗漏。
- **Placeholder**：几何细节 port 自已验证 mockup（item-eggs.html/09-visual-polish.html/oakscreen.mjs），非 TODO。✓
- **类型一致**：`drawEgg(g,species,cx,cy,scale,{crack,shake})`、`heartCount(rawBond)`、`playEvolutionAnimation({transport,fromSpecies,toSpecies,delay})`、`loadOakSprite()`、`SPECIES_ZH/zhName` 跨任务一致。✓
- **TDD/hermetic**：每任务先写/改测试再实现；新测试全 mock/fake transport，设备插着不抢串口。✓
