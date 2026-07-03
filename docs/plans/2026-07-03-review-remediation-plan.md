# 2026-07 审查修复实施 PLAN（Batch A–I）

> 状态：Draft v2 · SPEC 已过 R2；PLAN R1 findings（2H/2M/1L：Batch A 补 index.js 白名单、Batch G 补协议对拍门禁、Batch H 补 settings.js、RM1 入口层实现+evolution 端点断言、模板禁省略 LOCK）已全部吸收。待 PLAN R2。日期：2026-07-04。
> 上游：`docs/plans/2026-07-03-review-remediation-spec.md`（R 系列定义、验收标准、批次划分均以 SPEC 为准，本文不重复）。
> 执行模型：PM(Claude) 派发 codex 子代理逐批实施；PM 逐批 code review + 亲跑门禁；每批一个 commit。

## 0. 全局约定

- **worktree**：`/Users/zeus/Projects/claude-pokemon-buddy/.claude/worktrees/trusting-proskuriakova-cbc9a8`，分支 `claude/trusting-proskuriakova-cbc9a8`。所有派发带 CWD LOCK。
- **host 门禁**（每批必跑，PM 亲跑）：`cd host && node --test --test-concurrency=4 test/*.test.js`——基线 **265/265 绿**（2026-07-03 实测两次稳定；默认并发下 canvas 原生库有退出期竞争假红，故锁并发 4；`scripts/play-test.js` 端口锁失败为已知环境项，不入门禁）。
- **固件门禁**（Batch G）：`source ~/esp/esp-idf/export.sh && cd firmware && idf.py build`（基线可构建性在派发前已由 PM 验证）。
- **提交规范**：延续冲刺风格 `fix|feat|refactor|test(scope): 摘要 (R编号)`；每批一 commit，codex 提交，PM review 后如需修正由 codex 在同批返工（≤2 轮，仅 Blocker/High 回改；Medium/Low 记 BACKLOG.md）。
- **测试原则**：每个 R 项 ≥1 个需求驱动测试（SPEC 已列验收）；重构批(I)测试数不得减少。
- **禁止**：改动 `docs/`（除 BACKLOG.md）、`demo/`、`mockups/`、`managed_components/`、`components/codec_board/`（vendored，SPEC 未涉及）。

## 1. 批次派发单

> 每批的【目标/文件白名单/验收】详见 SPEC §1-§4 对应条目与 §5 批次表；此处只列派发要点与批内实施顺序。

### Batch A — transport 生命周期（RH2 · RM6 · RM9-host · RL10）
- 文件白名单：`host/src/transport/serial.js`、`host/src/transport/proto.js`、`host/src/index.js`（**仅** RH2 要求的 stop()/loop-sleep 结算路径，index.js:230/:311 一带）、`host/test/serial.test.js`、`host/test/proto.test.js`、`host/test/main-orchestration.test.js`（stop 场景断言）、可新建 `host/test/serial-lifecycle.test.js`。
- 批内顺序：RH2（close 结算 pending）→ RM6（reconnect 竞争 + rx/latestSensor 清理）→ RM9-host（超时按 payload 缩放）→ RL10（encodeFrame 长度断言）。
- 风险点：RM9 缩放不得让既有 250ms 语义的测试假红——先跑 `serial.test.js` 定位依赖固定超时的用例并同步修正其构造参数。

### Batch B — 按键单一分发器（RH3，含原 RM7）
- 文件白名单：`host/src/index.js`、`host/test/main-orchestration.test.js`、`host/test/signature-trigger.test.js`、`host/test/evolution-trigger.test.js`（受影响断言同步修正）、可新建 `host/test/button-queue.test.js`。
- 批内顺序：先引入单一常驻分发器（到达时 exactly-once 路由：非 readyToEvolve 短按 → 立即签名路径；进化/care/双击 → tick 队列）→ 删除 runOneTick 的瞬时订阅、改消费快照 + try/finally → drain 调用方（runTickLoop 侧）实现失败重入队（一次机会，`requeued` 标记）。签名动画保持即时响应（SPEC v2 修订）。
- 风险点：onboarding 的 `makeOnboardingIo` 有独立按键订阅——本批不动它（RL4 在 Batch H），但需验证两者不互踩（onboarding 运行期间 tick 循环尚未启动，天然隔离；测试确认）。

### Batch C — 进化闭环（RH1 · RL15 · RD5 护盾）
- 文件白名单：`host/src/pet/evolution.js`、`host/src/pet/settlement.js`、`host/src/index.js`、`host/src/state.js`、`host/src/web/server.js`、`host/src/web/viewmodel.js`、`host/src/web/settings.js`（如需）、`host/src/web/public/app.js`（选择按钮 UI）、对应测试文件。
- 批内顺序：决选规则（evolution.js：stone→care(prio1)→单候选→多候选落 pendingCandidates，SPEC v2 §RH1）→ care 衰减（settlement.js）→ choose/stone 端点走**intent 内存队列**（编排层注入，tick 的 load→save 周期内消费，端点不直写 state）→ salvage 白名单补齐（state.js）→ 护盾发放（settlement.js）。
- 风险点：`evolution-trigger.test.js` 中「KEY stores pending candidates」等断言将随语义变化重写——**重写为新需求断言而非删除**；确保妙蛙线单线进化回归用例保持不动。

### Batch D — Web 安全与配置健壮性（RM1 · RM2 · RM3 · RL17）
- 文件白名单：`host/src/web/server.js`、`host/src/config.js`、`host/src/state.js`、对应测试。
- 风险点：Host 校验必须放行 `127.0.0.1:任意配置端口`（端口从启动参数取，不硬编码 8765）；web-integration.test.js 的请求需带合法 Host/content-type——同步修正测试夹具。**RM1 的 Host/content-type 检查必须实现在请求入口层（路由分发之前），使 Batch C 新增的 `/api/evolution/choose`、`/api/evolution/stone` 及未来一切路由自动被覆盖**；本批测试需对 evolution 端点也各加一条 403/415 断言（C 批在前，端点已存在）。

### Batch E — 网络与数据管道（RM4 · RM5 · RM11 · RL5 · RL6 · RL16 · RL18）
- 文件白名单：`host/src/weather.js`、`host/src/usage-poll.mjs`、`host/src/usage-bridge.mjs`、`host/src/usage.js`、`host/src/pet/sim.js`、`host/src/transport/index.js`、`host/src/index.js`（RL6 日志）、对应测试。
- 风险点：`sim.test.js` 有依赖「不传 today」的既有用例（RL18 改为 throw 后需重写）；AbortSignal.timeout 在 fake-timer 测试里的行为需用注入式 signal 工厂绕开。

### Batch F — 设置生效 + 生命周期（RM12-host · RM13）
- 文件白名单：`host/src/index.js`、`host/src/transport/proto.js`（T.VOLUME 定义）、`host/src/transport/serial.js`/`mock.js`（sendVolume）、`host/src/transport/index.js`、对应测试。
- 风险点：quietHours 跨午夜语义（start>end）要与 settings.js 校验语义一致；quiet 边界需下发 VOLUME 0 / 恢复音量（覆盖固件本地 KEY 叫声，SPEC v2 §RM12）；host-first 无害性已确认（main.cpp:196 静默丢弃未知 type，SPEC §0 例外）。

### Batch G — 固件批（RM8 · RM9-fw · RM10 · RM12-fw · RL7 · RL8 · RL9 · RL11 · RL12）
- 文件白名单：`firmware/main/main.cpp`、`firmware/components/port_bsp/codec_bsp.cpp`、`firmware/components/port_bsp/shtc3.cpp`、`firmware/components/port_bsp/display_bsp.{h,cpp}`、host 侧：`host/src/transport/proto.js`、`host/src/transport/serial.js`（HELLO 解析、NACK 计数、BUTTON 长度守卫）、对应 host 测试。
- 批内顺序：先纯固件项（RM10/RL8/RL11/RL12）→ 协议双侧项（RM8 HELLO → RM9-fw seq 去重 → RM12-fw VOLUME → RL9 NACK）→ host 侧解析与测试。
- 门禁：固件 build + host 全量测试 + **协议对拍测试**三者全过才算绿。对拍落地为新增 `host/test/proto-firmware-consistency.test.js`：从 `firmware/main/main.cpp` 文本抽取 `T_*` opcode、`SND_COUNT`、`MAX_INBOUND_PAYLOAD`、proto 版本号等常量，与 `host/src/transport/proto.js` 逐项断言一致（HELLO/VOLUME/NACK 新 opcode 两端同值、seq 去重语义的 host 侧行为单测）。固件侧运行时行为（重复 seq 单次刷屏、NACK 发送、VOLUME 生效）无法宿主机测试的部分：build + PM 人工 review 代码路径 + 列入连板冒烟清单（owner 手工，不阻塞本批但必须记录）。

### Batch H — 渲染/UI 打磨（RL1 · RL2 · RL3 · RL4 · RL13 · RL14 · RL19）
- 文件白名单：`host/src/render/layout.js`、`host/src/render/onboarding.js`、`host/src/render/frame.js`、`host/src/index.js`（RL4 io 队列、RL14 degraded 标记）、`host/src/web/server.js`（RL13 精灵路由）、`host/src/web/public/app.js`、`host/src/web/viewmodel.js`、`host/src/web/settings.js`（RL14 name 显式清空需放宽"空串=重置"语义，settings.js:14 现拒绝空名）、对应测试。
- 风险点：RL2 修正 layout.test.js:88 的不可能值断言时，按 SPEC 语义（36/心）重写；RL13 精灵路由必须白名单式（复用既有精确路由模式，禁路径拼接）。

### Batch I — 重构与测试补强（RD1 · RD2 · RD3 · RD4 · RD6）
- 文件白名单：`host/src/index.js`、`host/src/web/viewmodel.js`、新建 `host/src/pet/transitions.js`、新建 `host/src/render/sprite-pipeline.js`、新建 `host/src/render/format.js`、`host/src/render/layout.js`、`host/src/render/evolution-anim.js`、`host/src/render/onboarding.js`、`host/src/render/sprites.js`、`host/src/pet/sim.js`（RD6 删死参数）、测试全目录（新增 jsdom 冒烟需评估依赖——**若需引入 jsdom devDependency，先报 PM 批准；否则用轻量 DOM stub**）。
- 硬性要求：行为不变重构——重构前后 `node --test` 测试数只增不减、全绿；每个移动的函数保留原导出转发（或全量更新 import）二选一，禁止半迁移。

## 2. 派发模板（每批填充）

```
## Working Directory Lock (mandatory)
WORKDIR = /Users/zeus/Projects/claude-pokemon-buddy/.claude/worktrees/trusting-proskuriakova-cbc9a8
（**实际派发时必须逐字嵌入 codeagent skill 的完整五条 LOCK 规则，禁止省略**——本文档为免重复此处从略，但派发单不得从略）

## Task: Batch X 实施
Goal: <一句话>
Files allowed: <白名单>
Files forbidden: everything else（尤其 docs/ demo/ mockups/ codec_board/）
Context to read: @docs/plans/2026-07-03-review-remediation-spec.md 的 <R编号列表> + @<相关源文件>
步骤: <批内顺序>
Verification (must run before reporting):
  cd host && node --test --test-concurrency=4 test/*.test.js   # 期望全绿
  [Batch G 另加] source ~/esp/esp-idf/export.sh && cd firmware && idf.py build
Commit: 单 commit，message 规范见 PLAN §0；commit 后报告 hash。
Report format: 每 R 项状态(done/blocked+原因) + 测试计数(前→后) + commit hash + 与 SPEC 的偏差点（无则写"无偏差"）。禁止长叙述。
```

## 3. 时序与额度策略

- 串行派发 A→I；每批完成后 PM review（读 diff）→ 亲跑门禁 → 通过才派下一批。
- **codex 额度耗尽时**（wrapper 报 usage limit）：记录中断点（TaskList 状态即中断点），ScheduleWakeup 等恢复（本轮已知恢复点 2026-07-04 01:15），恢复后从中断批次继续，不重派已完成批次。
- review 回改：每批 ≤2 轮，仅 Blocker/High；Medium/Low 追加到 `docs/plans/BACKLOG.md`。
- 若某批 codex 产出无法通过门禁且 2 轮未解决：该批标记 blocked，跳过继续下一无依赖批次，最终报告列明。

## 4. 完成定义（DoD）

1. R/RD 全编号在 git log 可追溯（或在最终报告中标记 blocked/deferred + 原因）。
2. host 门禁 265+ 全绿（数量只增）；固件 `idf.py build` 通过。
3. PM 终检：逐 High 项人工复核 diff；抽查 Medium。
4. 输出中文总结：修复清单、测试增量、遗留 BACKLOG、连板冒烟清单（owner 手工项）。
