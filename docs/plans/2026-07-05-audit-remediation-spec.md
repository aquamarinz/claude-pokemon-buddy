# 2026-07 只读审计整改 SPEC（AR 系列）

> 状态：Draft v2 · codex spec R1 已吸收（3 High：AR1 日期语义校验 / AR2 强制整体防御 / AR4 候选语义收窄+202 事务；AR6 节流收紧；AR7 Low 移 BACKLOG）· 待 codex R2。日期：2026-07-05。
> 来源：只读对抗审计（Claude 主审 + 51-agent 工作流对抗验证）+ Codex(gpt-5.5 xhigh) 独立第二意见（session 019f2f36，零假阳性、未发现第 12 个 bug）。报告：`docs/`（审计报告见 scratchpad `audit-report-for-codex.md`）。
> 编号：AR1..AR7 一一对应审计的 BUG-001..007。定级采用双模型对齐后的终值。
> 行号为本文写作时快照（HEAD `1df1c25`），实施时以语义定位为准。
> 编码分工（依全局工作流契约）：本 spec 由 Claude 写；实现由 codex 子代理经 codeagent 执行；Claude 做 PM 评审 + 亲自跑门禁（`node --test` / 相关子集）。

## 0. 总原则（继承 6 月/7 月冲刺 + 本轮 codex 安全约束）

- **不破坏 userspace**：任何修复不得改变现有绿色测试的既有语义；每项修复至少 1 个需求驱动的新测试（纯删除/断言类除外）。
- **降级统一哲学**：任何持久化/外设/网络/文件失败 → 软降级 + 留证据（log 一次 + 保存坏现场），禁止静默重置与 abort（继承既有约定）。
- **状态 schema 变更**：任何 `salvageState` 白名单/校验变更必须同步 `isValidState` 快路径与救援路径两处，且与 `stripTransient`/`ensurePet` 一致。
- **Codex 修复安全约束（硬性，写入对应条目）**：
  - AR4（进化）：修复不得破坏既有 **eevee 持石（held-stone）** 流程与单线进化回归。
  - AR5（情绪）：**让 `deriveMood` 忽略 stale**，不得置空 UI 已标注 stale 的展示字段。
  - AR6（可观测）：日志/计数不得刷屏 3Hz animator 循环（须节流）。
  - MNT/OPT 相关抽取（本 spec 不含，见 §BACKLOG）：若日后抽取须保留固件 **0..100 音量契约** 与 **fsync/rename 崩溃安全** 语义。
- **协议改动两端同批**：AR7 涉及 host↔firmware 协议，须两端协调落地（见 P1），不得单侧半改。

## Pre. 前置门禁（不进本轮代码修复集）

**PRE-1 时区问题（Needs More Context — 两模型均未证实，禁止贸然改）**
`host/src/usage.js:7-8` 调 `npx --yes ccusage blocks/daily --json` 未传任何 TZ 参数；`today` 由本地日历得出（`usage.js:145-150`）。若 ccusage 按 **UTC** 分桶 `daily.period`，则 Auckland（默认配置 UTC+12/+13）用户的 `todayTokens` 与 `activeDays` 会有跨日边界 off-by-one → 误记成长/错误 streak/bond 衰减。
**动作**：先对真实 ccusage 实测 `daily.period` 时区（对比 UTC 午夜前后写入的用量落在哪一 period）。**在证实之前不改任何 settlement/usage 时区行为**（`daysBetween` 本身已证正确、DST 安全，勿动）。结论产出后再决定是否新开条目。本 spec 其余条目与 PRE-1 无耦合，可并行推进。

---

## 1. P0 — Host 侧正确性/可靠性（低爆炸半径，本轮主体）

### AR1（Medium）状态加载无字段级校验：结构合法但语义损坏的 state 被信任

**问题**：`isValidState`（`host/src/state.js:57-64`）仅校验"非数组对象 + `schemaVersion===1`"；`loadState:39` 命中即原样返回。救援路径 `copyNumber`（`state.js:100-102`）只查 `Number.isFinite`（无范围），而 `copyIv`/`copyStone` 却做了范围/枚举校验——证明标量遗漏是疏忽。`lastSettled` 从不校验日期格式。三种表现（同一根因）：
- (a) **崩溃冻结**：`lastSettled:"garbage"` → `new Date("garbageT00:00:00Z")` 为 Invalid → `daysBetween`（`settlement.js:86-98`）中 `current >= end` 恒 false（NaN）→ `toYmd(Invalid).toISOString()` 抛 `RangeError: Invalid time value` → `runOneTick` 抛 → tick 跳过、`saveState` 不执行 → **宠物冻结、每 60s 报错、无自愈**。（已实证：`node -e 'new Date("garbageT00:00:00Z").toISOString()'` 抛。）
- (b) **CPU/内存抖动**：合法但久远 `lastSettled:"0001-01-01"` → `daysBetween` 先物化约 73.9 万条字符串（约 37MB）**再** `cappedDays` 截到 30，且每 tick 两次（`settleDays` + `buildUsedDays`，`index.js:167-169`）。
- (c) **数值污染**：`level:-5,bond:-999,exp:5e9` 被原样接受；`sim.js:37-38` 无下限钳制 → level 爆炸；dashboard viewmodel 原样透传未钳。

**根因**：`loadState` 快路径与救援路径均缺字段级归一化/钳制；`daysBetween` 先物化后截断。

**修复**：
1. 新增 `normalizePet(state)` 归一化函数，在 **快路径命中后** 与 **救援合并后** 两处统一应用：
   - `lastSettled`/`lastGrowthDay`：**语义**日期校验（regex 不够——`2026-99-99` 匹配 regex 但仍 Invalid；`2026-02-30` 会被 JS 归一为 `2026-03-02`，代表另一天）。判定：`const d = new Date(s + "T00:00:00Z")`；要求 `!Number.isNaN(Number(d))` 且 `d.toISOString().slice(0,10) === s`（`toISOString` 置于 try，Invalid 抛错即判失败）。不满足 → 丢弃该字段（回退 `ensurePet` 默认，等价"从今日重新结算"）。**不设人为年份下限**（合法但久远日期由点 3 的 `daysBetween` 上界兜住，避免误伤长期休眠宠物）。
   - `level` → `max(1, ...)`；`exp` → `[0, PARAMS.levelExp)` 钳；`bond` → `[0, PARAMS.bondSoftCap]`；`streak`/`shield`/`careCount`/`todayCredited*` → `max(0, ...)`；`shield` 额外 `min(2, ...)`。
   - 非有限/类型不符 → 丢弃回默认。
2. `copyNumber` 增加**按字段**范围守卫（对齐 `copyIv` 风格），使救援路径不再吐越界值。
3. `daysBetween` 加上界保护：先按日期相减算天数，`min(maxCatchupDays, ...)`，仅物化尾部窗口（杜绝 73.9 万物化）。

**验收**（需求驱动）：
- 单测(错误输入)：`loadState` 读 `{schemaVersion:1, hatched:true, lastSettled:"garbage", ...}` → **不抛**，`lastSettled` 被丢弃/归一，后续 `settleDays` 正常。
- 单测(语义非法日期)：`lastSettled:"2026-99-99"`（regex 合法但 Invalid）与 `lastSettled:"2026-02-30"`（JS 归一为 03-02）→ 均被丢弃（不抛、不按错误日结算）。
- 单测(边界)：`lastSettled:"0001-01-01"`（合法但久远）→ `settlementWindow` 返回 ≤30 条且**不**物化 70 万数组（计时/spy 断言迭代次数 ≤ maxCatchupDays）。
- 单测(数值越界)：`{schemaVersion:1, level:-5, bond:-999, exp:5e9, streak:-3}` → loaded `level>=1 && bond ∈[0,cap] && exp ∈[0,100) && streak>=0`。
- 单测(救援)：`copyNumber` 对 `level:-5` 丢弃/钳制（与 `copyIv` 一致）。
- 回归：现有 `state.test.js` 全绿（合法值不变）。

**影响文件**：`host/src/state.js`、`host/src/pet/settlement.js`；测试 `host/test/state.test.js`、`host/test/settlement.test.js`。

### AR2（Medium）中毒 `cpb-usage.json` 的 reset epoch 在 try/catch 外抛错 → 显示冻结

**问题**：`loadRateLimits`（`host/src/rate-limits.js:10-14`）的 try/catch 仅包住 `readFileSync`/`JSON.parse`；`epochToIso(data.fiveHourReset)`（`:22-23`，实现 `:33-35`）在其**外**执行，仅 `Number.isFinite` 守卫。`Number.isFinite(1e18)===true` 但 `new Date(1e18*1000).toISOString()` 抛 `RangeError`（Date 有效范围 ±8.64e15 ms）。→ `loadRateLimits` 抛 → `index.js:347` 每 tick 调用 → tick 跳过（记 "buddy tick failed; continuing"）→ **文件中毒期间不出帧**。（已实证。）

**根因**：`epochToIso` 无量级守卫，且调用在防御边界外。

**修复**（两项均为必须，非二选一——codex 指出 `data.writtenAt` 解引用在 catch 外：`cpb-usage.json` 内容为 JSON `null` 时 `:15` 的 `Number(data.writtenAt)` 先抛 `TypeError`，早于 epochToIso。已实证）：
1. **对象形状守卫 + 整体防御**：解析后先判 `data` 为普通对象（非 `null`/数组/原始值），否则返回 stale 全空形状；并将 `:15-26` 的全部后解析归一化（`writtenAt`/`numOrNull`/`epochToIso`）纳入防御（前置守卫或整体 try），任意抛错 → 返回 `{p5h:null,pweek:null,resets5h:null,resetsWeek:null,official:false,stale:true}`。
2. `epochToIso` 加范围守卫：`return Number.isFinite(sec) && Math.abs(sec) < 8.64e12 ? new Date(sec*1000).toISOString() : null;`

**验收**：
- 单测(错误输入)：`loadRateLimits({path: fixture({fiveHourReset: 1e18})})` → 返回对象且 `resets5h===null`，**不抛**。
- 单测(中毒文件形状)：`cpb-usage.json` 内容为 `null`、原始值（`5`/`"x"`）或数组 → 返回 stale 全空形状，**不抛**（当前 `null` 会在 `Number(data.writtenAt)` 抛 TypeError）。
- 单测(边界)：`fiveHourReset = 8_640_000_000_001`（阈值+1，毫秒误入秒位）→ 同上不抛。
- 单测(正常)：现有 `rate-limits.test.js` 正常 reset 断言不变。
- 集成(可选)：中毒文件下 tick 不中断渲染（沿用 loop-survives 框架）。

**影响文件**：`host/src/rate-limits.js`；测试 `host/test/rate-limits.test.js`。

### AR3（Low）`weather.rounded(null)===0` 伪造读数并干扰进化

**问题**：`rounded(v)`（`host/src/weather.js:99-103`）先 `Math.round(v)` 再 `Number.isFinite` 查；`Math.round(null)===0`、`Number.isFinite(0)===true` → JSON `null` 标量变 `temp:0` 且 `degraded:false`（结构缺失/undefined 才抛→degraded）。`index.js:563` 守卫 `weather.temp == null` 不拦 0。`isCold(0)===true`（`temp<=4`）注入幽灵 eevee→glaceon 冷系分支；`humidity:0` 压制 warm-humid→leafeon。情绪不受影响（用 p5h）。

**根因**：`Math.round` 先于类型检查；`daily.*[0]` 无数组守卫。

**修复**：`rounded` 先判类型/有限——`if (typeof v !== "number" || !Number.isFinite(v)) throw ...` **再** `Math.round`；`normalizeWeather` 在索引 `daily.temperature_2m_max[0]` 等前加数组/长度守卫。使 `null` 标量与结构缺失一致地整体 degrade。

**验收**：
- 单测(错误输入)：`current.temperature_2m: null`（其余合法）→ `get()` 返回 degraded null-weather（`temp:null, degraded:true`），**不**返回 `temp:0`。
- 单测(边界)：`daily.temperature_2m_max: []` → 走 degraded 而非 TypeError 泄漏。
- 回归：现有 `weather.test.js` 合法响应断言不变。

**影响文件**：`host/src/weather.js`；测试 `host/test/weather.test.js`。

### AR4（Medium）进化候选/石头状态从不回收 → 看板幽灵按钮静默失效【正常玩法可达，优先级最高】

**问题**：`applyPetTransitions` 写 `pendingCandidates`（`transitions.js:85`，持久化），每 tick 重算 `readyToEvolve`（`:75-76`）却**从不清** `pendingCandidates`；唯一清除是 `evolvePet`（`:121`）真进化时。`stone` 同为 write-once/仅进化清。看板按候选渲染"选择 X"按钮，仅以 `candidates.length>0` 门控（`app.js:185`），`ready` 仅用于文案（`app.js:174`）。choose 处理器校验的是可能陈旧的 `runtime.pet.pendingCandidates`（`index.js:475`），intent 一入队即返 200（`server.js:157`）。三表现：
- (a) **幽灵按钮**：`settleDays` bond 自然衰减（`bondDecayPerMissed=3`，`evolveBond=56`）或 daytime 翻转或天气变化 → `resolveEvolution` 空 → `readyToEvolve=false`，但 `pendingCandidates` 残留。用户点 → 200 → 下 tick 新解析找不到候选 → `if(choice)` 假 → 静默丢弃、无错。**永久可点、永远假成功。**
- (b) **HTTP 与 tick 权威分裂**：处理器校验 ≤60s 陈旧快照，tick 用实时条件重解析；边界处（如 18:05 点白天分支）返 200 但 tick 丢弃。
- (c) **惰性石头**：任意名合法石头无条件持久化；对无匹配分支物种永久卡住（`state.js:119-121` 再救援），无清除路径。

**根因**：进化就绪/候选状态"一次写入、永不对账"，且看板与 HTTP 层各持真源。

**修复**（codex spec R1 修订——`pendingCandidates` 收窄为"选择提示态"；消除 POST-成功 vs tick-消费竞态；保留 eevee 持石与单线回归）：
1. **`pendingCandidates` = 仅"多候选选择提示"态**：`resolveEvolution` 对 auto/单候选也返回**非空** `candidates`（`evolution.js:29` 单候选走 `auto` 但 `candidates=[它]`），故**不能**以 `candidates.length>0` 门控——否则会给 auto/单线进化也持久化候选、在看板冒出不该有的"选择"按钮。语义收窄为：仅当 `!auto && candidates.length > 1`（真多候选、需玩家选）时设置/更新 `pendingCandidates`；**auto、单候选、not-ready 三种情况一律 strip**（`next` 删除字段）。
2. 看板渲染门控：`app.js` 的"选择 X"按钮以 `nextEvo.ready` 门控，非仅 `candidates.length`。
3. **单一权威事务，消除假成功**：choose/stone 处理器对**当前实时** `resolveEvolution`（用 runtime 的 weather/room/now）校验目标；非法 → 立即 **400**；合法 → 入 intent 队列返 **202 Accepted (queued)**，**UI 仅在下一次 `/api/state` 轮询观察到 state 变化后才确认进化**（不把 202 当作已进化，解决"POST 时合法、下 tick 失效"的边界）。石头：授予前校验该石头对**当前物种**存在匹配分支，否则 400；**保留 eevee 持石流程**（水/雷/火合法授予并进化）；已授予但无匹配的惰性石头由 tick 内 (1) 类清理逻辑移除。

**验收**：
- 单测(状态迁移·失效清除)：seed `{bond:56, readyToEvolve:true, pendingCandidates:[espeon,leafeon]}`，**bond 衰减至 <56**（用 `settleDays` 缺勤衰减制造 not-ready，**非** night/cold——eevee 夜/冷仍可能有 umbreon/glaceon 候选）→ 结果 `readyToEvolve===false` 且 `pendingCandidates===undefined`。
- 单测(单线不弹选择·回归)：Bulbasaur level-ready（单线 → ivysaur，auto）→ `pendingCandidates` 保持 `undefined`，**不**产生 dashboard choose 候选。
- 单测(多候选才设)：eevee `!auto && candidates=[espeon,leafeon]` → `pendingCandidates` 被设；单候选/auto 场景 → 不设。
- 集成(边界·POST合法/下tick失效)：候选 POST 时合法、下 tick 条件失效 → 端点对已失效返 400，或返 202 后 tick 物种不变且无假"已进化"；UI 依 `/api/state` 变化确认。
- 单测(石头)：无匹配分支物种 `POST /stone {fire}` → 400 或下 tick 清除；**eevee 持水/雷/火石正常授予并可进化**（回归）。
- 回归：妙蛙种子等单线进化、既有 `evolution-trigger`/`web-integration` 全绿。

**影响文件**：`host/src/pet/transitions.js`、`host/src/index.js`、`host/src/web/server.js`、`host/src/web/viewmodel.js`、`host/src/web/public/app.js`；测试 `host/test/{evolution-trigger,evolution,web-integration,transitions?}.test.js`（新增 lapse-and-linger 场景）。

### AR5（Low）`deriveMood` 消费陈旧（>15min）rate-limit p5h → 僵尸情绪

**问题**：`loadRateLimits`（`rate-limits.js:16-26`）无条件返回 p5h/pweek，仅 `stale` 反映时效；`deriveMood`（`sim.js:11-17`）不看 `rateStale`。陈旧 `fiveHourPct:100` → 永久 "fainted"，违背 `sim.js:13` 本意（"未知→中性"）。`rate-limits.test.js:50-54` 固化了泄漏。

**修复**（采纳 codex：让 `deriveMood` 忽略 stale，不置空 UI stale 展示字段）：`deriveMood` 接受 `rateStale`（或整体 usage）参数；stale 为真时按"未知 utilization"分支返回中性 `"focused"`。`mergeUsage`/`index.js:192` 调用点传入 `rateStale`。UI 仍展示 stale 标记的旧值（不改 viewmodel）。

**验收**：
- 单测(状态迁移)：stale fixture `fiveHourPct:100` → `deriveMood(usage)==='focused'`（非 'fainted'）。
- 单测(正常)：非 stale `fiveHourPct:100` → 'fainted'（不变）。
- 回归：`rate-limits.test.js` stale 断言不变（p5h 仍返回、仅情绪逻辑改）。

**影响文件**：`host/src/pet/sim.js`、`host/src/index.js`；测试 `host/test/{personality?,sim?,mock/state}.test.js` 视 deriveMood 测试所在。

### AR6（Low）静默失败无可观测：animator 循环 + usage 加载

**问题**：animator（`buddy-animator.js:17-33`）把 render+push 包在 `catch{}`（无 logger/计数），`start()` 的 `loop().catch(()=>{running=false})` 亦静默；持续抛错时宠物冻结但零日志（约 1 万次/时）。`loadUsageSnapshot`（`usage.js:13-15`）裸 `catch{return{ok:false}}` 丢弃原因（超时/退出码/schema 漂移）。兄弟路径 `pollUsage`（`index.js:337-346 logFailureReasonTransition`）却做对了 → 不对称暴露疏漏。

**修复**（采纳 codex：节流，勿刷屏）：
1. animator 工厂增 `logger` 注入；catch 内维护**连续**失败计数：在**首次失败**（0→1 转变）与**每第 30 次连续失败**（@333ms ≈ 每 10s）各告警一次，成功一帧即清零；`start()` 的 `loop().catch` 记录原因。
2. `loadUsageSnapshot` 返回 `{ok:false, reason}`；`index.js` 复用 `logFailureReasonTransition`（或同构）按转变节流记一次。

**验收**：
- 单测(有界节流)：always-throw 的 render + mock logger，跑 60 帧 → 告警数 ≥1 且 ≤3（首次 + 每 30 次），**非每帧一条**；成功一帧后再失败 → 计数重置、再次首告警。
- 单测：`loadUsageSnapshot` 的 `run` 抛 'schema drift' → 返回对象含 `reason:'schema drift'`。
- 回归：happy path 不新增噪声日志。

**影响文件**：`host/src/render/buddy-animator.js`、`host/src/usage.js`、`host/src/index.js`；测试 `host/test/{buddy-animator,usage}.test.js`。

---

## 2. P1 — 固件/协议（需两端协调，独立小批）

### AR7（Low，Partial）固件 FRAME seq 去重跨 host 重启 → 1/256 首帧丢失

**问题**：固件按设备持久的 `last_acked_frame_seq` 去重（`main.cpp:103-104,243-249`）；host `nextSeq` 每进程重置 0（`serial.js:85,110`）。若上一会话末 blit 的 seq 为 0，新会话首个（全帧）seq=0 被误判重传 → 只 ACK 不 blit → host 把 `previousBytes` 提交为未显示的全帧（`transport/index.js:70-73`）→ 不再重发。
**Codex 纠正的爆炸半径**：仅 buddy 子区经 animator ~333ms 恢复（seq 1 blit 该 rect 于陈旧底图上）；**静态左栏（用量/天气/时钟）保持陈旧直到其内容下次变化（≥ 下个 60s tick）**，非"333ms 全帧自愈"。

**根因**：设备侧去重状态无会话边界；host 无会话重置信号。

**修复**（协议改动，两端同批）：host 在（重）连接建立后发一个显式**会话重置**（复用/扩展 HELLO 或新增 RESET 帧），固件收到即清 `have_last_acked_frame_seq`。**须先定协议字节格式**（proto.js + main.cpp 常量同步）再实现。

**验收**：
- 固件/proto 单测（镜像 `parse_frames`）：设 `last_acked_frame_seq=0`，喂"真新" seq=0 帧（不同像素）→ 必须 blit（非仅 ACK）。
- host 单测：新 transport 会话首帧不被设备去重吞掉（发送会话重置后首帧必达）。
- 回归：既有 seq-dedup 幂等（重传同 seq 不重画）行为不变。

**影响文件**：`firmware/main/main.cpp`、`host/src/transport/{proto,serial,index}.js`；测试 `host/test/{proto,proto-firmware-consistency,serial}.test.js`。

**风险**：协议变更；须确保旧固件/旧 host 混搭优雅降级（旧固件对未知 type 静默丢弃 → host-first 无害，但会话重置须新固件方生效）。
**本轮决定（采纳 codex Low + backlog-acceptable）**：**AR7 本轮不实现，移入 BACKLOG（协议小批另立）**——实现前须先定义：host→device RESET opcode 的字节格式（proto.js + main.cpp 常量同步）、ack/fire-and-forget 语义、以及**初连与重连时相对首个 FRAME 的顺序**（注意 `serial.js:285` 现在 reconnect 回调先于 `pump()`）。P0（AR1..AR6）为纯 host、无协议改动，先行落地；AR7 作为已知残留在交付报告标注。

---

## BACKLOG（本 spec 明确不含，另立冲刺）

- **AR7（Low，固件/协议）** 跨 host 重启 seq 去重 1/256 首帧丢失（本轮从 P0 移出，协议小批另立——需先定 RESET opcode 格式/ack 语义/初连重连顺序，见 §2）。
- **OPT-1（Medium，性能）** animator 热路径：全帧 PNG 重编码 + 同步落盘 3×/s + 静态左栏重绘 + sprite 重阈值。修复须保留 mock PNG 行为（`index.js:487-492`）。
- **OPT-2（Medium，固件）** 每脏矩形整屏 SPI 刷新（需硬件验证 ST7305 窗口刷新可行性）。
- **OPT-3（Medium，性能）** 每 tick 串行 `npx ccusage` ×2（Promise.all / 解析 binary 一次 / 解耦渲染节奏）。
- **OPT-4（Low，性能）** `diffRect` 全扫无早退、`bitAt` 重算 rowBytes。
- **MNT-1（Low，可维护）** 重复 helper：`volumeByte`×3、fsync/isParseableJsonFile×2、`localYmd`×2。抽取须保留 0..100 契约与 fsync 崩溃安全。
- **N1（Nit）** onboarding 按键缓冲上限 8 静默丢弃。
- **N2（Nit）** `weekTokens` 生产环境无消费者（死计算；测试仍读）。

---

## 落地顺序与门禁（两模型共识）

1. **PRE-1 时区调查**（并行，非阻塞 P0）。
2. **AR4**（唯一正常玩法可达，最高优先）→ **AR1/AR2**（坏输入硬化）→ **AR3/AR5/AR6**（低风险独立项）。
3. **AR7** 移入 BACKLOG（协议小批另立），本轮不做。
4. 每项：codex 子代理实现 → Claude PM 评审 diff → Claude 亲跑 `node --test`（相关子集）门禁 → 绿则并入。
5. 全部完成后跑全量 `node --test` 回归。

## 交付定义（DoD）

- AR1..AR6 全部按验收标准通过，含新增需求驱动测试；全量测试绿（`play-test.js` 串口锁失败为环境非回归，可豁免）。AR7 本轮不做（BACKLOG）。
- 每项修复的行为变更在本 spec 有对应验收断言。
- PRE-1 结论落档；若证实 UTC 分桶，另立条目，不在本轮静默改。
