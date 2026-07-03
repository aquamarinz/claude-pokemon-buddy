# 2026-07 全项目审查修复 SPEC（R 系列）

> 状态：Draft v2 · codex R1 review（1 Blocker/2 High/2 Medium/2 Low）已全部吸收：RH1 决选规则重设计（保 leafeon/glaceon 可达）、RH3 保即时签名+requeue 上移、RM12 VOLUME-0 覆盖固件本地叫声、RL7 emit 守卫、§0 host-first 例外。待 R2 复核。日期：2026-07-04。
> 来源：四路并行代码审查（host 核心 / 传输+固件契约 / pet+render / web+固件组件+测试），均已按 6 月冲刺 git 历史去重（不与 H1-H5/M1-M12/L1-L11/N1-N2 重复）。
> 编号规则：RH=High、RM=Medium、RL=Low。每项含【根因】【修复】【验收】。行号为本文写作时快照，实施时以语义定位为准。

## 0. 总原则（继承 6 月冲刺 + 本轮新增）

- 不破坏既有测试；每项修复至少 1 个需求驱动的新测试（Low 的纯删除/断言类除外）。
- **降级统一哲学（本轮新增）**：任何持久化/外设/网络失败 → 软降级 + 留证据（log 一次 + 保存坏现场），禁止静默重置与 abort。
- 协议改动原则上两端同批落地（Batch G）；**显式例外**：RM12 的 host 侧 VOLUME 发送允许先行于 Batch F 落地——已确认旧固件对未知 type 静默丢弃（main.cpp:196），host-first 无害；Batch G 落地固件端后功能完整。
- 状态 schema 新增字段必须同步 `salvageState` 白名单与 `stripTransient`。

---

## 1. High

### RH1 进化决选死锁：多候选永远 auto:null，pendingCandidates 全项目无消费者

**症状**：`careCount` 只增不减（`host/src/index.js:104`），一次长按后 `care:true` 永久成立；bond≥56 时 sylveon(prio 1)+espeon/umbreon(prio 2) 必然 ≥2 候选 → `resolveEvolution`（`host/src/pet/evolution.js:21-30`）永远返回 `auto:null` → KEY 只写 `pendingCandidates`（`index.js:121`），而它全项目零读者（仅写入/持久化/strip）。屏幕永久显示"按 KEY 进化！"但按键无效。`stone` 无任何 setter → 水/雷/火三系不可达。M7 的目标（sylveon 可达）实际未达成。

**根因**：`eligibleBranches` 已按 priority 排序，但 `resolveEvolution` 不用 priority 决选；交互闭环（候选选择、石头授予）从未实现——"表全流不通"。

**修复**（四件套，缺一不可闭环；决选规则经 codex R1 review 修订——纯"最低 priority 自动决选"会让 leafeon/glaceon 永久不可达，因 daytime/night 恒有一真且 prio 2 < 3）：
1. **决选规则**（`resolveEvolution`）：
   a. stone 匹配 → auto（既有逻辑不变）；
   b. 否则若 care 门控分支（prio 1）在候选中 → auto 决选它（长按关怀是显式玩家意图，配衰减后语义为"近期关怀"；与原作"妖精亲密压过普通亲密"一致）；
   c. 否则候选恰 1 个 → auto；
   d. 否则（≥2，如 espeon+leafeon 同时可达）→ `auto:null` + `candidates` 按 priority 排序——落入 pendingCandidates 走消费端（见 3）。leafeon/glaceon 即经此路径可达。
2. **care 衰减**：每日结算（`settlement.js`）时 `careCount = max(0, careCount - 1)`；`evolutionContext` 的 `care` 语义维持 `careCount > 0`。
3. **候选消费端（intent 入队，不直写 state）**：dashboard 新增 `POST /api/evolution/choose {to}`——校验 `to ∈ 当前 pendingCandidates` 后**将 intent 推入编排层注入的内存队列**（与 tick 的 load→save 周期串行化，杜绝 web 直写 state 与 tick 互相覆盖）；下一 tick 消费 intent：若 `to ∈ 当前 eligible` → 进化并清空 pendingCandidates。viewmodel 暴露 `pendingCandidates`。
4. **石头授予**：设计规格 §7.2 已定"石头→手动选"。`POST /api/evolution/stone {stone}`（white-list: water/thunder/fire），同样走 intent 队列，tick 内写入 `pet.stone`；下一次 KEY 触发时 stone 短路进化。进化后清空 `stone`。

**验收**：
- 单测（决选）：care+bond56+daytime → auto=sylveon；无 care+daytime（无环境）→ auto=espeon；无 care+night → auto=umbreon；无 care+daytime+warmHumid → auto=null 且 candidates=[espeon,leafeon]（priority 序）；choose leafeon 后下 tick 进化为 leafeon。
- 单测：settlement 后 careCount 减 1、不减到负。
- 集成：choose 端点非法 to → 400；tick 执行中途提交 choose → intent 不丢失（下 tick 生效，state 无覆盖丢失）；stone 端点 → 下 tick KEY 进化为对应三系，进化后 stone 清空。
- 回归：妙蛙种子等单线进化行为不变。

### RH2 serial `close()` 不结算 in-flight push，关机挂死

**症状**：`host/src/transport/serial.js:325-333` 的 `close()` 清掉 pending 超时定时器但不 resolve pending promise；tick 正 `await push()` 时 SIGINT → await 永久挂起，push 链死锁，`main()` 永不返回。

**修复**：`close()` 内先调 `resolveDisconnected()`（结算 pending 为 `{ok:false, disconnected:true}`），再摘监听、关端口。`index.js` 的 `stop()` 同步确保 loop 定时器 promise 被 resolve（若有挂起的 sleep）。

**验收**：单测：push 挂起中调 close() → push 的 promise 在有限时间内 resolve 为非 ok；`main()` 在 stop() 后正常返回（现有 H5 测试框架内加场景）。

### RH3 按键三消费者并存，同一物理按键双投递

**症状**：`index.js:92`（tick 内瞬时订阅）与 `index.js:205`（常驻 buffer，:263 作为 pendingButtons 重放）并存，tick 期间到达的按键两处都收到。具体危害：tick 中一次 KEY → 本 tick 进化一级 + 下 tick 重放再进化一级（两级连跳）；长按 care +2。另 `index.js:205-216` 签名动画监听器构成第三消费者，同一按键可能"当场签名动画 + 下 tick 又触发进化"。伴生缺陷（RM7 并入本项）：`runOneTick` 订阅无 try/finally，tick 抛错时监听器泄漏（每 60s 加一个，10 分钟 MaxListenersExceeded），且已 splice 走的按键事件随异常静默丢失。

**根因**：按键事件无单一所有权。

**修复**（经 codex R1 review 修订——保留即时响应、requeue 责任上移）：收敛为**单一常驻分发器**（唯一订阅者），按**到达时状态**做 exactly-once 路由：
- 短按且当前非 readyToEvolve → **立即**走签名动画路径（保持今日的即时 UX，经既有 actions 队列串行化），该事件即被消费，**不再**进 tick 队列；
- 短按且 readyToEvolve、长按（care）、双击 → 入 tick 队列，由 `runOneTick` 消费快照。
`runOneTick` 不再自行订阅（删除 :92 的瞬时订阅）；主体 try/finally 保证清理。**requeue 在 drain 调用方**（runTickLoop 侧，队列所有者）实现：`runOneTick` reject 时把本次 drain 的事件 unshift 回队（仅一次机会，带 `requeued` 标记）——`runOneTick` 内部拿到的是快照副本，无法也不应操作队列。

**验收**：单测：tick 执行期间注入按键 → 恰好消费一次（进化恰一级 / care 恰 +1）；非 readyToEvolve 短按 → 签名动画**即时**触发（不等 tick）且该事件不再被 tick 重放；tick 抛错 → 无监听器泄漏（listenerCount 恒定）、按键事件下 tick 重放且仅重放一次；签名动画与进化对同一按键互斥。

---

## 2. Medium

### RM1 本地 Web 面板可被任意网页 CSRF / DNS-rebinding

**症状**：`host/src/web/server.js:41-72` 不校验 Host 头，POST 不要求 `application/json`（text/plain 简单请求免预检）→ 恶意网页可静默改设置；DNS rebinding 可读 `/api/state` 泄露住址经纬度。
**修复**：所有请求校验 `Host ∈ {127.0.0.1:PORT, localhost:PORT, [::1]:PORT}` 否则 403；所有 POST 要求 `content-type: application/json`（不带则 415），强制浏览器走 CORS 预检。
**验收**：单测：伪造 Host → 403；text/plain POST → 415；正常 localhost JSON POST 不受影响。

### RM2 config.json 损坏被静默重置为默认值，且 .bak 备份的是坏文件

**症状**：`host/src/config.js:25-31` parse 失败直接返回 DEFAULTS（无日志、不读 .bak）；下次 `saveConfig`（:33-46）先把损坏文件拷成 .bak 再覆写 → 最后一个好版本永久丢失。
**修复**：对齐 `state.js` 模式：主文件坏 → 尝试 `.bak`（成功则 log 一次并用之）；两者皆坏 → 把损坏现场另存 `config.json.corrupt`、log 告警、返回 DEFAULTS。`saveConfig` 仅当现有主文件可 parse 时才刷新 .bak。
**验收**：单测覆盖：主坏 bak 好 → 用 bak；均坏 → corrupt 文件生成 + DEFAULTS；save 不以坏主文件覆盖好 bak。

### RM3 state.js 保存时用未校验的主文件覆盖 .bak

**症状**：`host/src/state.js:19-21` 刷新 .bak 前不校验主文件可解析；坏主文件会污染好备份，若随后 rename 前崩溃 → 双份皆坏。
**修复**：仅当主文件 `JSON.parse` 成功才拷贝为 .bak；否则跳过刷新（保留旧好备份）。
**验收**：单测：主文件写入垃圾 → saveState 后 .bak 仍是旧的好内容。

### RM4 weather / usage-poll 的 fetch 无超时，拖死 tick 链

**症状**：`host/src/weather.js:28`、`host/src/usage-poll.mjs:41-49` 无 AbortSignal → 黑洞连接挂 tick 约 5 分钟（帧冻结、按键无响应），违背 usage.js:97-99 写明的设计意图。
**修复**：两处 `signal: AbortSignal.timeout(10_000)`；超时走既有 degraded/last-known 路径。
**验收**：单测：注入永不 resolve 的 fetch → 10s 内返回 degraded 结果（fake timer）。

### RM5 两个进程用同一个 tmp 文件名写 cpb-usage.json

**症状**：`usage-poll.mjs:140-145` 与 `usage-bridge.mjs:39-41` 共用 `cpb-usage.json.tmp`，交错写可发布撕裂文件或 rename ENOENT。
**修复**：tmp 名加 `.${pid}.${随机}` 后缀；rename 保持原子替换语义。
**验收**：单测：两写者并发（模拟）→ 最终文件始终可 parse。

### RM6 重连与 close() 竞争复活已关闭 transport；断连不清 RX 缓冲

**症状**：`serial.js:233-254` `await openPort()` 后不复查 stopped → close 后仍 attachPort、泄漏句柄；断连不清 `rx` 与 `latestSensor` → 旧半帧残字节吞掉重连后首个 ACK、跨会话返回陈旧传感器读数。
**修复**：openPort resolve 后 `if (stopped) { nextPort.close(); return; }`；`handleDisconnect` 中 `rx = 空` 且 `latestSensor = null`。
**验收**：单测：close 与 reconnect 竞争 → 无新端口存活；断连重连后首帧 ACK 正常解析、getSensor 返回 null 直到新上报。

### RM8 协议无版本/能力握手（HELLO 死定义）

**症状**：`proto.js:7` 定义 `T.HELLO(0x81)` 两端均未实现；host 与旧固件配对时 cry id 表漂移完全不可检测（固件按 SND_COUNT 静默拒绝，host 还会重连重放 lastActiveCry）。
**修复**：固件 boot 完成后发送 `HELLO{proto_ver:u8, snd_count:u8}`（fire-and-forget，可重发一次）；host 收到后记录并校验：proto_ver 不匹配 → log 告警 + 面板 degraded 标记；snd_count < host 侧物种叫声 id 上限 → log 一次。host 对"从未收到 HELLO 的旧固件"完全兼容（仅少校验）。
**验收**：host 单测：注入 HELLO 帧 → 状态可查询；不匹配 → 告警一次不刷屏。固件侧以 build + 协议对拍脚本验证。

### RM9 全屏帧重传风暴（固定 250ms 超时 vs 固件阻塞刷屏）

**症状**：固件在 rx_task 内同步解码+刷屏期间不读 4KB 驱动缓冲；30KB 全屏帧超 250ms 未 ACK → host 整帧重发 → 溢出丢字节 → CRC 失败 → 再超时。正确性靠 diff 自愈但退化为重传风暴。
**修复**（双侧）：host `serial.js` 超时按 payload 缩放：`timeoutMs = max(250, 150 + ceil(len/16))`（30KB ≈ 2s）；固件对重复 seq 的 FRAME 去重（解析成功但 seq==上次已 ACK 的 seq → 直接重发 ACK 不重刷屏）。
**验收**：host 单测：30KB 帧超时 ≥2s 才重传；固件对拍：同 seq 两次 → 两次 ACK、一次刷屏（以计数桩/日志验证，build 门禁）。

### RM10 codec 故障导致整机 abort 重启环

**症状**：`firmware/components/port_bsp/codec_bsp.cpp:15-17` `ESP_ERROR_CHECK`+assert：ES8311 故障 → 看门狗重启循环，屏/键/串口全部陪葬，与 main.cpp"rx+button 不受 I2C 影响"的意图矛盾。
**修复**：初始化失败 → log 错误、`playback_=nullptr` 静音降级；`play_sound` 沿用既有 null 防护。
**验收**：build 通过 + 代码路径审查（无硬件注错手段，以 review 验收）。

### RM11 本地日期回退双记当日成长

**症状**：`host/src/pet/sim.js:23-31`：`today < pet.lastGrowthDay`（时区西移/NTP 回拨）时 sameDay/firstEver 均 false → creditedExp 归零 → 当日 token 全额重记（受日上限约束，至多多一级）。
**修复**：`pet.lastGrowthDay > today` 时按 sameDay 处理（沿用存储基线，不重置）。
**验收**：单测：lastGrowthDay=明天、today=今天 → expGain=0（基线保持）。

### RM12 quietHours / volume 是"设置了也没用"的设置

**症状**：两字段校验/持久化/渲染齐全但零消费者——凌晨 3 点照样整点报时（`index.js:267-270` 无条件 `playSound(SOUND.HOUR)`）；volume 从未下发设备（CONFIG payload 仅 1 字节 cry id）。
**修复**（经 codex R1 review 修订——固件在 KEY 单击时**本地**播放当前叫声（main.cpp:353），纯 host 声音门管不住它）：
1. host "声音门"：host 主动触发的 `playSound`（整点报时/进化音等）前检查 quietHours（跨午夜区间语义：`start > end` 表示跨夜）；免打扰期间静音但视觉照常。
2. 新增协议 `T.VOLUME(0x25)`（payload: `vol u8` 0-100，fire-and-forget，与 CONFIG 同语义）；host 在连接建立、设置变更时下发；**进入 quiet 区间边界时下发 `VOLUME 0`、退出时恢复配置音量**——以此覆盖固件本地 KEY 叫声的静音。固件映射到 ES8311 音量（Batch G 落地）。
3. 兼容性（已由 review 确认 main.cpp:196 对未知 type 静默丢弃）：host 先行发送 VOLUME 对旧固件无害；旧固件配对下 quietHours 仅约束 host 触发音（记入交付说明）。
**验收**：单测：quiet 区间内 tick 跨整点 → 不调 playSound；跨夜区间 23:00-07:00 在 06:59 静音、07:01 出声；进入/退出 quiet 边界 → transport 分别收到 VOLUME 0 / VOLUME 配置值；设置 volume → transport 收到 VOLUME 帧。固件侧 build + 对拍。

### RM13 `main({once:true})` 不关 transport，接真机时挂死不退出

**症状**：`index.js:278-280` once 分支写完 frame.png 直接 return，SerialPort 句柄保持事件循环存活。
**修复**：once 分支 return 前 `transport.close()`、dashboard/animator teardown。
**验收**：单测：once 模式 + fake 端口 → main() resolve 后无活跃句柄（close 被调用）。

---

## 3. Low

| # | 位置 | 症状 | 修复 | 验收 |
|---|---|---|---|---|
| RL1 | `render/layout.js:307-313` | 影子用灰 216 画，128 硬阈值后永不可见；MID 导入未用 | 改 50% 棋盘格 stipple（1-bit 可见），删未用导入 | 位图断言影子区有黑像素 |
| RL2 | `layout.js:461-464` | 5 心需 bond 200 但硬上限 180，满心不可达；layout.test:88 断言了不可能值 | 心数改 `bond/(softCap/5)`（36/心）；修正测试 | bond180=5 心；bond0=0 心 |
| RL3 | `render/onboarding.js:82-84` | chip 宽 83.5 → 半像素描边发虚 | x/w `Math.round` | 位图断言边框像素纯黑 |
| RL4 | `index.js:391-401` | onboarding 推帧期间按键丢失（单 resolver） | io 适配器内加小队列（上限 8，FIFO） | 推帧中连按 → 逐个被消费 |
| RL5 | `usage.js:66-67,84-85` | `daily.at(-1)` 当"今天"，零用量日显示昨日总额 | merge 时 `todayPeriod !== today` → today 字段置 0 | 单测：昨日数据 → today$=0 |
| RL6 | `index.js:251`、`transport/index.js:16` | pollUsage 失败原因被吞（OAuth 失效不可见）；mock 回落无日志 | 失败 reason 变化时 log 一次；mock 回落 log 一次 | 单测：注入失败 → console 恰一条 |
| RL7 | host `serial.js:361-366` + `:187` | BUTTON 帧无 payload 长度守卫；且 handleFrame 对解析结果**无条件 emit**（parseButton 返 null 仍会发事件） | parseButton `payload.length < 2 → null`，且 handleFrame 对 null 解析结果跳过 emit（sensor 路径一并核对） | 单测：len=0 BUTTON 帧 → 零事件发出 |
| RL8 | `main.cpp:138` | `usb_serial_jtag_write_bytes` 返回值忽略 → 半帧截断 | 写不完整 → 丢整帧 + 计数日志 | build + review |
| RL9 | `main.cpp:196-197` + `serial.js:182-185` | 非法 FRAME 静默丢弃 → host 对必败 payload 全额重试；host NACK 分支绕过 maxRetries | 固件语义拒绝时发 NACK；host NACK 计入重试上限 | 单测：NACK×maxRetries → 放弃；对拍：越界矩形 → NACK |
| RL10 | `proto.js:49-51` | encodeFrame 不校验 len≤0xFFFF（距上限仅 8B 余量） | 超限 throw | 单测：65536B → throw |
| RL11 | `port_bsp/shtc3.cpp:60` | 测量命令失败早退不回 sleep（功耗+自热漂移） | 早退路径补 CMD_SLEEP | build + review |
| RL12 | `port_bsp/display_bsp.h:33` + `.cpp:373-484` | LUT 维度硬编码 [300]（竖屏路径潜伏错位）；110 行 `#if 0` 死代码 | 删死代码；LUT 维度断言/注释固定横屏（不做竖屏支持，YAGNI） | build |
| RL13 | `web/public/app.js:2` | 精灵图走 raw.githubusercontent，断网全裂图 | server 加 `/sprites/:id` 路由代理本地资产（精确白名单，无路径拼接） | 单测：已知 id→200，未知→404 |
| RL14 | `app.js:328-332,178`、`index.js:337` | quietHours 单边填写静默丢弃；name 无法清空；box 容量恒 100%；首 tick 用 DEFAULT_WEATHER 不带 degraded | 单边填写给校验提示；name 空串显式重置；容量分母改真实 box 上限；首 tick weather 标 degraded | jsdom 冒烟（Batch I）+ viewmodel 单测 |
| RL15 | `state.js:65-85` | salvage 丢 iv/nature/characteristic/stone → 重建后性格重掷 | salvage 白名单补齐（带类型校验） | 单测：损坏重建 → 三元组保留 |
| RL16 | `weather.js:37` | degraded 回退不校验 lastKey==key → 改经纬度后失败回退旧城市数据喂进化上下文 | 回退要求 key 匹配，否则 null-weather 形状 | 单测：改 key+失败 → 无旧数据 |
| RL17 | `web/server.js:98-101` | >16KB 先 reject 再 destroy → 400 到不了客户端 | 先答 413 + end 再断流 | 单测：17KB body → 收到 413 |
| RL18 | `sim.js:23-29` | 不传 today 时每次调用全额重记（API foot-gun，sim.test 还在用） | 缺 today → throw；修正误用测试 | 单测：无 today → throw |
| RL19 | `render/frame.js:12-14` | imageDataToFrame 硬编码 W×H，尺寸不符静默错读 | 断言 image.width/height 匹配，否则 throw | 单测：错尺寸 → throw |

## 4. 设计重构（Batch I，全部为行为不变重构 + 测试补强）

| # | 内容 | 动机 |
|---|---|---|
| RD1 | `index.js` 瘦身：~60 行 dashboard view 组装函数（:498-561）下沉 `web/viewmodel.js`；`ensurePet/evolutionContext/evolvePet/careCount` 等宠物状态机转移逻辑移入 `pet/`（新模块 `pet/transitions.js`） | 进化死锁没被发现，正因转移逻辑不在 pet/；index.js 580 行承担编排+view+游戏引擎+CLI 四职 |
| RD2 | `layout.js` 抽两模块：sprite 光栅管线（drawSprite/px/line，被 evolution-anim/onboarding 复制引用）→ `render/sprite-pipeline.js`；文本/格式化（layoutText/formatReset/money）→ `render/format.js`；两份 placeholder-sprite 实现（layout.js:257 vs sprites.js:35）合一 | 四个抽象高度混在 581 行里；跨文件复制已发生 |
| RD3 | 物种中文名三源（species-meta.js / species-cries.json.zh / onboarding-data.js）一致性测试 | 漂移无检测 |
| RD4 | 测试补强：`app.js` jsdom 冒烟（buildSettingsBody/renderSettings 焦点守卫）；server 错误路径（坏 JSON/413/404/frame.png 缺失）；`saveConfig` 原子性/.bak/损坏行为 | M3/M10/L1 恰都修在 app.js 层而它零覆盖 |
| RD5 | `settlement` 护盾发放闭环：streak 达 7 的倍数时 +1 shield（上限 2），消耗逻辑已存在（settlement.js:21-22） | shield 是"表全流不通"家族成员；设计规格 §7 "streak 有护盾" |
| RD6 | `PARAMS.dailyBondCap`(6) 死参数：`min(6, bondPerActiveDay=4)` 恒 4 | 要么删除，要么改为真实语义（特殊喂养日 bond 可超 4）——本轮**删除**（YAGNI） |

## 5. 批次划分与门禁

| 批次 | 内容 | 门禁 |
|---|---|---|
| A | RH2 + RM6 + RM9(host 侧) + RL10 | `cd host && node --test` |
| B | RH3（含原 RM7） | 同上 |
| C | RH1 + RL15 + RD5 | 同上 |
| D | RM1 + RM2 + RM3 + RL17 | 同上 |
| E | RM4 + RM5 + RM11 + RL5 + RL6 + RL16 + RL18 | 同上 |
| F | RM12(host 侧，VOLUME 发送依 §0 例外先行) + RM13 | 同上 |
| G | RM8 + RM9(fw) + RM10 + RM12(fw VOLUME) + RL7 + RL8 + RL9 + RL11 + RL12 | `source ~/esp/esp-idf/export.sh && cd firmware && idf.py build` + host 全量测试 |
| H | RL1 + RL2 + RL3 + RL4 + RL13 + RL14 + RL19 | host 全量测试 |
| I | RD1 + RD2 + RD3 + RD4 + RD6 | host 全量测试（重构前后测试数不减） |

顺序 A→I 串行派发；每批 codex 实施 → PM code review → PM 亲跑门禁 → 提交。批间无文件冲突设计：A/B/C 虽都碰 index.js 但区域不同，串行执行天然无冲突。

## 6. 明确不做（YAGNI）

- 不做竖屏 LUT 支持（设备固定横屏）。
- 不做实时 PCM 流、不改 stop-and-wait 可靠性模型（吞吐足够，简单性优先）。
- 不做 dashboard 鉴权/HTTPS（127.0.0.1 绑定 + Host 校验对本地礼物设备成比例）。
- 不拆 layout.js 的 ~60 个手绘坐标为配置（固定 e-ink 版面，常量表即可）。
