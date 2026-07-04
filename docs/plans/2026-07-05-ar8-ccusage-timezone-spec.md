# AR8 SPEC — ccusage 分桶时区与 host 本地日历对齐（PRE-1 证实项）

> 状态：Draft v1 · 待 codex 评审（spec+approach gate）。日期：2026-07-05。
> 上游：`2026-07-05-audit-remediation-spec.md` 的 PRE-1（调查已证实为真 bug，见 `BACKLOG.md`）。owner 已决定本轮修复。
> 分工：Claude 写 spec；codex 经 codeagent 实现；Claude PM 评审 + 亲跑门禁（`cd host && node --test --test-concurrency=4`，基线 363）。

## 1. 问题（已证实）

- `host/src/usage.js:7-8` 调 `npx --yes ccusage blocks/daily --json`，**未指定时区**。ccusage 的 `daily.period` **默认按 UTC 分桶**（Claude JSONL 时间戳带 `Z`，ccusage 默认用 UTC 组件提取日期；ryoppippi/ccusage issue #349「时区≠UTC 分组错误」、#778「statusline today 因 UTC 显示 \$0」）。
- host 侧 `today = localYmd(now)`（`usage.js:145-150`）为**本地**日历。
- 后果（非 UTC 用户，默认配置 Auckland UTC+12/+13）：
  - `normalizeUsage`：`todayPeriod = latest.period`（UTC 桶），`latestIsToday = todayPeriod === today`（本地）→ 跨日边界失配 → `todayTokens/todayCost` 误记 0 → `applyDailyGrowth` 当日 EXP/bond 少记或记错日。
  - `activeDays = daily[].period`（UTC 桶）与本地结算窗口比对 → 某本地活跃日被判非活跃（或反之）→ `streak`/`bond`/`shield` 衰减错误（`settlement.js`）。
- `daysBetween` 本身正确、DST 安全——**问题仅在 ccusage 分桶时区**，不动 settlement 逻辑。

## 2. 修复（向后兼容优先）

**核心**：让 ccusage 按 host **本地 IANA 时区**分桶，与 `localYmd` 对齐。

**手段选择（安全性排序）**：优先设**环境变量 `CCUSAGE_TIMEZONE`**（子进程 env），而非 `--timezone` flag——
- 旧版 ccusage 遇**未知 flag** 会非零退出 → `loadUsageSnapshot` catch → 用量降级（**回归**）。
- 旧版遇**未知环境变量**静默忽略 → 最坏退回现状（UTC 分桶，未修但**非回归**）。

**实现**：
1. `hostTimeZone()`：`Intl.DateTimeFormat().resolvedOptions().timeZone`（IANA，如 `"Pacific/Auckland"`），try/catch 失败或非字符串 → 返回 `null`。
2. `runCcusage(command, args, { timeoutMs = 60_000, timeZone } = {})`：spawn 时 `env: timeZone ? { ...process.env, CCUSAGE_TIMEZONE: timeZone } : process.env`（timeZone 为 null 时不改 env，等价现状）。
3. `loadUsageSnapshot({ run = runCcusage, today = localYmd(new Date()), timeZone = hostTimeZone() } = {})`：把 `timeZone` 作为**可注入选项**传入两次 `run(cmd, args, { timeZone })`。
   - 保持 `run` 现有签名兼容：`run(command, args, options)`；现有注入测试传的 `run` 为 2 参 mock，第三参可忽略——**不得破坏现有 usage.test.js 的注入形态**。
4. `today` 与 `timeZone` 必须同源：`localYmd(now)` 用本地日历，`CCUSAGE_TIMEZONE` 用本地 IANA tz——二者对同一物理时刻给出同一日历日（IANA tz 含 DST，正确）。

**不做**：不改 `settlement.js`/`daysBetween`；不改 `normalizeUsage` 的比较逻辑（对齐后 `todayPeriod === today` 自然成立）；不硬编码时区（从 Intl 取）。

## 3. 验收（需求驱动）

- **单测(env 透传)**：注入 `run` spy，调 `loadUsageSnapshot`；断言两次 `run` 均收到 `options.timeZone === hostTimeZone()`（或注入的 timeZone）。
- **单测(runCcusage env 装配)**：以可注入的 `spawn` mock 调 `runCcusage(cmd,args,{timeZone:"Pacific/Auckland"})`；断言 spawn 收到 `env.CCUSAGE_TIMEZONE === "Pacific/Auckland"`；`timeZone` 为 `null`/缺省 → env **不含** `CCUSAGE_TIMEZONE`（不改 env，退回现状）。
- **单测(边界对齐)**：注入 `run` 返回 `daily` 的 `latest.period` 等于注入的本地 `today` → `latestIsToday` 真、`todayTokens` 计入；`period` 为前一 UTC 日而 `today` 为本地当日的旧失配场景，在传入本地 tz 后由对齐消除（用注入数据模拟对齐后的 period）。
- **回归**：现有 `usage.test.js`（注入式 run/today）全绿；`hostTimeZone()` 返回 null 时行为等价现状。

## 4. 派发与门禁

- **文件白名单**：`host/src/usage.js`、`host/test/usage.test.js`。
- **禁改**：其余一切（尤其 `settlement.js`/`sim.js`/`index.js`——本项不动结算/成长）。
- **门禁**：`cd host && node --test --test-concurrency=4 test/*.test.js` ≥ 363 + 新增、0 fail、无既有回归。
- **commit**：`fix(usage): align ccusage bucketing to host local timezone (AR8/PRE-1)`。

## 5. 待 codex 评审确认的假设/风险

1. **`CCUSAGE_TIMEZONE` 环境变量名**是否准确（来源：ccusage 文档/issue 检索；codex 请核实 ccusage CLI 是否读取该 env，或应改用 `--timezone` flag / 配置文件）。若 env 名不对，退回现状（不修但非回归）——可接受，但请确认最可靠手段。
2. **`blocks` 子命令**是否也受时区影响（本 spec 对两个调用都设 env，无害）；`active` block 检测是否时区无关。
3. 旧版 ccusage 对未知 env 是否确为静默忽略（向后兼容前提）。
4. `Intl...resolvedOptions().timeZone` 在目标运行环境是否稳定返回 IANA tz。
