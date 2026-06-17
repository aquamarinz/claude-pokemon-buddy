# 宝可梦「叫声 + 动画 + 线条」个性化 — 设计文档

> 日期：2026-06-17 · 分支：`claude/stoic-jang-b1dd16`
> 触发：用户反馈「宝可梦虚线太虚，线加实一点、再放大一点点」+「给每只宝可梦设计独立、有个性的叫声和动画，全部一起设计」。

## 背景与目标（第一性原理拆解）

把诉求拆到三个独立的物理/系统约束面：

1. **「线虚」是渲染管线的结果，不是资产问题**。种子图是 ~97–120px 的 1-bit 矢量线稿；`drawSprite` 的 `fitScale = floor(BUDDY_SPRITE_SLOT/max(srcW,srcH)) = floor(136/120) = 1` → 精灵 **1:1 原生画出、根本没放大**，1px 黑线在反射屏（ST7305）上断成虚点。要「实」= 加粗墨线；要「大」= 整数倍放大或重烘焙更大原生尺寸。
2. **「叫声」硬件已具备真实音频**。固件已到里程碑 B5：ES8311 codec + 扬声器工作，开机合成 chiptune 音（`SND_BUI/EVOLVE/HOUR`），host 用 `T_PLAY(0x03)` 帧发 sound id 播放。**缺口：18 只共用同一个 `SND_BUI`**。→ 给每只做独有 chiptune 真声 + 升级文字气泡。
3. **「动画」当前不存在连续循环**。稳态主循环 **60 秒一帧**（`intervalMs=60_000`），现有多帧动画只有进化/孵化两处**事件突发**（逐帧 `await push` + `delay` + `playSound`）。要「连续 idle + 招牌动作都要」= 需新增一个独立于主 tick 的动画驱动 + 程序化逐物种 accent。

**目标**：在不破坏既有渲染/传输契约（host canvas → 1bpp → 脏区推 ESP32）与养成数值逻辑的前提下，让宝可梦「看得清、会发声、活起来」，且每只都有可辨识的个性。

## 非目标

- 不改养成/进化触发数值（sim/settlement/evolution 表驱动逻辑不动）。
- 不改 usage/weather/state/dashboard 数值与布局。
- 不做通用动画 scheduler 抽象（YAGNI）；动画驱动只服务 buddy 区域。
- 不引入采样音频/解码库；真声沿用固件现有**纯方波 sweep** 合成能力。

## 基岩约束（实测，供实现/评审对照）

| 维度 | 事实 | 出处 |
|---|---|---|
| 显示 | 400×300，1-bit；满屏 15000B | `render/palette.js`、`firmware/main/main.cpp:48-49` |
| 传输 | USB-Serial-JTAG 115200（~14.4KB/s），停等 + 250ms ACK + 3 重试；脏区差分只发变化区 | `transport/serial.js`、`transport/diff.js` |
| 动画带宽 | 小脏区（buddy ~136px 块，RLE 后 ~1KB/帧）实测可撑 **3–5 FPS** | 探查结论 |
| 主循环 | 稳态 60s 一帧；无动画循环 | `index.js:146,217-222` |
| 音频 | B5：ES8311+扬声器，开机 `synth_all` 合成；`Note{f0,f1,ms}` 方波 sweep，16kHz 立体声(L=R)，5ms attack+线性衰减 | `firmware/main/main.cpp:246-310` |
| 音频触发 | host `T_PLAY(0x03)` 选 id；KEY 短按固件**本地**播 `SND_BUI`（零延迟） | `main.cpp:187-188,328` |
| 协议余量 | `T.CONFIG=0x04`、`SOUND_LOAD=0x02` host 已定义、固件未实现 → 扩展口干净 | `transport/proto.js:2-11` |
| 精灵 | DW 矢量线稿烘焙 1-bit PNG，~97–120px；`bake-assets.mjs` 联网拉 PokeAPI SVG | `scripts/bake-assets.mjs`、`render/sprites.js` |

---

## 支柱一 · 视觉（线加实 + 放大，两步走）

### 第一步（P1，渲染层，零新资产 / 不联网）

- 在 `host/src/render/sprites.js` 新增 `dilate1bpp(oneBitGray, w, h, radius=1)`：对墨色（值 0）像素做形态学膨胀（4-邻域，半径 1），线条加粗 ~1px → 断点连成实线，保留线稿味（不填实身体）。
- `host/src/render/layout.js` `drawSprite`：在 `thresholdSpriteGray` 得到 `rendered` 后、缩放前调用 `dilate1bpp`。新增 `{ bold = false, boldRadius = 1 }`——**默认 false**：`drawSprite` 是共享入口（`layout.js:182`），同时服务进化-anim（`evolution-anim.js:73`）、onboarding Oak/born（`render/onboarding.js`）。**只在 `drawBuddyPanel` 显式传 `bold:true`**，其余调用点逐个决定，绝不默认污染 Oak/进化/诞生帧。透明语义不变（膨胀后的墨向透明区外扩一圈 → 描边变粗变实）。
- 非 mutate：`dilate1bpp` 返回新 buffer，不改输入；radius=1 只扩一圈，受控有界。

**验收**：膨胀前/后 1-bit 对比图（复用 `scripts/render-sprite-previews.js` 路子）显示线条连续；全 18 只 + **Oak/进化/诞生**复用点目检无「眼睛被糊死/相邻部件粘连」回归。

### 第二步（P5，重烘焙，联网）

- `scripts/bake-assets.mjs`：`targetMax 120→144`；烘焙末加一次 `dilate1bpp` 让源图天然带粗线；重拉 18 DW SVG + Oak，重写入库 PNG。
- `BUDDY_SPRITE_SLOT 136→150`；`drawBuddyPanel` 微调：精灵顶 `y 60→~52`，物种名/阴影同步下移 ≤8px 不与经验条/mood 行重叠（精灵 144 高需腾出空间）。
- 矢量源无损，144px 仍二值化干净。

**验收**：离线全 18 物种图，放大后线条清晰不糊、与左栏 usage 不挤；onboarding/进化各帧不出血。

---

## 支柱二 · 叫声（真声 + 文字气泡，每只独有）

### 固件（`firmware/main/main.cpp`）

- `SND_SPECIES_BASE = 3`；`SND_COUNT = 3 + 18 = 21`。18 张 `Note` 表与 `SND_*` 常量**由单一真源生成**（见下「单一真源」），固件 `#include "species_cries.inc"`；`synth_all` 开机全合成。
- **PSRAM 预算**：单只最长 510ms ≈ 8160 帧 ×2ch×2B ≈ 32KB；18 只均值 ~350ms ≈ 22KB，合计 ~400KB。`sdkconfig.defaults` 已启 PSRAM；建议 `synth_all` 前后 log `heap_caps_get_free_size(MALLOC_CAP_SPIRAM)`，失败可定位而非只 `assert`。
- **KEY 本地播当前物种声**：新增 `std::atomic<uint8_t> g_active_cry`（默认 `SND_BUI`）——跨 `rx_task` 写 / multi_button-esp_timer 回调（`on_key_single`）读，**必须 atomic 或 portMUX 临界区**，不能当普通 `uint8_t`。`parse_frames` 增 `T_CONFIG(0x04)` 分支：仅 `len>=1 && payload[0] < SND_COUNT` 时赋值，**非法 id 直接 reject 不改值**（绝不 `clamp(255)→20` 误变水箭龟），fire-and-forget 不 ACK。`on_key_single` 改播 `g_active_cry`。
- `SND_BUI/EVOLVE/HOUR` 与现有 `T_PLAY`/进化/整点链路**完全不动**（never break userspace）。

### Host

- **单一真源（防排序漂移）**：项目已有 4 处物种顺序（`pet/species-meta.js`、`scripts/bake-assets.mjs`、`web/public/app.js`、`test/sprites.test.js`），再手写第 5 处必漂。改为 `host/seed/species-cries.json` 维护 **ordered 物种 + cryNotes（即上表）**，由小脚本（`scripts/gen-cries.mjs`）生成两侧产物：`host/src/pet/cry-audio.js`（`cryAudioId(species)=3+idx` 映射）+ `firmware/main/species_cries.inc`（Note 表数组 + `SND_SPECIES_BASE`/`SND_COUNT`）。固件 `#include` 该 inc，host import 生成的映射；测试只读 JSON/生成产物。
- `host/src/transport/serial.js` + `transport/index.js`：新增 `setActiveCry(id)` → 发 `encodeFrame({type:T.CONFIG, seq, payload:[id]})`；mock/测试 transport 提供 spy/no-op。
- **设备状态重放**：`setActiveCry` 改的是设备状态，固件重启/重连后 `g_active_cry` 回默认 BUI。transport 或 main 存 `lastActiveCry`，在启动、物种变化、进化后、**`onReconnect` 后**（`transport/index.js:45` reconnect 仅清 `previousBytes`，会丢设备态）重发。
- `host/src/index.js`：物种变化（及启动/进化后/重连后）调 `transport.setActiveCry(cryAudioId(species))`。
- **气泡升级**：`host/src/pet/cries.js` 由「单串」改为每只 `{idle, happy, strained}`；`cryFor(species, mood)` **自映射**（`happy`→happy；`strained/fainted/shocked`→strained；`focused/其余`→idle，**不新增 `moodCategory` 薄 helper**），未知物种回退 `♪`。`index.js:133` 传 `bubble: cryFor(species, mood)`，渲染层 `drawBubble` 不变。

---

## 支柱三 · 动画（连续 idle + KEY 招牌，都要）

### 关键架构：host 端 buddy 动画驱动 + 串行推送

- 新增 `host/src/render/buddy-animator.js` `createBuddyAnimator({ transport, getModel, intervalMs=333, render=renderFrame })`：独立 ~3FPS 循环；每拍用 `getModel()`（主 tick 缓存的最新 render model）+ 递增 `animPhase` 重渲整帧并推送；`diffRect` 天然只发 buddy 脏区。
- **push 互斥（核心）**：底层 `serial.pushFrame` 虽已停等串发，但 `wrapSerialTransport.push` 是**先算 diff 再 `await pushFrame`**（`transport/index.js:56`）——并发 `push` 会同时基于旧 `previousBytes` 算脏区→残影。**必须在 `push` 外层加 promise-chain mutex，覆盖 `writePreview→diffRect→pushFrame→previousBytes 更新` 全段**。animator 的 `pause/resume` 只是调度语义，**不能替代**此 mutex。
- **animator 自调度**（非裸 `setInterval`，防积压）：每帧 `await serializedPush` 后再 sleep；若单帧 push 超过 `intervalMs` 则跳帧/漂移、**不排队补帧**。
- `index.js` 改造：主 tick 渲染前 `animator.pause()`、推完日常帧后更新 `getModel` 源并 `animator.resume()`；招牌动画期间同样 `pause/resume`。
- 克制原则：呼吸幅度 ±1–2px、accent 细微，桌面常驻不分心。

### 帧来源 = 单张静态图 + 程序化变换（无新资产）

- 通用呼吸 bob：`animPhase → 垂直偏移`（如 `[0,-1,-2,-1]`）。
- 逐物种 idle accent：新增 `host/src/render/idle-accents.js`，`drawIdleAccent(g, species, x, y, animPhase)` 按物种分派（火苗闪烁 / 电火花 / 水波 / 叶摆孢子 / 星光 / 缎带爱心 / 冰晶 / 环纹明灭 …，见四件套表）。1px 程序图元叠在精灵旁/上。

### KEY 招牌动画

- 新增 `host/src/render/signature-anim.js` `playSignatureAnimation({ transport, species, delay=realDelay })`：复用进化-anim 模式，逐帧 `await push` + `delay` 推 4–8 帧（通用跳一下 + 该物种 accent 爆发）。
- **音频分工避免双响**：KEY 短按时**固件本地即播** `g_active_cry`（即时音频）；host 招牌动画**只做视觉、不再 `playSound`**。两者皆在按下瞬间触发，时序贴合。
- **持久按钮处理（阻断项修复）**：现状 `runOneTick` 只在 tick 执行的瞬间临时订阅按钮（`index.js:70,137-139`），tick 间隔（~60s）按下的 KEY **不被 host 捕获** → 招呼动画无法「按下即触发」。P4 须在 `main()` 建**持久 `transport.onButton` 处理**：KEY **short** 直接用最新 render model 触发 `playSignatureAnimation`；`readyToEvolve` 时改走进化动画。进化也从此持久通道消费（顺带修复现有进化对同一时窗的依赖）。`hasKeyPress` 收紧为只认 `kind==="short"`，避免 long/double/down/up 误触。

---

## 内容：18 只「个性四件套」

`{ 真声音序(固件 Note 格式) · 气泡 idle/happy/strained · idle accent · 招牌动作 }`。下表音序已应用批判复核的 3 处修正（小火龙时长、火伊布/小火龙撞车、妙蛙种子/伊布撞车）。`idx` = 固件音表索引（`soundId = 3 + idx`）。

| idx | 物种 | 属性 | 真声 cryNotes `{f0,f1,ms}` | 气泡 idle/happy/strained |
|---|---|---|---|---|
| 0 | 伊布 eevee | 普通 | `[{520,780,110},{0,0,40},{760,1150,130}]` | Bui! / Bui♪ / bui… |
| 1 | 水伊布 vaporeon | 水 | `[{600,900,150},{900,700,130}]` | 咻~ / 汩汩 / 凛~ |
| 2 | 雷伊布 jolteon | 电 | `[{1200,1450,45},{1450,1200,45},{1200,1450,45},{1450,1200,45},{1450,950,75}]` | 滋滋! / 噼啪! / 嗞— |
| 3 | 火伊布 flareon | 火 | `[{740,520,150},{0,0,35},{560,360,170}]` | 呼噜 / 暖暖! / 咻… |
| 4 | 太阳伊布 espeon | 超能 | `[{700,1040,120},{0,0,40},{1040,1320,150}]` | 叮~ / 叮铃♪ / 嗯… |
| 5 | 月亮伊布 umbreon | 恶 | `[{300,300,150},{0,0,45},{260,230,170}]` | 呜… / 呼~ / …… |
| 6 | 叶伊布 leafeon | 草 | `[{560,640,110},{0,0,40},{620,540,130}]` | 沙~ / 沙沙♪ / 萎… |
| 7 | 冰伊布 glaceon | 冰 | `[{1500,1500,70},{0,0,35},{1700,1180,150}]` | 叮! / 叮叮♪ / 咔… |
| 8 | 仙子伊布 sylveon | 妖精 | `[{780,780,130},{0,0,30},{990,990,150}]` | 叮铃 / 铃♪ / 呜~ |
| 9 | 妙蛙种子 bulbasaur | 草 | `[{540,700,110},{0,0,40},{620,800,130}]` | 种子! / 芽芽♪ / 蔫… |
| 10 | 妙蛙草 ivysaur | 草 | `[{460,600,110},{0,0,40},{560,720,120},{720,560,90}]` | 蛙草! / 咕嘟♪ / 垂… |
| 11 | 妙蛙花 venusaur | 草 | `[{300,380,150},{0,0,40},{360,300,130},{0,0,40},{300,280,140}]` | 蛙花! / 轰隆♪ / 沉… |
| 12 | 小火龙 charmander | 火 | `[{900,520,90},{0,0,30},{660,400,140}]` | 嘎喔! / 噗噗! / 咕… |
| 13 | 火恐龙 charmeleon | 火 | `[{720,700,35},{560,580,35},{0,0,30},{760,360,160},{320,260,100}]` | 嘎欧! / 嘶哈! / 唔… |
| 14 | 喷火龙 charizard | 火/飞 | `[{300,280,70},{280,320,60},{0,0,30},{420,230,180},{260,700,170}]` | 吼!! / 嗷吼! / 嗯… |
| 15 | 杰尼龟 squirtle | 水 | `[{640,920,90},{0,0,35},{900,1180,70},{1180,720,55}]` | 杰尼! / 噗噜♪ / 杰… |
| 16 | 卡咪龟 wartortle | 水 | `[{520,760,120},{760,1000,90},{0,0,35},{900,560,130}]` | 卡咪~ / 咕噜噜 / 卡咪… |
| 17 | 水箭龟 blastoise | 水 | `[{440,640,130},{0,0,40},{600,360,120},{0,0,35},{300,210,150}]` | 水箭! / 轰隆~ / 咕嗯… |

**属性音语言**（跨家族一致，复核已验证）：火=下行扫频带毛刺；水=圆润滑音；电=高频快颤+爆点；草=柔和偏低短音；超能=空灵上行双音；恶=极低稳态哼；冰=高频叮+脆裂下滑；妖精=纯三度协和双铃；龙(喷火龙)=最低胸腔吼+末段上扬腾空。**进化递进**：小火龙→火恐龙→喷火龙（音区降、加嘶吼起手/低吼，240→360→510ms）；妙蛙种子→草→花（音区 560-880→460-720→280-380，3→4→5 音）；杰尼龟→卡咪龟→水箭龟（起音降、尾段沉到 210Hz 闷雷）。

**idle accent / 招牌动作**（程序化，逐物种）：完整逐帧编排见下「附录·四件套全文」（火苗闪烁、电火花+闪白、同心水环、叶摆孢子、额宝石星芒、环纹明灭光圈、冰晶放射裂散、缎带爱心、花苞喷孢、炮口水箭等）。原则：idle = 2–4 相位细微循环；招牌 = 4–8 帧「跳一下 + accent 爆发」。

---

## 实现分期

一份 doc 覆盖全部，**实现分期**，每期独立走 `spec→codex 评审→plan→codex 评审→实现→闸门`：

1. **P1 视觉加粗**：`dilate1bpp` + `drawSprite` bold。出对比图验「实」。（render 层，零风险，先见效）
2. **P2 真声 + 气泡**：`species-cries.json` + `gen-cries.mjs` 生成两侧；固件 `species_cries.inc` + `T_CONFIG` active-cry（atomic）；host `cry-audio.js` + `setActiveCry`（含重连重放）；`cries.js` 三变体。
3. **P3 idle 循环架构**：`buddy-animator.js` + **push mutex** + 自调度 + 呼吸 bob + `idle-accents.js`。（架构最重，单列；先落 push mutex 与 pause/resume 测试再接 accent）
4. **P4 招牌动作**：`main()` **持久按钮处理**（KEY short→招牌/进化）+ `signature-anim.js` + 逐物种 accent 爆发。
5. **P5 重烘焙放大**：`bake-assets.mjs` targetMax/膨胀 + slot/布局微调。（联网，放最后）

## 单元测试要求（requirement-driven）

- `dilate1bpp`：**不 mutate 输入**；原墨像素保留；细线断点连通、膨胀半径受限（**不测「实心块幂等」——实心块本就外扩一圈**）；全黑画布稳定；透明白底仅在墨线邻域变 opaque；全 18 物种 ink-ratio/小孔保留 + 人工 1-bit 预览兜底（防眼睛糊死/部件粘连）。
- **单一真源一致性**：生成的 `cry-audio.js` 映射与 `species_cries.inc` 顺序逐项一致；sound id 连续 `[3,20]`、18 个唯一；只读 JSON/生成产物，不联网。
- `setActiveCry`：spy transport 收到 `T.CONFIG(0x04)` 帧、payload[0]=正确 id；mock no-op。**重连重放**：fake reconnect 后 `setActiveCry(lastActiveCry)` 被重发一次。
- `cryFor(species, mood)`：各 mood 返回对应变体（happy/strained/fainted/shocked/focused 全覆盖）；未知物种回退 `♪`。
- **push 并发反向测试**：两个 `push()` 同时发起，第二个必须等第一个更新 `previousBytes` 基线后才算 diff（断言 diff 的 baseline 顺序，防残影）。
- `buddyAnimator`（fake timers + spy transport）：自调度按 interval 推帧；经 push mutex 串行（下一次 push 不早于上一次 resolve）；`pause` 期间不推、`resume` 后恢复；push 超 interval 时跳帧不积压。
- **持久按钮**（注入按钮事件 + spy/mock）：KEY `short` → 触发 signature；`long/double/down/up` 不触发；`readyToEvolve` 时走进化不走 signature。
- `drawIdleAccent`：每只物种相位 0 ≠ 相位 2 的**最终 1-bit bitmap**（不看灰阶替身）；18 只 accent 区互不相同。
- `playSignatureAnimation`（fake delay + spy transport）：帧数在 4–8；顺序推送；**不调用 `playSound`**（视觉-only，避免与固件本地双响）；可注入 delay。
- 集成（mock transport）：物种变化 → `setActiveCry` 以正确 id 调用一次；进化/孵化/整点链路无回归。
- 全量回归 0 fail，**设备插着 / host 不跑时也 0 fail**（一律 mock/fake transport，绝不真实探测串口）。

## 风险

- **idle 循环与主 tick/招牌/sensor/button 抢串口**：核心是 `push` 外层 promise-chain **mutex**（覆盖 diff→push→baseline 全段），animator pause/resume 仅调度、不能替代；P3 最高风险，先落 mutex + 并发反向测试再接 accent。
- **KEY 招牌需持久按钮（架构改动）**：`main()` 须新建持久 `onButton` 通道并把进化消费也迁入，改动面比单纯加动画大；P4 先验证持久通道（含 short-only 过滤）再接招牌帧。
- **host↔固件音表排序漂移**：已由单一真源 `species-cries.json` + `gen-cries.mjs` 生成两侧消解；禁止手写第二份顺序。CI/测试断言生成产物与 JSON 一致。
- **膨胀糊死细节**：radius=1 一般安全，但需对全 18 + Oak + onboarding 复用点目检（眼睛/相邻部件粘连）。
- **反射屏连续局部刷新**：ST7305 刷新快（~12µs SPI），3FPS 小脏区无压力；仍以 USB 供电、无电池顾虑。
- **重烘焙联网**：`bake-assets.mjs` 依赖 PokeAPI 可达；测试只读已入库 PNG，绝不联网（沿用既定约束）。

## 附录 · 四件套全文（idle accent + 招牌逐帧）

> 实现 P3/P4 时按此编排；此处保留每只完整描述，篇幅原因列要点。

- **伊布**：idle 耳尖/尾尖 1px 抖动点 + 呼吸 1px（4 相位）。招牌 6 帧：蹲→跳+耳竖→落地甩尾弧→回弹。
- **水伊布**：idle 体侧 1px 水波弧左右交替 + 尾尖滴水。招牌 7 帧：沉→跳→落地连画 3 圈同心水环→淡出滴水。
- **雷伊布**：idle 毛尖随机 1-2 个 1px 火花 + 轮廓 1px 抖。招牌 6 帧：弓身炸毛→弹跳→迸放电折线→**整屏反白 1 帧**→收回余颤。
- **火伊布**：idle 颈毛/尾缘 1px 暖气点飘散（非火苗，绵软）。招牌 7 帧：吸气→前扑→鼻前呼出渐大暖焰云→颈毛炸大一圈→飘散回落。
- **太阳伊布**：idle 额宝石 1px 高亮 + 体外 1px 光点缓慢绕行。招牌 7 帧：凝神→上跃→额宝石迸十字星芒→体外光点环绕一周→收敛余辉。
- **月亮伊布**：idle 环纹 1px 短弧整体明灭脉冲（2-3FPS 极缓）。招牌 6 帧：低伏→缓步前倾→环纹强亮晕出光圈→扩散→骤暗。
- **叶伊布**：idle 头/尾叶 1px 摆动线 + 偶飘 1px 孢子。招牌 7 帧：屈身→前跃→头尾叶大幅摆→迸 3-4 孢子点扩散→回落。
- **冰伊布**：idle 头/尾 2-3 个 1px 冰晶十字 + 偶呵 1px 冷气弧。招牌 6 帧：绷身→侧跃→迸 4-5 冰晶放射定格→边缘裂纹→碎散飘落。
- **仙子伊布**：idle 缎带 1px 波线传导 + 偶冒 1px 爱心。招牌 7 帧：屈身→小跳→双缎带舒展大波→冒 2-3 个渐大爱心上飘→回收淡出。
- **妙蛙种子**：idle 球根顶窄三角叶尖左右倾 + 花粉点 + 呼吸 1px。招牌 6 帧：蹲(沉2px)→跃(起3px)→叶展 V 字弹 3 花粉→扩大轻颤→落地收回。
- **妙蛙草**：idle 背部梭形花苞鼓胀冒花粉 + 叶沉摆 ±1px。招牌 7 帧：蹲→前扑→花苞裂缝透亮→张口扇喷 4 花粉→扩散轻晃→半合回正。
- **妙蛙花**：idle 大花 4-6 花瓣尖点阵外扩 + 孢子缓飘 + 呼吸 ±2px(最慢)。招牌 8 帧：重蹲(沉3px)→前压→花瓣外张中心透亮→喷 6-8 孢子团→扩到最大震动→外飘变淡→缓收散尽。
- **小火龙**：idle 尾尖 3-5px 火苗左右偏 + 火星 + 呼吸 1px。招牌 6 帧：蹲跳→张嘴尾火窜高→喷 3px 火舌+2 火星→散开前倾→回正尾火闪。
- **火恐龙**：idle 尾尖 5-7px 火焰带内焰缺口、外溅火星、偶鼻烟。招牌 7 帧：重踏沉肩→抬头尾火暴涨1.5×→猛吐 5px 火舌+4 火星扇形→回收爪挥→尾火鼻烟各闪。
- **喷火龙**：idle 尾尖 7-9px 跃焰 + 火星升腾 + 偶发两侧 4px 翼弧半收。招牌 8 帧：沉肩半张翼→双翼上振离地 1px→仰头尾火冲天2×→喷 8px 火柱+6 火星宽扇→收束翼落→尾火翼尖闪白。
- **杰尼龟**：idle 脚边单层水波椭圆外扩 + 尾尖小水点。招牌 4-6 帧：蹬腿前倾→嘴边鼓水珠→喷短水柱+水波扩 2-3 层→水花碎点弹起。
- **卡咪龟**：idle 体侧交替冒小气泡上升破裂 + 毛尾轻摆。招牌 5-7 帧：蹲身竖毛尾→两颊鼓气气泡密涌→斜上喷粗水柱气泡炸→甩尾收势。
- **水箭龟**：idle 背双炮口各冒短水汽竖线 + 滴水成贴地波纹。招牌 6-8 帧：四肢沉炮转正→炮口聚高光水球→射粗水箭炸放射→巨浪扩 2-3 层身后坐→炮口余水滴落波回。
