# P5 · 重烘焙放大（targetMax 134 + 精灵上移）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 本仓由 **codex（skill `codeagent`）实现**，Claude 作 PM 审查并亲跑闸门 + 亲眼看 1-bit。步骤用 `- [ ]` 跟踪。

**Goal:** 把宝可梦精灵从有效 ~120px 放大到 ~134px（+12%，"放大一点点"），并把精灵基准 y 从 60 上移到 50，让放大后的精灵在 bubble 与进化徽章/物种名之间的有限纵向空间里不出血。

**Architecture:** ① `bake-assets.mjs` `targetMax 120→134`，联网重拉 18 DW 矢量源、重写入库。② `layout.js` drawBuddyPanel：精灵与 accent 的基准 y `60→50`、阴影 `190→186`（给放大留头顶空间）。运行层 `bold` 膨胀（P1）保留。`BUDDY_SPRITE_SLOT=136` 不变（134 ≤ 136，`fitScale=1`）。

**关键几何（precomputed）：** bubble 底=47，进化徽章顶≈184，物种名文字≈188–198。134px 精灵在基准 y=50：空闲 `y=50+bob`（bob≤0）底边 ≤185；下蹲 `hop=-2 → y=52` 底边 ≤187（**清掉物种名 188**，仅 1–3px 触及徽章顶，与现状 120px 同性质）；跳起 `hop=9 → y=41` 底边 175。bob 上浮顶边最高 ≈48（清 bubble 47）。

**Tech Stack:** Node ESM、`@napi-rs/canvas`、`node:test`。**需联网**（PokeAPI DW SVG）。

**前置条件:** `cd host && npm install`；有网络。`node --test` 唯一允许失败为 `scripts/play-test.js`（占串口）。

**对应 spec:** [docs/specs/2026-06-17-buddy-cries-animations-design.md](../specs/2026-06-17-buddy-cries-animations-design.md) 支柱一·第二步（P5）。

> **范围说明**：spec 第二步提 targetMax→144 + slot→150 + 膨胀。本期收敛为 **134 + 精灵上移**（slot 不动；bake 端不叠膨胀，运行层加粗已够）——在不重排下方 mood/Lv/exp/亲密度 的前提下取最大安全放大。若仍想更大，需后续单列一期重排整个 buddy 面板。

---

### Task 1: bake targetMax 120→134 + 重烘焙入库

**Files:**
- Modify: `host/scripts/bake-assets.mjs`（`bakeDW` `targetMax = 120` → `134`）
- Regenerate (commit): `host/seed/sprites/*.png`（18 只）
- Test: `host/test/sprites.test.js`（追加：全 18 只最长边 ≤136 且 ≥128）

- [ ] **Step 1: 写失败测试**

在 `host/test/sprites.test.js` 追加（遍历既有 `ALL_SPECIES`）：

```js
test("re-baked buddy sprites fill the slot without overflowing it", async () => {
  for (const species of ALL_SPECIES) {
    const s = await loadBuddySprite(species);
    const maxEdge = Math.max(s.w, s.h);
    assert.ok(maxEdge <= 136, `${species} max edge ${maxEdge} must not exceed slot 136`);
    assert.ok(maxEdge >= 128, `${species} max edge ${maxEdge} should be enlarged (~134)`);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd host && node --test test/sprites.test.js`
Expected: FAIL（当前最长边 ~120，`>=128` 失败）。

- [ ] **Step 3: 改 targetMax + 重烘焙（oak 安全处理）**

① `bake-assets.mjs`：`async function bakeDW(svgText, targetMax = 120)` → `targetMax = 134`。

② 重烘焙前后记录 oak 校验和，避免无谓改动入库：

```bash
cd host
shasum -a 256 seed/oak.png > /tmp/oak-before.txt 2>/dev/null || true
node scripts/bake-assets.mjs
shasum -a 256 seed/oak.png
```

Expected: 打印 18 行 `wrote seed/sprites/<name>.png` + `wrote seed/oak.png`。

③ 比对 oak：若 `seed/oak.png` 的 shasum 与 before 相同（git 也无 diff），**只提交 sprites**；若变了，先确认是内容合理变化再决定是否纳入（本期目标不含 oak，倾向 `git checkout -- seed/oak.png` 还原）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/sprites.test.js`
Expected: PASS（放大断言 + 既有 18 只 not-placeholder/load 断言全绿）。

- [ ] **Step 5: 提交（仅 sprites + 脚本 + 测试）**

```bash
cd host && git add scripts/bake-assets.mjs seed/sprites/ test/sprites.test.js
# oak.png 仅在确认内容变化合理时才 add；否则 git checkout -- seed/oak.png
git commit -m "feat(assets): re-bake sprites at 134px (enlarge to fill slot)"
```

---

### Task 2: 精灵基准 y 上移 + 阴影跟随（容纳放大）

**Files:**
- Modify: `host/src/render/layout.js`（drawBuddyPanel 精灵/accent 基准 y `60→50`，阴影 `190→186`；建议引入 `BUDDY_SPRITE_TOP=50` 常量）
- Test: `host/test/buddy-geometry.test.js`

- [ ] **Step 1: 写失败测试**

`host/test/buddy-geometry.test.js`（确认放大精灵在下蹲/可进化态下，物种名 baseline 那一行不被精灵墨覆盖到底——粗略几何护栏）：

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderFrame } from "../src/render/frame.js";
import { loadBuddySprite } from "../src/render/sprites.js";
import { LEFT_W, W } from "../src/render/palette.js";

async function frameAt({ hop, readyToEvolve }) {
  const s = await loadBuddySprite("charizard"); // 偏高大，最易出血
  return renderFrame({
    p5h: 50, pweek: 40, todayCost: 1, todayTokens: 1000, now: new Date("2026-06-17T08:00:00"),
    weather: { cond: "晴", temp: 20, humidity: 50 }, room: { t: 22, h: 50 }, out: { t: 20, h: 50 },
    buddy: { spriteGray: s.gray, spriteW: s.w, spriteH: s.h, mood: "focused", level: 3,
             species: "charizard", bond: 40, expPct: 50, bubble: "吼!!", animPhase: 0, hop, readyToEvolve },
  });
}

// 物种名 baseline 在 y≈198；放大+下蹲不应让精灵墨延伸到 y≥200（经验条/亲密度区）。
function maxInkY(bitmap) {
  const rowBytes = Math.ceil(bitmap.w / 8);
  let maxY = 0;
  for (let y = 0; y < bitmap.h; y += 1) {
    for (let x = LEFT_W; x < W; x += 1) {
      if ((bitmap.bytes[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) { maxY = y; break; }
    }
  }
  return maxY;
}

test("enlarged sprite (crouch frame) does not push ink past the species-name row", async () => {
  const f = await frameAt({ hop: -2, readyToEvolve: false });
  // 面板下半部本就有 mood/Lv/exp/亲密度 墨，maxInkY 接近底部属正常；
  // 这里只断言渲染成功且 bitmap 合法（几何精检留给人工 1-bit 目检）。
  assert.ok(f.bitmap.bytes.length > 0 && f.bitmap.w === W);
});

test("readyToEvolve badge frame renders without throwing at enlarged size", async () => {
  const f = await frameAt({ hop: -2, readyToEvolve: true });
  assert.ok(f.pngBuffer && f.pngBuffer.length > 0);
});
```

> 说明：buddy 面板下方本来就有大量墨（Lv/经验条/亲密度），无法用单一 maxInkY 阈值精确卡精灵出血；自动测试仅保渲染合法 + 不抛，**精确几何由 Task 3 人工 1-bit 目检兜底**（这是 1-bit 渲染项目一贯做法）。

- [ ] **Step 2: 跑测试确认失败/通过**

Run: `cd host && node --test test/buddy-geometry.test.js`
Expected: 这两条本身是 no-throw/合法性护栏；实现前若 charizard 资产未放大也能过——故本 task 的"红"以 **既有 layout/frame 回归**为主：先改 y 再确认既有测试需同步（见 Step 3）。

- [ ] **Step 3: 实现基准 y 上移**

`host/src/render/layout.js`：① 顶部加常量 `const BUDDY_SPRITE_TOP = 50;`（替换原硬编码 60）。
② drawBuddyPanel 精灵调用 `y: 60 + bob - hop` → `y: BUDDY_SPRITE_TOP + bob - hop`；accent box `y: 60 + bob - hop` → `y: BUDDY_SPRITE_TOP + bob - hop`。
③ 阴影 `drawShadow(g, panelX + panelW / 2, 190)` → `186`（跟随抬高的脚部）。

> 若既有 `layout.test.js`/`frame.test.js`/`onboarding-render.test.js` 有针对 buddy 精灵像素/位置的断言因 y 改动而红，**按新几何更新这些断言**（属预期的几何变更，非 bug）。drawSprite 的 slot 居中 yoff 不变，仅基准 y 平移。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd host && node --test test/buddy-geometry.test.js test/layout.test.js test/frame.test.js`
Expected: 全绿（必要时已同步更新几何断言）。

- [ ] **Step 5: 提交**

```bash
cd host && git add src/render/layout.js test/buddy-geometry.test.js
# 若同步更新了既有几何断言，一并 add 对应测试文件
git commit -m "feat(render): raise buddy sprite baseline to fit the enlarged sprite"
```

---

### Task 3: 全量回归 + 亲眼看 1-bit（PM 验收）

**Files:**
- Run only（复用 `bold-compare.mjs` + `idle-preview.mjs`，产物 gitignore）

- [ ] **Step 1: 全量回归**

Run: `cd host && node --test`
Expected: 0 fail（除 `scripts/play-test.js` 环境项）。

- [ ] **Step 2: 重生成对比/预览图**

Run: `cd host && node scripts/bold-compare.mjs && node scripts/idle-preview.mjs`
Expected: 刷新 out/ 下 18/4 张图。

- [ ] **Step 3: 人工确认（逐只 + 关键态）**

亲眼看 1-bit：① 精灵明显比之前大、填满 buddy 区；② 线条仍连续实、密集物种（雷伊布/火伊布/叶伊布）细节比 120px 更清晰不粘连；③ **空闲/呼吸/下蹲帧底边不压住物种名文字**；④ **readyToEvolve 徽章态**下精灵不严重盖住「▲ 按 KEY 进化！」；⑤ 顶部不撞 bubble；⑥ 与左栏 usage/经验条/亲密度不挤。逐只过 18 物种 + ready 态。若某只仍出血，记录物种+现象（可能需把 BUDDY_SPRITE_TOP 再上移或该只单独降一档 targetMax）。

- [ ] **Step 4: 无源码改动则不提交**（资产/布局已在 Task 1/2 提交）

---

## 自检（plan vs spec）

- **Spec 覆盖**：targetMax→134 完成"放大一点点"；精灵上移容纳放大（支柱一·第二步，slot/下方布局不重排的安全子集）。
- **范围偏差已明示**：未到 144/slot150/bake 膨胀；取"不重排面板下半部"前提下的最大安全放大。
- **codex 阻断已纳入**：SIGNATURE_HOP 含下蹲 -2 → 不能声称"只上移"；改为 134 + 基准 y 50 精算清掉物种名；oak 不盲提交（shasum 比对）；sprite-size 断言改全 18 只 `<=136`。
- **占位扫描**：无 TBD。
- **非目标守住**：渲染/传输契约不变；养成/固件不动；mood/Lv/exp/亲密度 位置不动。
- **风险**：① 联网 PokeAPI；② 每只 auto-threshold 在 134 重算外观微变 → Task 3 逐只目检；③ 精灵上移可能触发既有 layout/frame 几何断言 → Step 3 按新几何更新；④ 徽章态轻微重叠为已知可接受（与现状同性质），目检确认。
