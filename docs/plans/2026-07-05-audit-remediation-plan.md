# 2026-07 只读审计整改实施 PLAN（Batch 1–6 + PRE-1）

> 状态：Draft v2 · codex plan R1 已吸收（3 High：Batch1 补 `web-app.test.js` / Batch5 落实 `sim.test.js` / Batch6 补 `main-orchestration.test.js`；2 M/L：AR5 的 index.js、AR4 的 viewmodel.js 标"仅按需"）· 待 codex plan R2。日期：2026-07-05。
> 上游：`docs/plans/2026-07-05-audit-remediation-spec.md`（AR1..AR7 定义、验收标准、修复方向均以 SPEC v2 为准，本文不重复，只列派发要点与实施顺序）。SPEC 已过 codex R2（PASS）。
> 执行模型：PM(Claude) 派发 codex 子代理逐批实施；PM 逐批 code review + 亲跑门禁；每批一个 commit。

## 0. 全局约定

- **worktree**：`/Users/zeus/Projects/claude-pokemon-buddy/.claude/worktrees/nervous-lamport-950022`，分支 `claude/nervous-lamport-950022`。所有派发在任务内容顶部带 **CWD LOCK** 块（禁止省略）。
- **host 门禁**（每批必跑，codex 报告前自跑 + PM 亲跑复核）：`cd host && node --test --test-concurrency=4 test/*.test.js`。
  - **并发锁 4 为硬性**：默认并发下 `@napi-rs/canvas` 原生库有退出期竞争假红（历史多轮实测），必须锁 4。
  - `scripts/play-test.js` 的「Cannot lock port」为已知环境项，**不入门禁**（环境失败非回归）。
  - **基线**：PM 已亲跑，**N0 = 342 tests / 342 pass / 0 fail**（54 个 test 文件；首次偶发 canvas 退出期假红，复跑即净——门禁遇单次假红复跑一次）；此后每批门禁须 **≥ N0 + 本批新增**，且无既有用例转红（除 SPEC 明确要求重写语义的用例）。
- **提交规范**：`fix|feat|refactor|test(scope): 摘要 (AR编号)`；每批一 commit，codex 提交，PM review 后如需修正由 codex 在同批返工（**≤2 轮，仅 Blocker/High 回改**；Medium/Low 记 `docs/plans/BACKLOG.md`）。
- **测试原则**：每个 AR 项 ≥1 个需求驱动新测试（SPEC 已列验收，覆盖 happy/边界/错误/状态迁移）；不得净删测试；SPEC 要求重写语义的既有用例**重写为新需求断言，而非删除**。
- **禁止改动**（default-forbid，除各批白名单）：`docs/`（除 `docs/plans/BACKLOG.md`）、`demo/`、`mockups/`、`firmware/`（本轮纯 host，AR7 已入 BACKLOG）、`firmware/components/`（vendored）、`host/package*.json`、`host/seed/`、锁文件、快照、夹具（除各批白名单明列的测试夹具）。
- **状态 schema 一致性**：任何 `salvageState`/`isValidState`/`normalizePet` 变更（AR1）必须快路径与救援路径两处同步，且与 `ensurePet`/`stripTransient` 语义一致。

### 派发单模板（每批任务内容必含，缺一不可）

```
## Working Directory Lock (mandatory)
WORKDIR = <worktree 绝对路径>
（规则 1-5：绝对路径、pwd 校验、禁 cd 出 WORKDIR、越界即 abort、$CODEAGENT_WORKDIR 自检）

## Goal（一句话）
<本批要达成的行为变更>

## Files allowed（可创建/修改，唯一白名单）
<精确路径列表>

## Files forbidden（默认禁改一切白名单外文件）
docs/(除 BACKLOG.md)、demo/、mockups/、firmware/、host/package*.json、host/seed/、其余源文件

## Context to read
@docs/plans/2026-07-05-audit-remediation-spec.md（对应 AR 条目的【问题】【修复】【验收】）
@<本批涉及的现有源文件>

## Verification（报告前必须自跑并贴输出）
cd host && node --test --test-concurrency=4 test/*.test.js

## Expected report（结构化、紧凑）
- 每 AR 项：实现状态 + 新增测试类名/条数（green/red）+ 与 SPEC 的偏差（如有）
- 门禁结果：绿/红计数（对比基线 N0）
- commit hash
- 无长篇叙述
```

## 1. 批次派发单（按 codex 优先级排序；触碰 `index.js` 的批次串行，避免合并冲突）

> 顺序依 SPEC「落地顺序」：**AR4（唯一正常玩法可达）→ AR1/AR2（坏输入硬化）→ AR3/AR5/AR6（低风险独立项）**。Batch 1/5/6 均改 `index.js`，故整体串行、逐批一 commit。

### Batch 1 — AR4 进化候选对账 + 202 事务（最高优先）
- **Goal**：`pendingCandidates` 收窄为"仅多候选选择提示态"；看板按钮以 `ready` 门控；choose/stone 走实时校验 + 202 queued + state-change 确认；保留 eevee 持石与单线回归。
- **文件白名单**：`host/src/pet/transitions.js`、`host/src/index.js`、`host/src/web/server.js`、`host/src/web/public/app.js`、`host/src/web/viewmodel.js`（**仅按需**——`viewmodel.js:16-20` 现已暴露 `nextEvo.ready`，通常无需改）、`host/test/{evolution-trigger,evolution,web-integration,web-app}.test.js`、可新建 `host/test/evolution-lapse.test.js`。（`web-app.test.js` 覆盖 `app.js` 的 `nextEvo.ready` 门控 + 202「queued，待 `/api/state` 变化才确认」客户端行为；`settings.js` 无需改。）
- **批内顺序**：(1) `transitions.js` 候选语义收窄（`!auto && candidates.length>1` 才设，其余 strip）→ (2) `server.js`/`index.js` choose/stone 端点实时 `resolveEvolution` 校验 + 400/202 + 石头对当前物种匹配校验 + 惰性石头 tick 清理 → (3) `viewmodel.js` 暴露 `ready` → (4) `app.js` 按钮 `nextEvo.ready` 门控 + 202/state-change 确认。
- **风险点**：`evolution-trigger.test.js` 中「KEY stores pending candidates」类断言随语义变化**重写**（多候选才设、单候选/auto 不设）；**妙蛙线单线进化回归用例保持不动**；202 语义变更需同步 `web-integration.test.js` 的状态码断言（原 200 → 202）。

### Batch 2 — AR1 状态字段级校验 + daysBetween 上界
- **Goal**：`loadState` 快路径与救援路径统一归一化/钳制；`lastSettled` 语义日期校验（UTC 解析+round-trip）；`daysBetween` 先算天数再截、不物化 73.9 万数组。
- **文件白名单**：`host/src/state.js`、`host/src/pet/settlement.js`、`host/test/{state,settlement}.test.js`、可新建 `host/test/state-normalize.test.js`。
- **批内顺序**：(1) `settlement.js` `daysBetween` 上界保护 → (2) `state.js` 新增 `normalizePet`（两处调用）+ `copyNumber` 按字段范围守卫 + `lastSettled` round-trip 校验。
- **风险点**：`normalizePet` 不得误伤合法值（既有 `state.test.js` 合法救援用例须全绿）；round-trip 校验对 `2026-99-99`/`2026-02-30` 均须拒（SPEC 已实证）；钳制范围与 `sim.js`/`ensurePet` 默认一致。

### Batch 3 — AR2 rate-limits 整体防御
- **Goal**：`loadRateLimits` 对中毒/畸形 `cpb-usage.json`（`null`/原始值/数组/越界 reset epoch）一律返回 stale 全空形状而非抛错。
- **文件白名单**：`host/src/rate-limits.js`、`host/test/rate-limits.test.js`。
- **批内顺序**：(1) `data` 对象形状守卫 + 后解析归一整体纳入防御 → (2) `epochToIso` 范围守卫（`Math.abs(sec) < 8.64e12`）。
- **风险点**：既有正常 reset 断言不变；返回形状须与 file-missing 分支一致（字段名/类型对齐消费端 `mergeUsage`）。

### Batch 4 — AR3 weather 类型守卫
- **Goal**：`rounded` 先判类型再 `Math.round`（`null`→degrade 而非 0）；`normalizeWeather` 索引 `daily.*[0]` 前加数组守卫。
- **文件白名单**：`host/src/weather.js`、`host/test/weather.test.js`。
- **风险点**：既有合法响应断言不变；确认无合法调用方依赖"非数字→0"的旧行为（审计已核：唯一消费 `index.js:561-564` 的 `temp==null` 守卫不拦 0，改为整体 degrade 更严格且安全）。

### Batch 5 — AR5 deriveMood 忽略 stale
- **Goal**：rate 数据 stale 时 `deriveMood` 按未知 utilization 返回中性 `"focused"`，不置空 UI stale 展示值。
- **文件白名单**：`host/src/pet/sim.js`、`host/test/sim.test.js`（deriveMood 断言所在，`sim.test.js:3-20`）、`host/src/index.js`（**仅按需**——`index.js:46-55` 已把 `rateStale` 挂入 usage、`:192` 已传整个 usage 对象给 `deriveMood`；若 `deriveMood({rateStale})` 对象兼容实现则 index.js **无需改**）、可新建 `host/test/mood-stale.test.js`。
- **批内顺序**：(1) `deriveMood` 增 `rateStale` 入参（从其对象参数解构读取）、stale→中性 `"focused"`。**注**：两个调用点（`index.js:192 deriveMood(usage)`、`viewmodel.js:83 deriveMood(dashboardUsage(...))`，后者 spread `...usage` 保留 `rateStale`）已传含 `rateStale` 的对象，故通常无需改调用点。
- **风险点**：`rate-limits.test.js` 的 stale 断言不动（p5h 仍返回、仅情绪逻辑变）；viewmodel 不改（UI 仍展示 stale 旧值）。

### Batch 6 — AR6 可观测性
- **Goal**：animator 循环有界节流告警（首次 + 每 30 次连续失败、成功清零）；`loadUsageSnapshot` 返回 `reason` 并按转变节流记一次。
- **文件白名单**：`host/src/render/buddy-animator.js`、`host/src/usage.js`、`host/src/index.js`、`host/test/{buddy-animator,usage,main-orchestration}.test.js`。（`main-orchestration.test.js:124-174` 已有同构 reason-transition 告警测试，AR6 的 `loadUsageSnapshot` reason 日志在此加断言。）
- **批内顺序**：(1) `buddy-animator.js` 增 `logger` 注入 + 连续失败计数 + `start()` 的 `loop().catch` 记录 → (2) `usage.js` catch 返回 `{ok:false, reason}` → (3) `index.js` 经 `logFailureReasonTransition`（或同构）按转变记一次。
- **风险点**：happy path 不得新增噪声日志；节流断言按 SPEC（60 帧 → 1..3 条）；`usage.js` 签名增 logger/reason 不得破坏既有 `usage.test.js` 返回形状断言。

### PRE-1 — 时区问题调查（并行、非阻塞、**不改代码**）
- **Goal**：确认真实 ccusage 的 `daily.period` 分桶时区（本地 vs UTC）。
- **动作**：查 ccusage 文档/源；若可，在受控环境对比 UTC 午夜前后写入的用量落在哪一 `period`。**产出结论写入 `docs/plans/BACKLOG.md`**（唯一允许写的 docs 文件）；若证实 UTC 分桶 → 另立条目，本轮不静默改任何 settlement/usage 时区行为。
- **文件白名单**：`docs/plans/BACKLOG.md`（仅追加结论）。
- **风险点**：**在证实前禁止改 `daysBetween`/`settlement`/`usage` 的时区行为**（`daysBetween` 本身已证正确、DST 安全）。

## 2. 收尾门禁与 DoD

1. 每批：codex 实现 + 自跑门禁 → PM review diff → PM 亲跑 `cd host && node --test --test-concurrency=4 test/*.test.js` → 绿则并入（一 commit）。
2. 全部 6 批完成后，PM 亲跑**全量回归**一次，确认 ≥ 基线 + 各批新增、无既有用例意外转红。
3. Batch 1..6 全部按 SPEC 验收标准通过（含需求驱动新测试）；PRE-1 结论落 BACKLOG。
4. AR7 及 OPT/MNT/N 保留 BACKLOG，交付说明标注已知残留。
5. 更新交付报告：标注已修复项、残留项、PRE-1 结论。
