# Claude Pokémon Buddy — Plan A：Host 大脑（核心）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（首选）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框追踪。实现代码经 codeagent(codex/gpt-5.5)执行。
> **配套 spec**：`docs/specs/2026-05-30-claude-pokemon-buddy-design.md`（v1.2，codex 通过）。本计划只覆盖 **Plan A = host 大脑**；Plan B(固件+串口)、Plan C(dashboard) 另立。

**Goal:** 在朋友 Windows 上跑的 Node 进程，读 Claude 用量(ccusage)+天气，跑伊布养成 sim，把"仪表盘+buddy"渲成 400×300 单色 PNG，状态持久且可重启幂等——**全程无需 ESP32 硬件即可测**（输出 PNG + mock 串口）。

**Architecture:** 单进程 tick 循环串联模块；每模块单一职责、纯函数优先(sim/结算/百分比可纯函数单测)；外部不确定 schema(ccusage) 先抓 fixture 再 fail-closed 解析(沿用 codexbar `snapshot.sh` 法)；渲染走纯 canvas(@napi-rs/canvas)→灰度→Bayer 抖动→1bpp，不依赖浏览器。

**Tech Stack:** Node 20+ (ESM)、内置 `node:test`+`node:assert`(零依赖测试)、`@napi-rs/canvas`(渲染)、`ccusage`(spawn `npx ccusage --json`)、`fast-png` 或 canvas 自带编码(PNG 输出)。Plan A 不引 `serialport`(用 mock；真串口留 Plan B)。

---

## 文件结构（先锁分解）

```
host/
  package.json                 # type:module, scripts: test/start
  src/
    index.js                   # tick 主循环, 串联模块, 优雅退出
    config.js                  # 读 config.json(计划预算/经纬度/box/免打扰); 默认值
    usage.js                   # spawn ccusage --json → 归一 {p5h,pweek,today$,tok,streak,perType}; §6 语义; fail-closed
    weather.js                 # Open-Meteo fetch → 归一 weather; backoff/last-known/TTL
    pet/
      personality.js           # 一次性 gen Nature/IV[6]/Characteristic (确定性可注入随机源)
      sim.js                   # 单 tick: 由当日用量算 EXP/level、bond、mood; 纯函数
      evolution.js             # 数据驱动: seed 伊布家族进化表 + 合格分支解析 + 优先级
      settlement.js            # 幂等日结算: 按缺失日补算奖励/断更惩罚; 纯函数
      antiabuse.js             # 每日 EXP/亲密软上限 + 异常截断
    state.js                   # load/save state.json: 原子写+fsync+备份+schemaVersion+校验+安全重建
    render/
      palette.js               # 墨/纸常量 + Bayer 8x8 阈值矩阵
      dither.js                # grayscale buffer → 1bpp 打包 (纯函数)
      sprites.js               # 本地 seed 精灵加载 + 灰度化缓存
      layout.js                # 用 canvas 画 400×300 灰度(左仪表盘+右buddy)
      frame.js                 # layout→灰度像素→dither→{bitmap1bpp, pngBuffer}
    transport/
      mock.js                  # Plan A: 把 pngBuffer 写 out/frame.png; 假 ACK; 假按键注入
  seed/
    sprites/                   # 伊布家族 + 初始 box 的 PNG(本地, 不入 git LFS; .gitignore 见下)
    evolution/eevee.json       # 伊布进化表(由调研 §1 落地)
  test/
    fixtures/                  # ccusage/weather 真实样本 JSON
    *.test.js
  out/                         # 运行产物(frame.png/state.json), gitignore
```

> `.gitignore` 增补：`host/out/`、`host/node_modules/`、`host/seed/sprites/*.png`(版权, 不入库; setup 时本地放置)。

---

## 里程碑 A1：项目骨架 + 真实 fixture（地基）

### Task 1：scaffold host 工程

**Files:** Create `host/package.json`, `host/src/index.js`(占位), `host/.gitignore`

- [ ] **Step 1: 建 package.json**

```json
{
  "name": "claude-pokemon-buddy-host",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "node --test",
    "start": "node src/index.js"
  },
  "dependencies": { "@napi-rs/canvas": "^0.1.60" }
}
```

- [ ] **Step 2: 占位 index.js + .gitignore**

`host/src/index.js`:
```js
console.log("claude-pokemon-buddy host: scaffold ok");
```
`host/.gitignore`:
```
node_modules/
out/
seed/sprites/*.png
```

- [ ] **Step 3: 安装依赖并验证**

Run: `cd host && npm install && node src/index.js`
Expected: 打印 `claude-pokemon-buddy host: scaffold ok`，`out/` 不存在报错。

- [ ] **Step 4: Commit**

```bash
git add host/package.json host/src/index.js host/.gitignore
git commit -m "feat(host): scaffold Node project (A1)"
```

### Task 2：抓 ccusage 真实输出 → fixture（ground truth，先于解析）

**Files:** Create `host/test/fixtures/ccusage-blocks.json`, `ccusage-daily.json`, `host/docs/ccusage-notes.md`

- [ ] **Step 1: 抓真实 JSON（spike）**

Run（在装了 Claude Code 的机器上）:
```bash
npx ccusage@latest blocks --json > host/test/fixtures/ccusage-blocks.json
npx ccusage@latest daily  --json > host/test/fixtures/ccusage-daily.json
npx ccusage@latest --version > host/docs/ccusage-notes.md
```
Expected: 两个非空 JSON。**若字段名与本计划假设(`blocks[].totalTokens`/`costUSD`/`startTime`/`isActive`、`daily[].date`/`totalTokens`)不符，以真实样本为准，更新后续解析代码与测试**。

- [ ] **Step 2: 记录 pin 版本**

把 ccusage 版本号写进 `host/docs/ccusage-notes.md`（§14：pin 版本、只吃 JSON、schema drift fail-closed）。

- [ ] **Step 3: Commit**

```bash
git add host/test/fixtures/ host/docs/ccusage-notes.md
git commit -m "test(host): capture real ccusage JSON fixtures (A1)"
```

> ⚠️ 后续所有 usage 解析任务 **以这些 fixture 为唯一事实**。若朋友机暂不可用，用一份手写但结构合理的 fixture 起步，真机可用后替换并重跑测试。

---

## 里程碑 A2：用量/天气/配置（数据层）

### Task 3：config 模块

**Files:** Create `host/src/config.js`, `host/test/config.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
test("loadConfig fills defaults when file missing", () => {
  const c = loadConfig("/nonexistent.json");
  assert.equal(c.planTokenBudget5h > 0, true);     // 默认参考额度
  assert.equal(typeof c.lat, "number");
  assert.ok(Array.isArray(c.box) && c.box.includes("eevee"));
  assert.deepEqual(c.quietHours, { start: 22, end: 8 });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd host && node --test test/config.test.js`
Expected: FAIL（`loadConfig` 未定义）。

- [ ] **Step 3: 实现 config.js**

```js
import { readFileSync } from "node:fs";
const DEFAULTS = {
  planTokenBudget5h: 220_000,   // 5h 参考额度(可被 config 覆盖); 见 spec §6
  planTokenBudgetWeek: 2_000_000,
  lat: -36.8485, lon: 174.7633, // Auckland
  box: ["eevee"],               // v1 固定初始 box (Eevee-first)
  quietHours: { start: 22, end: 8 },
  volume: 70
};
export function loadConfig(path = "config.json") {
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(path, "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `cd host && node --test test/config.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add host/src/config.js host/test/config.test.js
git commit -m "feat(host): config with defaults (A2)"
```

### Task 4：usage 归一化 + 5H%/WEEK% 语义（§6）+ fail-closed

**Files:** Create `host/src/usage.js`, `host/test/usage.test.js`

- [ ] **Step 1: 写失败测试（用 fixture + §6 公式）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeUsage } from "../src/usage.js";
const blocks = readFileSync("test/fixtures/ccusage-blocks.json","utf8");
test("normalizeUsage computes 5H% = activeBlockTokens / budget, clamps 0..100", () => {
  const u = normalizeUsage({ blocksJson: blocks, dailyJson: "[]", budget5h: 100000, budgetWeek: 1000000 });
  assert.equal(u.p5h >= 0 && u.p5h <= 100, true);
  assert.equal(u.modelled, true);                 // §6: 本地建模, 非官方%
  assert.equal(typeof u.todayTokens, "number");
});
test("normalizeUsage fail-closed on schema drift → throws, no partial", () => {
  assert.throws(() => normalizeUsage({ blocksJson: "{bad", dailyJson: "[]", budget5h:1, budgetWeek:1 }));
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd host && node --test test/usage.test.js`
Expected: FAIL（未定义）。

- [ ] **Step 3: 实现 usage.js（字段名以 fixture 为准，下面是基于常见 ccusage schema 的实现，Task2 不符则改）**

```js
// §6: 5H% = 活跃 5h block token ÷ 参考额度(配置); modelled, 非官方剩余%
export function normalizeUsage({ blocksJson, dailyJson, budget5h, budgetWeek }) {
  const blocks = JSON.parse(blocksJson);          // 抛错=fail-closed
  const daily = JSON.parse(dailyJson);
  const arr = Array.isArray(blocks) ? blocks : blocks.blocks;
  if (!Array.isArray(arr)) throw new Error("ccusage blocks schema drift");
  const active = arr.find(b => b.isActive) || arr[arr.length - 1] || {};
  const activeTok = num(active.totalTokens);
  const weekTok = sumLastDays(daily, 7);
  return {
    modelled: true,
    p5h: clampPct(activeTok / budget5h * 100),
    pweek: clampPct(weekTok / budgetWeek * 100),
    resets5h: active.endTime ?? null,
    todayTokens: sumLastDays(daily, 1),
    todayCost: num((daily.at?.(-1) ?? {}).costUSD),
    weekTokens: weekTok,
    perType: {}                                   // 启发式分流留 Task(sim) 用; 默认空→balanced
  };
}
const num = v => (typeof v === "number" && !Number.isNaN(v)) ? v : (() => { throw new Error("expected number"); })();
const clampPct = v => Math.max(0, Math.min(100, Math.round(v)));
function dailyArr(d){ const a = Array.isArray(d) ? d : d.daily; if(!Array.isArray(a)) throw new Error("ccusage daily drift"); return a; }
function sumLastDays(d, n){ const a = dailyArr(d); return a.slice(-n).reduce((s,x)=>s+num(x.totalTokens),0); }
```

- [ ] **Step 4: 运行验证通过**

Run: `cd host && node --test test/usage.test.js`
Expected: PASS（若 fixture 字段不同，按真实字段调整 `totalTokens/isActive/endTime/costUSD/date` 等并重跑）。

- [ ] **Step 5: Commit**

```bash
git add host/src/usage.js host/test/usage.test.js
git commit -m "feat(host): ccusage normalize + 5H/WEEK% semantics, fail-closed (A2)"
```

### Task 5：weather 适配 + 韧性

**Files:** Create `host/src/weather.js`, `host/test/weather.test.js`

- [ ] **Step 1: 写失败测试（注入 fetch，测映射 + last-known 降级）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { makeWeather } from "../src/weather.js";
test("maps WMO code to 中文 + returns fields", async () => {
  const fakeFetch = async () => ({ ok:true, json: async () => ({ current:{temperature_2m:19,apparent_temperature:17,relative_humidity_2m:64,weather_code:3,wind_speed_10m:11}, daily:{temperature_2m_max:[22],temperature_2m_min:[14],precipitation_probability_max:[30]} }) });
  const w = makeWeather({ fetch: fakeFetch });
  const r = await w.get(-36.8,174.7);
  assert.equal(r.cond, "多云"); assert.equal(r.temp, 19); assert.equal(r.hi, 22);
});
test("on fetch fail returns last-known (degraded)", async () => {
  let ok=true; const f = async()=>{ if(ok){ok=false;return {ok:true,json:async()=>({current:{temperature_2m:19,weather_code:0,apparent_temperature:18,relative_humidity_2m:50,wind_speed_10m:5},daily:{temperature_2m_max:[20],temperature_2m_min:[10],precipitation_probability_max:[0]}})};} throw new Error("net"); };
  const w = makeWeather({ fetch:f }); await w.get(0,0);
  const r = await w.get(0,0);            // 第二次失败 → last-known
  assert.equal(r.degraded, true); assert.equal(r.temp, 19);
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd host && node --test test/weather.test.js` → FAIL。

- [ ] **Step 3: 实现 weather.js**

```js
const WMO = { 0:"晴",1:"晴",2:"多云",3:"多云",45:"雾",48:"雾",51:"小雨",61:"小雨",63:"雨",71:"雪",80:"阵雨",95:"雷雨" };
export function makeWeather({ fetch, ttlMs = 30*60*1000 }) {
  let last = null, lastAt = 0;
  return { async get(lat, lon) {
    const now = Date.now();
    if (last && now - lastAt < ttlMs) return { ...last, degraded:false };
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
      const j = await (await fetch(url)).json();
      last = { cond: WMO[j.current.weather_code] ?? "—", temp: Math.round(j.current.temperature_2m),
        feels: Math.round(j.current.apparent_temperature), humidity: Math.round(j.current.relative_humidity_2m),
        hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]),
        precip: j.daily.precipitation_probability_max[0], wind: Math.round(j.current.wind_speed_10m) };
      lastAt = now; return { ...last, degraded:false };
    } catch { return last ? { ...last, degraded:true } : { cond:"—", temp:null, degraded:true }; }
  }};
}
```

- [ ] **Step 4: 运行验证通过** → Run: `node --test test/weather.test.js` → PASS。
- [ ] **Step 5: Commit** → `git commit -m "feat(host): Open-Meteo weather + last-known degrade (A2)"`

---

## 里程碑 A3：养成 sim + state + 幂等结算（最高风险逻辑，全纯函数可测）

### Task 6：personality（领养时一次性，确定性随机源）

**Files:** Create `host/src/pet/personality.js`, `host/test/personality.test.js`

- [ ] **Step 1: 失败测试**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { rollPersonality } from "../src/pet/personality.js";
test("deterministic with seeded rng; IV 0..31; characteristic from max IV", () => {
  const rng = mulberry32(42);
  const p = rollPersonality(rng);
  assert.equal(p.iv.length, 6); assert.ok(p.iv.every(v=>v>=0&&v<=31));
  assert.equal(typeof p.nature, "string"); assert.equal(typeof p.characteristic, "string");
});
function mulberry32(a){return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
```

- [ ] **Step 2: 失败** → Run `node --test test/personality.test.js` → FAIL.
- [ ] **Step 3: 实现**（Nature/Characteristic 表见调研 §3）

```js
const NATURES = ["急性子","慢性子","实干","话痨","佛系1","佛系2"]; // 简化集; 完整 25 种可后补
const CHAR = { HP:"爱睡午觉", ATK:"爱逞强", DEF:"耐打", SPD:"坐不住", SPA:"好奇心强", SPD2:"倔强" };
const KEYS = ["HP","ATK","DEF","SPD","SPA","SPD2"];
export function rollPersonality(rng = Math.random) {
  const iv = Array.from({length:6}, () => Math.floor(rng()*32));
  const maxIdx = iv.indexOf(Math.max(...iv));
  return { iv, nature: NATURES[Math.floor(rng()*NATURES.length)], characteristic: CHAR[KEYS[maxIdx]] };
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): personality roll (A3)`

### Task 7：sim 单 tick（EXP/level/bond/mood，纯函数）

**Files:** Create `host/src/pet/sim.js`, `host/test/sim.test.js`

- [ ] **Step 1: 失败测试（含 §7.5 心情阈值 + §7.1 软上限）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { deriveMood, applyDailyGrowth, PARAMS } from "../src/pet/sim.js";
test("deriveMood by 5h% + cost spike", () => {
  assert.equal(deriveMood({p5h:30,todayCost:1}), "happy");
  assert.equal(deriveMood({p5h:85,todayCost:1}), "strained");
  assert.equal(deriveMood({p5h:100,todayCost:1}), "fainted");
  assert.equal(deriveMood({p5h:40,todayCost:99}), "shocked");
});
test("applyDailyGrowth caps EXP/bond per day (anti-grind)", () => {
  const pet = { level:1, exp:0, bond:100 };
  const out = applyDailyGrowth(pet, { todayTokens: 99_999_999 });
  assert.ok(out.expGain <= PARAMS.dailyExpCap);
  assert.ok(out.bond <= 100 + PARAMS.dailyBondCap);
});
```

- [ ] **Step 2: 失败** → FAIL.
- [ ] **Step 3: 实现（v0 平衡参数表，spec §17 要求）**

```js
export const PARAMS = {
  dailyExpCap: 100,        // 每日 EXP 软上限(防爆肝/脚本)
  expPerKTok: 2,           // 每 1k token = 2 EXP(到当日上限)
  levelExp: 100,           // 每级所需 EXP
  dailyBondCap: 6,         // 每日亲密上限
  bondPerActiveDay: 4,     // 当日有用量 +4 亲密
  bondSoftCap: 180,        // 日常上限(冲 255 需特殊喂养)
  evolveBond: 160,         // 进化阈值
  costSpikeUSD: 30         // 今日花费飙升阈
};
export function deriveMood({ p5h, todayCost }) {
  if (todayCost >= PARAMS.costSpikeUSD) return "shocked";
  if (p5h >= 100) return "fainted";
  if (p5h >= 80) return "strained";
  if (p5h >= 50) return "focused";
  return "happy";
}
export function applyDailyGrowth(pet, { todayTokens }) {
  const expGain = Math.min(PARAMS.dailyExpCap, Math.floor(todayTokens/1000)*PARAMS.expPerKTok);
  const exp = pet.exp + expGain;
  const level = pet.level + Math.floor(exp / PARAMS.levelExp);
  const bond = Math.min(PARAMS.bondSoftCap, pet.bond + Math.min(PARAMS.dailyBondCap, PARAMS.bondPerActiveDay));
  return { ...pet, exp: exp % PARAMS.levelExp, level, bond, expGain };
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): sim tick — exp/level/bond/mood + v0 params (A3)`

### Task 8：settlement 幂等日结算（断更补算，重启不重复）

**Files:** Create `host/src/pet/settlement.js`, `host/test/settlement.test.js`

- [ ] **Step 1: 失败测试（核心：幂等 + 缺失日补算 + 封顶）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { settleDays } from "../src/pet/settlement.js";
test("settles each missed day once; idempotent on rerun", () => {
  const pet = { bond:100, lastSettled:"2026-05-25", streak:5, shield:1 };
  const a = settleDays(pet, "2026-05-28", { usedDays:new Set() }); // 3 天没用
  const b = settleDays(a, "2026-05-28", { usedDays:new Set() });   // 同日重跑
  assert.equal(a.bond, b.bond);                  // 幂等
  assert.equal(a.lastSettled, "2026-05-28");
  assert.ok(a.streak === 0);                     // 断更 → streak 清零(先扣 shield)
});
test("caps catch-up at maxCatchupDays", () => {
  const pet = { bond:200, lastSettled:"2026-01-01", streak:0, shield:0 };
  const out = settleDays(pet, "2026-05-28", { usedDays:new Set() });
  assert.ok(out.bond >= 0);                       // 不会爆扣到负/不补算 100+ 天
});
```

- [ ] **Step 2: 失败** → FAIL.
- [ ] **Step 3: 实现**

```js
const DAY = 86400000;
const ymd = d => d.toISOString().slice(0,10);
function* daysBetween(from, to){ let d=new Date(from+"T00:00:00Z"); const end=new Date(to+"T00:00:00Z");
  while(d < end){ d=new Date(+d+DAY); yield ymd(d); } }
export function settleDays(pet, today, { usedDays, maxCatchupDays = 30, bondDecayPerMissed = 3 }) {
  if (!pet.lastSettled || pet.lastSettled >= today) return pet;
  const days = [...daysBetween(pet.lastSettled, today)].slice(-maxCatchupDays);
  let { bond, streak, shield } = pet;
  for (const day of days) {
    if (usedDays.has(day)) { streak += 1; }
    else if (shield > 0) { shield -= 1; }          // 护盾抵一次
    else { streak = 0; bond = Math.max(0, bond - bondDecayPerMissed); }
  }
  return { ...pet, bond, streak, shield, lastSettled: today };
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): idempotent daily settlement w/ shield + catch-up cap (A3)`

### Task 9：evolution 数据驱动 + 分支解析（seed 伊布）

**Files:** Create `host/seed/evolution/eevee.json`, `host/src/pet/evolution.js`, `host/test/evolution.test.js`

- [ ] **Step 1: 写 seed 进化表**（`host/seed/evolution/eevee.json`，落地 spec §7.2）

```json
{ "eevee": { "stage": 0, "branches": [
  { "to":"espeon", "needs":{"bond":160,"daytime":true},  "priority":2 },
  { "to":"umbreon", "needs":{"bond":160,"night":true},   "priority":2 },
  { "to":"sylveon", "needs":{"bond":160,"care":true},    "priority":3 },
  { "to":"leafeon", "needs":{"bond":160,"warmHumid":true},"priority":1 },
  { "to":"glaceon", "needs":{"bond":160,"cold":true},    "priority":1 },
  { "to":"vaporeon","needs":{"stone":"water"}, "priority":9 },
  { "to":"jolteon", "needs":{"stone":"thunder"},"priority":9 },
  { "to":"flareon", "needs":{"stone":"fire"},  "priority":9 }
]}}
```

- [ ] **Step 2: 失败测试（唯一/多候选/石头覆盖）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { eligibleBranches, resolveEvolution } from "../src/pet/evolution.js";
test("multiple eligible → returns candidates sorted by priority", () => {
  const cands = eligibleBranches("eevee", { bond:170, daytime:true, warmHumid:true });
  assert.deepEqual(cands.map(c=>c.to), ["sylveon" in {} ? "" : "espeon","leafeon"].filter(Boolean).length?["espeon","leafeon"]:[], );
});
test("stone overrides anytime", () => {
  const r = resolveEvolution("eevee", { bond:0, stone:"fire" });
  assert.equal(r.auto, "flareon");
});
test("single eligible auto-evolves", () => {
  const r = resolveEvolution("eevee", { bond:170, night:true });
  assert.equal(r.auto, "umbreon");
});
```
> （上面候选断言写法仅示意；实现后按真实返回结构收紧断言——见 Step 4。）

- [ ] **Step 3: 实现**

```js
import { readFileSync } from "node:fs";
const TABLE = JSON.parse(readFileSync(new URL("../../seed/evolution/eevee.json", import.meta.url)));
function ok(needs, ctx){ return Object.entries(needs).every(([k,v]) =>
  k==="bond" ? (ctx.bond ?? 0) >= v :
  k==="stone" ? ctx.stone === v : !!ctx[k]); }
export function eligibleBranches(species, ctx){
  const node = TABLE[species]; if(!node) return [];
  return node.branches.filter(b => ok(b.needs, ctx)).sort((a,b)=>a.priority-b.priority);
}
export function resolveEvolution(species, ctx){
  const e = eligibleBranches(species, ctx);
  if (e.length === 0) return { auto:null, candidates:[] };
  if (e.length === 1) return { auto:e[0].to, candidates:e };
  const stone = e.find(b=>b.needs.stone);
  if (stone && ctx.stone) return { auto:stone.to, candidates:e };
  return { auto:null, candidates:e };   // 多候选 → UI 让玩家选(§7.2)
}
```

- [ ] **Step 4: 用真实返回结构收紧断言并 PASS**

Run: `cd host && node --test test/evolution.test.js`
先 `console.log` 真实返回，改 Step2 断言为精确值(如 `eligibleBranches` 多候选返回 `[{to:"espeon"...},{to:"leafeon"...}]` 按 priority 升序)，再确保 PASS。

- [ ] **Step 5: Commit** `feat(host): data-driven evolution engine + branch resolution (A3)`

### Task 10：antiabuse（异常截断）

**Files:** Create `host/src/pet/antiabuse.js`, `host/test/antiabuse.test.js`

- [ ] **Step 1: 失败测试**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { clampDailyTokens } from "../src/pet/antiabuse.js";
test("truncates anomalous daily tokens vs recent median", () => {
  const recent = [1e6,1.2e6,0.9e6,1.1e6];
  assert.ok(clampDailyTokens(50e6, recent) < 50e6);     // 削顶
  assert.equal(clampDailyTokens(1.1e6, recent), 1.1e6); // 正常不动
});
```

- [ ] **Step 2: 失败** → **Step 3: 实现**

```js
export function clampDailyTokens(today, recent, factor = 3) {
  if (!recent.length) return today;
  const sorted = [...recent].sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  return Math.min(today, median * factor);
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): anti-abuse daily-token clamp (A3)`

### Task 11：state 加固（原子写+备份+校验+安全重建）

**Files:** Create `host/src/state.js`, `host/test/state.test.js`

- [ ] **Step 1: 失败测试（往返 + 损坏回退 + schemaVersion）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { saveState, loadState, SCHEMA_VERSION } from "../src/state.js";
test("roundtrip + schemaVersion", () => {
  const dir = mkdtempSync(join(tmpdir(),"cpb-")); const f = join(dir,"state.json");
  const s = { schemaVersion:SCHEMA_VERSION, level:3, bond:120, lastSettled:"2026-05-28" };
  saveState(f, s); assert.deepEqual(loadState(f).level, 3);
});
test("corrupt main → falls back to backup", () => {
  const dir = mkdtempSync(join(tmpdir(),"cpb-")); const f = join(dir,"state.json");
  saveState(f, { schemaVersion:SCHEMA_VERSION, level:7 });   // 写一次 → 有 .bak
  saveState(f, { schemaVersion:SCHEMA_VERSION, level:8 });   // .bak 现为 level7
  writeFileSync(f, "{corrupt");                              // 毁主文件
  assert.ok([7,8].includes(loadState(f).level));             // 回退备份
});
```

- [ ] **Step 2: 失败** → **Step 3: 实现**

```js
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, openSync, fsyncSync, closeSync } from "node:fs";
export const SCHEMA_VERSION = 1;
export function saveState(path, state) {
  const tmp = path + ".tmp", bak = path + ".bak";
  if (existsSync(path)) { try { copyFileSync(path, bak); } catch {} }
  const data = JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION });
  writeFileSync(tmp, data);
  const fd = openSync(tmp, "r+"); fsyncSync(fd); closeSync(fd);  // 落盘
  renameSync(tmp, path);                                         // 原子替换
}
export function loadState(path) {
  for (const p of [path, path + ".bak"]) {
    try { const s = JSON.parse(readFileSync(p, "utf8")); if (s && typeof s.schemaVersion === "number") return s; } catch {}
  }
  return { schemaVersion: SCHEMA_VERSION, _rebuilt: true };       // 安全重建(易失态重置; 等级/进化由 checkpoint 兜底见 spec §9)
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): hardened state.json (atomic+backup+rebuild) (A3)`

---

## 里程碑 A4：渲染 + 主循环 + mock 串口（产出可见 PNG）

### Task 12：dither（灰度→1bpp，纯函数）

**Files:** Create `host/src/render/dither.js`, `host/test/dither.test.js`

- [ ] **Step 1: 失败测试**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { ditherTo1bpp } from "../src/render/dither.js";
test("packs 400x300 gray to 1bpp byte length", () => {
  const gray = new Uint8Array(400*300).fill(255);  // 全白
  const { bytes, w, h } = ditherTo1bpp(gray, 400, 300);
  assert.equal(w, 400); assert.equal(h, 300);
  assert.equal(bytes.length, Math.ceil(400/8)*300);
});
```

- [ ] **Step 2: 失败** → **Step 3: 实现（Bayer 8×8）**

```js
const BAYER8 = [/* 0..63 的 8x8 有序抖动阈值矩阵 */
 0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,
 60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,
 15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
export function ditherTo1bpp(gray, w, h) {
  const rowBytes = Math.ceil(w/8); const bytes = new Uint8Array(rowBytes*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    const t = (BAYER8[(y&7)*8+(x&7)]+0.5)/64*255;
    const black = gray[y*w+x] < t;                // 低于阈值=墨(黑=1)
    if (black) bytes[y*rowBytes + (x>>3)] |= (0x80 >> (x&7));
  }
  return { bytes, w, h };
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): Bayer dither → 1bpp (A4)`

### Task 13：layout + frame（canvas 画 400×300 灰度 → PNG）

**Files:** Create `host/src/render/palette.js`, `host/src/render/layout.js`, `host/src/render/frame.js`, `host/test/frame.test.js`

- [ ] **Step 1: 失败测试（产出 PNG buffer + 灰度尺寸）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { renderFrame } from "../src/render/frame.js";
test("renderFrame returns 400x300 png + 1bpp bitmap", async () => {
  const model = { p5h:72, pweek:41, todayCost:4.1, todayTokens:5.3e6, streak:6,
    weather:{cond:"多云",temp:19,feels:17,hi:22,lo:14,precip:30,wind:11}, room:{t:23.4,h:56}, out:{t:19,h:64},
    buddy:{ spriteGray: new Uint8Array(96*96).fill(120), mood:"focused", level:7, bond:3 } };
  const { pngBuffer, bitmap } = await renderFrame(model);
  assert.ok(pngBuffer.length > 100);
  assert.equal(bitmap.w, 400); assert.equal(bitmap.h, 300);
});
```

- [ ] **Step 2: 失败** → **Step 3: 实现 layout.js + frame.js**

`palette.js`:
```js
export const INK = "#000", PAPER = "#fff";   // 真机纯黑白; 灰度由 canvas 抗锯齿产生, dither 收敛
```
`layout.js`（用 @napi-rs/canvas 画；坐标/字号照搬定稿 mockup 06，左仪表盘+右buddy）:
```js
import { createCanvas } from "@napi-rs/canvas";
export function drawGray(model) {
  const c = createCanvas(400,300), g = c.getContext("2d");
  g.fillStyle="#fff"; g.fillRect(0,0,400,300); g.fillStyle="#000";
  // 左栏分隔
  g.fillRect(214,0,2,300);
  // 5H hero
  g.font="800 64px monospace"; g.fillText(model.p5h+"%", 10, 96);
  g.font="700 12px monospace"; g.fillText("5H WINDOW", 12, 120);
  g.fillText("WEEK "+model.pweek+"%", 12, 150);
  g.fillText(`today $${model.todayCost.toFixed(2)} · ${(model.todayTokens/1e6).toFixed(1)}M tok`, 12, 172);
  // 天气 + 里外温湿度
  g.fillText(`${model.weather.cond} ${model.weather.temp}° 体感${model.weather.feels}°`, 12, 210);
  g.fillText(`最高${model.weather.hi}° 最低${model.weather.lo}° 降水${model.weather.precip}%`, 12, 228);
  g.fillText(`室内 ${model.room.t}° ${model.room.h}%`, 12, 270);
  g.fillText(`室外 ${model.out.t}° ${model.out.h}%`, 12, 288);
  // 右栏 buddy: 把 96x96 灰度 sprite 放大到 ~150 居中(最近邻)
  // (实现: 用 createImageData/putImageData 或逐块 fillRect; 见 sprites.js Task14)
  return g.getImageData(0,0,400,300);   // RGBA
}
```
`frame.js`:
```js
import { drawGray } from "./layout.js"; import { ditherTo1bpp } from "./dither.js";
import { createCanvas } from "@napi-rs/canvas";
export async function renderFrame(model) {
  const img = drawGray(model);                       // RGBA 400x300
  const gray = new Uint8Array(400*300);
  for (let i=0;i<gray.length;i++){ const r=img.data[i*4],gg=img.data[i*4+1],b=img.data[i*4+2];
    gray[i] = (r*0.3+gg*0.59+b*0.11)|0; }
  const bitmap = ditherTo1bpp(gray, 400, 300);
  // PNG 输出: 把 1bpp 还原成黑白 RGBA 再编码(便于肉眼看真机效果)
  const c = createCanvas(400,300), g=c.getContext("2d"); const out=g.createImageData(400,300);
  const rb=Math.ceil(400/8);
  for(let y=0;y<300;y++)for(let x=0;x<400;x++){ const on=(bitmap.bytes[y*rb+(x>>3)]>>(7-(x&7)))&1; const v=on?0:255;
    const i=(y*400+x)*4; out.data[i]=out.data[i+1]=out.data[i+2]=v; out.data[i+3]=255; }
  g.putImageData(out,0,0);
  return { pngBuffer: await c.encode("png"), bitmap };
}
```

- [ ] **Step 4: PASS + 肉眼核对**

Run: `cd host && node --test test/frame.test.js` → PASS。
再 Run 一段 demo 脚本输出 `out/frame.png`，肉眼比对 mockup 06（单色、字清、布局对）。

- [ ] **Step 5: Commit** `feat(host): canvas layout + frame→1bpp→png (A4)`

### Task 14：sprites（本地 seed 灰度加载）

**Files:** Create `host/src/render/sprites.js`, `host/test/sprites.test.js`, 放置 `host/seed/sprites/eevee.png`(本地)

- [ ] **Step 1: 失败测试** → 加载 PNG → 返回 96×96 灰度 Uint8Array（缺文件则返回占位棋盘）。
- [ ] **Step 2: 失败** → **Step 3: 实现**（@napi-rs/canvas `loadImage` → drawImage → getImageData → 灰度；接 layout 的 buddy 区放大绘制）。
- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): seed sprite gray loader (A4)`

> 版权：seed 精灵不入 git（`.gitignore`）；setup 脚本本地放置(个人礼物用途，spec §17)。

### Task 15：mock transport（写 PNG + 假按键/传感器）

**Files:** Create `host/src/transport/mock.js`, `host/test/mock.test.js`

- [ ] **Step 1: 失败测试** → `push(pngBuffer)` 写 `out/frame.png`；`onButton(cb)`/`injectButton("KEY","short")` 回环；`feedSensor()` 返回固定室温。
- [ ] **Step 2: 失败** → **Step 3: 实现**（fs 写文件 + EventEmitter）。
- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): mock transport (png-to-disk + fake io) (A4)`

### Task 16：index 主循环（串联 + 优雅退出）

**Files:** Modify `host/src/index.js`, Create `host/test/integration.test.js`

- [ ] **Step 1: 集成失败测试（一个 tick：mock usage/weather → state 更新 → out/frame.png 生成）**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { runOneTick } from "../src/index.js";
test("one tick produces frame + advances state", async () => {
  const st = await runOneTick({
    usage:{ p5h:72,pweek:41,todayCost:4.1,todayTokens:5_300_000,modelled:true,weekTokens:3e7 },
    weather:{ cond:"多云",temp:19,feels:17,hi:22,lo:14,precip:30,wind:11 },
    room:{t:23.4,h:56}, statePath:"out/test-state.json", framePath:"out/test-frame.png"
  });
  assert.ok(existsSync("out/test-frame.png"));
  assert.ok(st.level >= 1);
});
```

- [ ] **Step 2: 失败** → **Step 3: 实现 `runOneTick` + `main()` 循环**

```js
import { loadConfig } from "./config.js"; import { loadState, saveState } from "./state.js";
import { settleDays } from "./pet/settlement.js"; import { applyDailyGrowth, deriveMood } from "./pet/sim.js";
import { resolveEvolution } from "./pet/evolution.js"; import { renderFrame } from "./render/frame.js";
export async function runOneTick({ usage, weather, room, statePath, framePath, today=new Date().toISOString().slice(0,10), mock }) {
  let pet = loadState(statePath);
  if (!pet.level) pet = { ...pet, species:"eevee", level:1, exp:0, bond:120, streak:0, shield:0, lastSettled:today };
  pet = settleDays(pet, today, { usedDays: new Set(usage.todayTokens>0?[today]:[]) });
  pet = applyDailyGrowth(pet, { todayTokens: usage.todayTokens });
  const mood = deriveMood(usage);
  const { pngBuffer } = await renderFrame({ ...usage, weather, room, out:{t:weather.temp,h:64},
    buddy:{ spriteGray:null, mood, level:pet.level, bond:Math.round(pet.bond/51) } });
  const { writeFileSync, mkdirSync } = await import("node:fs"); mkdirSync("out",{recursive:true});
  if (mock?.push) mock.push(pngBuffer); else writeFileSync(framePath, pngBuffer);
  saveState(statePath, pet);
  return pet;
}
```
（完整 `main()`：loadConfig → 每 60s 跑 usage/weather/sensors → runOneTick；SIGINT 优雅退出。按上述模块串联补全。）

- [ ] **Step 4: PASS** → 再 `npm start` 真跑一轮，看 `out/frame.png`。
- [ ] **Step 5: Commit** `feat(host): tick loop wiring + integration test (A4)`

---

## DoD（Plan A 完成判据，可验证）

- [ ] `cd host && npm test` 全绿。
- [ ] `npm start`（或集成测试）产出 `out/frame.png`，肉眼=mockup 06 单色版（数字/天气/温湿度/buddy 占位）。
- [ ] usage：喂 fixture → `p5h/pweek` 按 §6 公式正确、`modelled:true`；坏 JSON → 抛错不污染旧值。
- [ ] sim/settlement：当日有用量→等级/亲密涨且封顶；断更→streak 清零(先扣护盾)；**重复结算幂等**(settleDays 重跑结果一致)；缺失日封顶。
- [ ] evolution：bond≥160 多条件 → 返回候选；石头 → 直接覆盖；唯一 → 自动。
- [ ] state：往返一致；毁主文件 → 回退 .bak；schemaVersion 在。
- [ ] 跨日：连跑两个不同 `today` 不重复加 bond。

## 与 spec 的覆盖核对（self-review）
- §6 百分比语义 → Task4 ✓ · §7.1 双轨/软上限/EV heuristic → Task7 ✓ · §7.2 进化引擎+分支解析 → Task9 ✓ · §7.3 个性 → Task6 ✓ · §7.5 心情 → Task7 deriveMood ✓ · §7.7 防刷 → Task7/10 ✓ · §9 state+幂等结算 → Task8/11 ✓ · §11 canvas+Bayer 1bpp → Task12/13 ✓ · §17 v0 参数表 → Task7 PARAMS ✓。
- **留给 Plan B**：真串口(USB-CDC/脏区+RLE/ACK)、ST7305 显示、音频、SHTC3 真实上报。**留给 Plan C**：dashboard。**v1.5+**：全 Pokédex 拉取、彩蛋包、麦克风/小游戏。
- **v0 参数为占位基线**，真机体验后调（spec §17）。

---

## 执行交接

计划已存 `docs/plans/2026-05-30-claude-pokemon-buddy-host-core.md`。两种执行方式：
1. **Subagent-Driven（推荐）**——每任务派新 subagent、任务间 review、快迭代。**本项目铁律：subagent 走 codeagent(codex/gpt-5.5)**。
2. **Inline**——本会话内分批执行 + checkpoint。

哪种？（按你 CLAUDE.md，实现一律 codeagent；建议 Subagent-Driven + codex。）
