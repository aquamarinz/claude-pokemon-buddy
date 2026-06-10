# 孵化 2a：养成基础 + 御三家数据 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。本项目派发走 codeagent CLI `--backend claude`（铁律#2；codex block 到 2026-06-11，用户授权暂用 claude backend）。每 task TDD：写失败测试 → 验证失败 → 最小实现 → 验证通过 → commit。

**Goal:** 养成从 0 开始（newborn `bond=0`、约 2 周首进化）+ 御三家可养（数据驱动线性进化）+ 脏档重置，为孵化 onboarding（2b）打好状态/数值/数据基础。

**Architecture:** 调 `PARAMS` 进化节奏；`evolution.js` 改为 load 整个 `seed/evolution/` 目录并新增御三家进化数据（`level` 触发）；`needsMet` 加 `level >=` 分支；`ensurePet` 改为 newborn `bond=0` + `hatched` 标志 + 无 hatched（含脏档）重置；`app.js` 补御三家物种。**不含 onboarding UI（2b）**——本期无 hatched 时直接给 newborn eevee，2b 再插入"大木→蛋→4选1→孵化"流程。

**Tech Stack:** Node ESM、node:test、已有数据驱动进化引擎（`resolveEvolution`/`eligibleBranches`/`needsMet`）。

**数值基调（v0，spec §6/§17「平衡参数表」，实测可调）：**
- 伊布看亲密：`evolveBond 160 → 56`（newborn 0 起、`bondPerActiveDay=4` → 约 14 天到 56 ≈ 2 周）。
- 御三家看等级：stage1 `level 14`、stage2 `level 30`（重度用户每天约 +1 级 → 首进化约 2 周，与伊布节奏对齐）。

---

### Task 1: 进化节奏（newborn 0 起、约 2 周首进化）

**Files:**
- Modify: `host/src/pet/sim.js`（`PARAMS.evolveBond 160 → 56`）
- Modify: `host/seed/evolution/eevee.json`（5 个亲密分支 `needs.bond 160 → 56`）
- Test: `host/test/sim.test.js`（新建或追加）

- [ ] **Step 1: 写失败测试**

`host/test/sim.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PARAMS, applyDailyGrowth } from "../src/pet/sim.js";

test("evolveBond is the ~2-week-from-zero threshold (56)", () => {
  assert.equal(PARAMS.evolveBond, 56);
});

test("newborn bond 0 reaches evolveBond in ~14 active days at bondPerActiveDay", () => {
  let pet = { level: 1, exp: 0, bond: 0, todayCreditedExp: 0, todayCreditedBond: 0, lastGrowthDay: null };
  let days = 0;
  for (let i = 0; i < 30; i += 1) {
    const day = `2026-06-${String(10 + i).padStart(2, "0")}`;
    pet = applyDailyGrowth(pet, { todayTokens: 60_000, today: day });
    days += 1;
    if (pet.bond >= PARAMS.evolveBond) break;
  }
  assert.ok(days >= 12 && days <= 16, `expected ~14 days, got ${days}`);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test test/sim.test.js`
Expected: FAIL（`evolveBond` 现为 160）

- [ ] **Step 3: 最小实现**

`host/src/pet/sim.js`：`PARAMS.evolveBond` 由 `160` 改为 `56`。
`host/seed/evolution/eevee.json`：5 个带 `"bond": 160` 的分支（espeon/umbreon/sylveon/leafeon/glaceon）全改为 `"bond": 56`（三石分支无 bond，不动）。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test test/sim.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add host/src/pet/sim.js host/seed/evolution/eevee.json host/test/sim.test.js
git commit -m "feat(growth): evolveBond 56 — newborn 0 起约2周首进化"
```

---

### Task 2: needsMet 支持 level + 御三家进化数据

**Files:**
- Modify: `host/src/pet/evolution.js`（`needsMet` 加 `level >=`；TABLE 改为 load 整个目录）
- Modify: `host/src/index.js`（`evolutionContext` 加 `level: pet.level`）
- Create: `host/seed/evolution/bulbasaur.json` / `charmander.json` / `squirtle.json`
- Test: `host/test/evolution.test.js`（新建或追加）

- [ ] **Step 1: 写失败测试**

`host/test/evolution.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEvolution } from "../src/pet/evolution.js";

test("bulbasaur evolves to ivysaur at level 14", () => {
  assert.equal(resolveEvolution("bulbasaur", { level: 13 }).auto, null);
  assert.equal(resolveEvolution("bulbasaur", { level: 14 }).auto, "ivysaur");
});

test("charmander -> charmeleon at 14, charmeleon -> charizard at 30", () => {
  assert.equal(resolveEvolution("charmander", { level: 14 }).auto, "charmeleon");
  assert.equal(resolveEvolution("charmeleon", { level: 29 }).auto, null);
  assert.equal(resolveEvolution("charmeleon", { level: 30 }).auto, "charizard");
});

test("squirtle line loads (data-driven, no code per species)", () => {
  assert.equal(resolveEvolution("squirtle", { level: 14 }).auto, "wartortle");
});

test("eevee branches still resolve by bond (regression)", () => {
  assert.equal(resolveEvolution("eevee", { bond: 56, daytime: true }).auto, "espeon");
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test test/evolution.test.js`
Expected: FAIL（御三家未 load、`needsMet` 不认 `level`）

- [ ] **Step 3: 实现**

`host/src/pet/evolution.js` 顶部，TABLE 从「只读 eevee.json」改为「load 整个 evolution 目录」：
```js
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = new URL("../../seed/evolution/", import.meta.url);
const TABLE = {};
for (const file of readdirSync(DIR)) {
  if (file.endsWith(".json")) {
    Object.assign(TABLE, JSON.parse(readFileSync(fileURLToPath(new URL(file, DIR)), "utf8")));
  }
}
```
`needsMet` 加 `level` 分支（在 `bond` 那行后）：
```js
if (key === "level") return (ctx.level ?? 0) >= value;
```
`host/src/index.js` 的 `evolutionContext` 返回对象加 `level: pet.level`（与 `bond` 同级）。

新增 3 个御三家进化链（`host/seed/evolution/`）：

`bulbasaur.json`:
```json
{
  "bulbasaur": { "stage": 0, "branches": [{ "to": "ivysaur",  "needs": { "level": 14 }, "priority": 1 }] },
  "ivysaur":   { "stage": 1, "branches": [{ "to": "venusaur", "needs": { "level": 30 }, "priority": 1 }] },
  "venusaur":  { "stage": 2, "branches": [] }
}
```
`charmander.json`:
```json
{
  "charmander": { "stage": 0, "branches": [{ "to": "charmeleon", "needs": { "level": 14 }, "priority": 1 }] },
  "charmeleon": { "stage": 1, "branches": [{ "to": "charizard",  "needs": { "level": 30 }, "priority": 1 }] },
  "charizard":  { "stage": 2, "branches": [] }
}
```
`squirtle.json`:
```json
{
  "squirtle":  { "stage": 0, "branches": [{ "to": "wartortle", "needs": { "level": 14 }, "priority": 1 }] },
  "wartortle": { "stage": 1, "branches": [{ "to": "blastoise", "needs": { "level": 30 }, "priority": 1 }] },
  "blastoise": { "stage": 2, "branches": [] }
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test test/evolution.test.js test/sim.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add host/src/pet/evolution.js host/src/index.js host/seed/evolution/bulbasaur.json host/seed/evolution/charmander.json host/seed/evolution/squirtle.json host/test/evolution.test.js
git commit -m "feat(evolution): needsMet 支持 level + 御三家数据驱动线性进化"
```

---

### Task 3: ensurePet newborn bond=0 + hatched 标志 + 脏档重置

**Files:**
- Modify: `host/src/index.js`（`ensurePet` 重写；导出供测试）
- Modify: `host/src/state.js`（`salvageState` 保留 `hatched`/`name`）
- Modify: `host/test/evolution-trigger.test.js`（现有 fixture 的 `writeState` 加 `hatched: true`，否则被新 ensurePet 当未孵化重置）
- Test: `host/test/ensure-pet.test.js`（新建）

**契约**：无 `hatched` 标志 = 新档或 pre-hatched 脏档 → 一律重置为 newborn（`species:"eevee", level:1, bond:0, hatched:true` + 新 personality）。有 `hatched` → 填默认并保留。（2b 会把"无 hatched → newborn eevee"替换成"无 hatched → onboarding → newborn 选中物种"。）

- [ ] **Step 1: 写失败测试**

`host/test/ensure-pet.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensurePet } from "../src/index.js";

const TODAY = "2026-06-10";

test("no hatched flag → newborn eevee bond 0 (fresh start)", () => {
  const pet = ensurePet({ schemaVersion: 1 }, TODAY, () => 0.5);
  assert.equal(pet.species, "eevee");
  assert.equal(pet.level, 1);
  assert.equal(pet.bond, 0);
  assert.equal(pet.hatched, true);
});

test("dirty pre-hatched save (level 7 / bond 129 / no hatched) → reset newborn", () => {
  const dirty = { schemaVersion: 1, _rebuilt: true, species: "eevee", level: 7, bond: 129 };
  const pet = ensurePet(dirty, TODAY, () => 0.5);
  assert.equal(pet.level, 1);
  assert.equal(pet.bond, 0);
  assert.equal(pet.hatched, true);
});

test("hatched save is preserved (not reset)", () => {
  const saved = { schemaVersion: 1, hatched: true, species: "umbreon", level: 9, bond: 70,
    nature: "佛系1", iv: [1,2,3,4,5,6], characteristic: "爱睡午觉" };
  const pet = ensurePet(saved, TODAY, () => 0.5);
  assert.equal(pet.species, "umbreon");
  assert.equal(pet.level, 9);
  assert.equal(pet.bond, 70);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd host && node --test test/ensure-pet.test.js`
Expected: FAIL（`ensurePet` 未导出 / 仍 bond 120 / 无 hatched 逻辑）

- [ ] **Step 3: 实现**

`host/src/index.js` 把 `function ensurePet(...)` 改为导出并重写：
```js
export function ensurePet(state, today, personalityRng = Math.random) {
  // No hatched flag = fresh start (or pre-hatched dirty save) → newborn from bond 0.
  // (2b inserts the egg/choose/hatch flow before this; for now it's a plain eevee newborn.)
  if (!state?.hatched) {
    return {
      species: "eevee",
      level: 1,
      exp: 0,
      bond: 0,
      streak: 0,
      shield: 0,
      lastSettled: today,
      lastGrowthDay: null,
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      hatched: true,
      ...rollPersonality(personalityRng),
    };
  }

  const pet = {
    species: "eevee",
    level: 1,
    exp: 0,
    bond: 0,
    streak: 0,
    shield: 0,
    lastSettled: today,
    lastGrowthDay: null,
    todayCreditedExp: 0,
    todayCreditedBond: 0,
    ...state,
  };
  return hasPersonality(pet) ? pet : { ...pet, ...rollPersonality(personalityRng) };
}
```
（删除旧 `ensurePet` 里基于 `state?.level` 三元分支的逻辑。`hasPersonality`/`rollPersonality` 保留。）

`host/src/state.js` 的 `salvageState` 加保留 `hatched`/`name`：
```js
copyBoolean(out, state, "hatched");
copyString(out, state, "name");
```

`host/test/evolution-trigger.test.js` 的 `writeState(statePath, overrides)` 里 `JSON.stringify({...})` 加 `hatched: true,`（这样现有进化测试的 fixture 不被新 ensurePet 当未孵化重置）。

- [ ] **Step 4: 跑测试验证通过**

Run: `cd host && node --test test/ensure-pet.test.js test/evolution-trigger.test.js`
Expected: PASS（ensure-pet 3 个 + evolution-trigger 4 个仍绿）

- [ ] **Step 5: Commit**

```bash
git add host/src/index.js host/src/state.js host/test/ensure-pet.test.js host/test/evolution-trigger.test.js
git commit -m "feat(state): newborn bond=0 + hatched 标志 + 脏档(无hatched)重置"
```

---

### Task 4: dashboard SPECIES 补御三家 + 进化形态

**Files:**
- Modify: `host/src/web/public/app.js`（`SPECIES` 表补 squirtle + 6 个进化形态）

**契约**：dashboard 用 `SPECIES[key].dex` 拉 PokeAPI sprite 显示。御三家全家族要登记，否则 box/buddy 显示物种名而非图。

- [ ] **Step 1: 实现（无独立单测，dashboard 纯展示；改完人工核对）**

`host/src/web/public/app.js` 的 `const SPECIES = {...}` 追加（dex 用国际编号）：
```js
  ivysaur:    { dex: 2,  label: "妙蛙草 Ivysaur" },
  venusaur:   { dex: 3,  label: "妙蛙花 Venusaur" },
  charmeleon: { dex: 5,  label: "火恐龙 Charmeleon" },
  charizard:  { dex: 6,  label: "喷火龙 Charizard" },
  squirtle:   { dex: 7,  label: "杰尼龟 Squirtle" },
  wartortle:  { dex: 8,  label: "卡咪龟 Wartortle" },
  blastoise:  { dex: 9,  label: "水箭龟 Blastoise" },
```

- [ ] **Step 2: 核对 + Commit**

核对：`node -e "const s=require('./host/src/web/public/app.js')"` 不可行（浏览器脚本），改用 `node --check host/src/web/public/app.js` 确认语法。
```bash
node --check host/src/web/public/app.js
git add host/src/web/public/app.js
git commit -m "feat(dashboard): SPECIES 补御三家全家族(squirtle + 6 进化形态)"
```

---

### Task 5: 全量回归

- [ ] **Step 1: 跑全套非串口测试**

Run:
```bash
cd host && node --test test/sim.test.js test/evolution.test.js test/ensure-pet.test.js test/evolution-trigger.test.js test/usage.test.js test/rate-limits.test.js test/usage-merge.test.js test/dashboard-sensors.test.js test/sounds.test.js
```
Expected: 全 PASS。报告 tests/pass/fail 统计。

---

## Self-Review

**1. Spec 覆盖**（对照 spec §3/§5/§6）：
- 亲密度从 0 ← Task 1（evolveBond 56）+ Task 3（newborn bond 0）✓
- 约 2 周首进化 ← Task 1（伊布 56）+ Task 2（御三家 level 14）✓
- 御三家数据驱动进化 ← Task 2（3 个 json + level needsMet + 目录 load）✓
- 脏档重置 ← Task 3（无 hatched → 重置 newborn）✓
- hatched 标志（2b 基础）← Task 3 ✓
- dashboard 御三家显示 ← Task 4 ✓
- **不含 onboarding UI** = 本期非目标，2b 处理 ✓

**2. Placeholder 扫描**：无 TBD；御三家 json、ensurePet、测试均完整。数值标注 v0/实测可调（非占位，是 spec §17 约定的基调）。

**3. 类型一致性**：`needsMet` 的 `level` 键（Task 2）↔ 御三家 json 的 `needs.level`（Task 2）↔ `evolutionContext` 注入的 `level`（Task 2）一致；`hatched` 标志在 `ensurePet`（Task 3）/`salvageState`（Task 3）/测试 fixture（Task 3）一致。`resolveEvolution`/`eligibleBranches` 签名不变（只扩 needsMet 内部）。

**4. 风险**：改 `ensurePet` 会影响所有读档路径——Task 3 已显式同步现有 `evolution-trigger.test.js` fixture（加 hatched）。Task 5 全量回归兜底捕捉其它受影响测试。
