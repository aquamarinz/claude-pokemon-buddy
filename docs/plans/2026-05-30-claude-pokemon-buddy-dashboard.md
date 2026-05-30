# Claude Pokémon Buddy — Plan C：本地 Dashboard（伴侣图鉴）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。实现经 codeagent(codex/gpt-5.5)。步骤 `- [ ]`。
> **配套**：spec §4.1(dashboard 内容/只读为主) · §17(bind 127.0.0.1/输入校验/无玩家开关) · 视觉基线 `demo/dashboard.html`(Pokédex Console 风, 已 review 定稿) · host 在 main(Plan A+Bh, `state.json`/usage/weather/sensors 现成)。

**Goal:** host 进程内开一个 **localhost:127.0.0.1 网页 = 训练师伴侣图鉴**：读 host 的 pet state + 用量/天气/室内温湿度 → 渲 MY BUDDY / BOX / JOURNEY / SECRETS / SETTINGS + **LIVE 设备预览(frame.png 镜像)**。**只读为主**，仅 SETTINGS 写真·偏好(取名/免打扰/音量/定位)。**无难度/平衡/彩蛋开关**(game-design 铁律)。

**Architecture:** 复用 Plan A 的 state/usage/weather/sensors；新增 host `web` 模块——Node 内置 `http`（零依赖、bind `127.0.0.1`）服务：① 静态页(改编自 `demo/dashboard.html`)② `GET /api/state`(viewmodel JSON)③ `GET /frame.png`(out/frame.png 镜像)④ `POST /api/settings`(校验+写 config)。页面轮询 `/api/state` + 刷 frame.png。**纯只读 + 真偏好**，无规则编辑端点。

**Tech Stack:** Node 20+ 内置 `http`(无新依赖)；`node:test` + http 请求测试；前端纯 HTML/CSS/JS(改编 mockup, 无框架)。

---

## 文件结构
```
host/src/web/
  server.js          # http 服务: bind 127.0.0.1, 路由(/api/state, /frame.png, /api/settings, 静态)
  viewmodel.js       # 纯函数: (petState, usage, weather, sensors, config) → dashboard view JSON
  settings.js        # 校验 + 持久化真·偏好到 config(取名/免打扰/音量/定位); 拒未知字段
  public/
    index.html       # 改编自 demo/dashboard.html → 占位 id, 去掉 mock 数据
    app.js           # fetch /api/state → 填面板 + 刷 frame.png; 每 5s 轮询; SETTINGS 表单 POST
host/test/ viewmodel.test.js · web-server.test.js · settings.test.js
```

---

## Task C1：viewmodel（纯函数 TDD）
**Files:** Create `host/src/web/viewmodel.js`, `host/test/viewmodel.test.js`
- [ ] **Step 1: 失败测试**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { toDashboardView } from "../src/web/viewmodel.js";
test("maps host state to dashboard view (read-only)", () => {
  const v = toDashboardView({
    pet: { species:"eevee", level:7, exp:40, bond:142, mood:"focused", nature:"急性子", iv:[28,18,23,30,15,21], characteristic:"爱睡午觉", badges:["7d","1e8"], readyToEvolve:false },
    usage: { p5h:72, pweek:41, todayCost:4.1, todayTokens:5_300_000, streak:6, modelled:true },
    weather: { cond:"多云", temp:19, feels:17, hi:22, lo:14, precip:30 },
    sensors: { roomT:23.4, roomH:56 },
    journey: [{date:"2026-05-30", text:"亲密度 142"}],
    secrets: { discovered:["shiny"], total:12 },
    config: { name:"阿布", quietHours:{start:22,end:8}, volume:70, lat:-36.8, lon:174.8, difficulty:"normal" },
  });
  assert.equal(v.buddy.name, "阿布");
  assert.equal(v.buddy.level, 7);
  assert.equal(v.buddy.nextEvo.threshold, 160);     // §7.2 进化阈值(只读展示)
  assert.equal(v.buddy.nextEvo.bond, 142);
  assert.equal(v.usage.modelled, true);              // §6 LOCAL/est 标
  assert.equal(v.secrets.discoveredCount, 1);
  assert.equal(v.secrets.lockedCount, 11);
  assert.equal(v.difficulty, "NORMAL · 锁定");        // 只读
});
```

- [ ] **Step 2: 失败** → `cd host && node --test test/viewmodel.test.js` → FAIL。
- [ ] **Step 3: 实现 viewmodel.js**（纯函数, 拼 dashboard 视图; 不含任何可改规则的字段）

```js
const EVOLVE_BOND = 160;  // 与 sim 一致(只读展示为目标)
export function toDashboardView({ pet, usage, weather, sensors, journey, secrets, config }) {
  return {
    buddy: {
      name: config.name, species: pet.species, level: pet.level, exp: pet.exp,
      bond: pet.bond, mood: pet.mood, nature: pet.nature, iv: pet.iv,
      characteristic: pet.characteristic, badges: pet.badges,
      nextEvo: { bond: pet.bond, threshold: EVOLVE_BOND, ready: !!pet.readyToEvolve },
    },
    usage: { p5h: usage.p5h, pweek: usage.pweek, todayCost: usage.todayCost,
             todayTokens: usage.todayTokens, streak: usage.streak, modelled: usage.modelled },
    weather, room: { t: sensors.roomT, h: sensors.roomH },
    journey: journey ?? [],
    secrets: { discovered: secrets.discovered, discoveredCount: secrets.discovered.length,
               lockedCount: Math.max(0, secrets.total - secrets.discovered.length), total: secrets.total },
    settings: { name: config.name, quietHours: config.quietHours, volume: config.volume,
                lat: config.lat, lon: config.lon },
    difficulty: "NORMAL · 锁定",
  };
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): dashboard viewmodel (C1)`

## Task C2：settings 校验 + 持久化（纯函数 TDD）
**Files:** Create `host/src/web/settings.js`, `host/test/settings.test.js`
- [ ] **Step 1: 失败测试**：`validateSettings(input)` 只接受 {name(≤16 字), quietHours{start/end 0-23}, volume 0-100, lat -90..90, lon -180..180}；**拒未知字段(如 difficulty/decayRate/eggToggle)**；越界 clamp 或拒。返回 {ok, value|error}。
- [ ] **Step 2: 失败** → **Step 3: 实现**（白名单字段 + 范围校验；难度/平衡/彩蛋字段一律忽略/拒——§17/§15）。
- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): settings whitelist validation (C2)`

## Task C3：web server（http, bind 127.0.0.1, 路由）TDD
**Files:** Create `host/src/web/server.js`, `host/test/web-server.test.js`
- [ ] **Step 1: 失败测试**（起 server 在随机端口、127.0.0.1；`GET /api/state` 返 viewmodel JSON；`POST /api/settings` 合法→200+写 config、非法→400；`GET /frame.png` 返图或 404）

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { startWebServer } from "../src/web/server.js";
test("GET /api/state returns view json on 127.0.0.1", async () => {
  const srv = await startWebServer({ host:"127.0.0.1", port:0, getView: () => ({ buddy:{ name:"阿布" } }) });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/state`);
  const j = await res.json(); assert.equal(j.buddy.name, "阿布"); await srv.close();
});
test("POST /api/settings rejects unknown field", async () => {
  let saved=null; const srv = await startWebServer({ host:"127.0.0.1", port:0, getView:()=>({}), saveSettings:(v)=>{saved=v;} });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/settings`, { method:"POST", headers:{'content-type':'application/json'}, body: JSON.stringify({ difficulty:"easy" }) });
  assert.equal(res.status, 400); assert.equal(saved, null); await srv.close();
});
```

- [ ] **Step 2: 失败** → **Step 3: 实现 server.js**（`http.createServer` 绑 127.0.0.1；路由 `/api/state`→`getView()`、`/api/settings`(POST)→validate→saveSettings、`/frame.png`→读 out/frame.png、`/`→public/index.html、`/app.js`→public/app.js；注入 getView/saveSettings 便于测）。
- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): localhost dashboard http server (C3)`

## Task C4：dashboard 页面（改编 mockup → live）
**Files:** Create `host/src/web/public/index.html`, `host/src/web/public/app.js`（基于 `demo/dashboard.html`）
- [ ] **Step 1:** 把 `demo/dashboard.html` 的结构/样式搬进 `public/index.html`，**去掉硬编码 mock 数据**，给各处加 `id`(buddy name/lv/bond/mood/iv/badges/nextEvo bar、box、journey、secrets、settings 输入、frame 预览 `<img id="live">`)。
- [ ] **Step 2:** `public/app.js`：`fetch('/api/state')` → 填所有 id；`#live`.src=`/frame.png?_=${Date.now()}`；每 5s 轮询；SETTINGS 表单 submit→`POST /api/settings`（成功提示/失败显错）。**不引入任何规则编辑控件**(无难度/平衡/彩蛋开关——demo 沙盒控件不可搬)。
- [ ] **Step 3:** 用浏览器打开验证（host 起 server 后 `open http://127.0.0.1:<port>`）：面板被真实 state 填充、frame 预览刷新、改名/音量 POST 生效。
- [ ] **Step 4: Commit** `feat(host): live dashboard page from state (C4)`

## Task C5：接进 host 主进程 + 集成
**Files:** Modify `host/src/index.js`（启动时起 web server；getView 由 viewmodel(当前 state+usage+weather+sensors+config) 组成；saveSettings 走 settings.js→写 config 并热应用）；Create `host/test/web-integration.test.js`
- [ ] **Step 1: 失败测试**：host 起动后 `/api/state` 反映当前 pet state；`POST /api/settings` 改名后 `/api/state` 的 buddy.name 更新。
- [ ] **Step 2/3:** 实现 wiring。
- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): wire dashboard server into host loop (C5)`

---

## 测试策略
- **纯函数 + 端点**（viewmodel/settings/server/集成）：`node:test` + `fetch` 到 127.0.0.1。
- **页面**：浏览器打开人工核对（与 `demo/dashboard.html` 视觉一致 + 数据是 live）。

## DoD（可验证）
- [ ] `cd host && npm test` 含 C 新测，全绿（含 main 的 60 个）。
- [ ] host 起动 → `http://127.0.0.1:<port>` 打开 = 伴侣图鉴：MY BUDDY/BOX/JOURNEY/SECRETS/SETTINGS 被真实 state 填充、LIVE 预览刷 frame.png。
- [ ] `POST /api/settings` 改名/音量/免打扰/定位生效；**未知/规则字段(difficulty/decay/egg)被拒**(§15/§17)。
- [ ] server **只绑 127.0.0.1**(不暴露局域网)。
- [ ] dashboard **无难度/平衡/彩蛋开关**(只读为主 + 真偏好)。

## 与 spec 覆盖核对
§4.1 dashboard 内容(MY BUDDY/BOX/JOURNEY/SECRETS/SETTINGS/LIVE) ✓ · §17 bind 127.0.0.1/输入校验/维护后门非玩家开关 ✓(维护后门 reset/repair/vacation/export 可作 v1.5 隐藏端点, 本计划先只做真偏好) · §6 modelled 标 ✓ · §8 彩蛋发现-陈列馆(只读展示已发现) ✓ · §7.4 难度只读 NORMAL·锁定 ✓。
**留 v1.5**：维护后门(vacation/reset/export)隐藏端点、SECRETS 随真实发现解锁联动、box 成长。

## 参考
- 视觉基线：`demo/dashboard.html`(Pokédex Console)。
- host state schema：Plan A `state.js`/`pet/*`/`usage.js`/`weather.js`。
- spec §4.1 / §17 / §6 / §8。
