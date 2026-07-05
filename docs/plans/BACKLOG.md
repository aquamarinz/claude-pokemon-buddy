# BACKLOG（2026-07 审查修复冲刺遗留）

> 来源：R 系列修复冲刺（`2026-07-03-review-remediation-spec.md`）各批 PM review 中按约定不回改、记档的 Medium/Low 项，以及需要连板的手工验证清单。

## 代码遗留（Low）

1. **`collectStandaloneButtonSnapshot` 是误导性结构**（`host/src/index.js:496`）：订阅后立即在 finally 退订，实际恒返回空数组。行为无害（standalone/once 模式本就不消费 tick 间按键），但读者会误以为它在收集事件。建议直接返回 `[]` 并加注释说明 standalone 模式不收集按键。
2. **serial `timeoutMs` 注入语义变窄**（`host/src/transport/serial.js:344`）：Batch A 后 `retryTimeoutFor = max(DEFAULT_TIMEOUT_MS, timeoutMs, 150+ceil(len/16))`，注入低于 250ms 的值不再生效（只可调高不可调低）。当前无快超时用例，测试均用 mock timers，无实际影响；若未来需要可将下限改为 `min(timeoutMs, 250)` 语义。

## 2026-07 只读审计整改遗留（AR 系列，`2026-07-05-audit-remediation-spec.md`）

> P0 已落地并过门禁：AR4/AR1/AR2/AR3/AR5/AR6（commit cccaab1/db3c8c1/e932509/1610b48/cf6815a/71272b9）。以下为本轮明确不含、另立的项。

### PRE-1（**已修复** — AR8，commit `2a3bffd`，Medium）ccusage 默认 UTC 分桶 vs host 本地日历
> 状态：已落地。`usage.js` 现经 `CCUSAGE_TIMEZONE` env 把 ccusage 分桶对齐 host 本地 IANA 时区（`2026-07-05-ar8-ccusage-timezone-spec.md`），门禁 367/0。以下为原始记录。
- **结论**：调查证实 ccusage `daily`/`blocks` 的 `period` **默认按 UTC 分桶**（Claude JSONL 时间戳带 `Z`，ccusage 默认用 UTC 组件提取日期；参见 ryoppippi/ccusage issue #349「时区≠UTC 时分组错误」、#778「statusline today 因 UTC 显示 \$0」）。ccusage 提供 `--timezone <tz>` / `CCUSAGE_TIMEZONE` 覆盖，但**默认 UTC**。
- **缺陷**：`host/src/usage.js:7-8` 调 `npx --yes ccusage blocks/daily --json` **未传 `--timezone`**，而 `today = localYmd(now)`（`usage.js:145-150`）为**本地**。对非 UTC 用户（默认配置 Auckland UTC+12/+13）：跨日边界的 `todayTokens`（`latestIsToday = todayPeriod === today` 失配 → 成长少记/记错日，影响 `applyDailyGrowth`）与 `activeDays`（UTC 桶 vs 本地结算窗口失配 → `streak`/`bond`/`shield` 衰减错误）会 off-by-one。
- **注**：审计对抗验证曾以"两侧均本地"误驳此项（R6/R9/R10）；两模型均正确标注 Needs More Context。本调查推翻误驳、证实缺陷。`daysBetween` 本身仍正确（DST 安全）——问题在 ccusage 分桶时区，非 `daysBetween`。
- **修复方向（小而安全）**：`usage.js` 的两个 ccusage 调用显式传 `--timezone <host 本地时区>`（如 `Intl.DateTimeFormat().resolvedOptions().timeZone`），或设 `CCUSAGE_TIMEZONE`，使 ccusage 与 host `localYmd` 同为本地日历。需验收：注入受控时区 + 边界日的 `todayTokens`/`activeDays` 归属正确；旧 ccusage 版本无 `--timezone` 时的降级（未知 flag 行为）。

### AR7（Low，固件/协议）跨 host 重启 seq 去重 1/256 首帧丢失
- 固件 `last_acked_frame_seq` 跨 host 重启持久，host `nextSeq` 每进程归零 → 1/256 首帧被误判重传丢弃；buddy 区 ~333ms 恢复，但静态左栏保持陈旧至内容下次变化（≥60s）。
- 修复须先定 host→device RESET opcode 字节格式（proto.js + main.cpp 同步）、ack/fire-and-forget 语义、初连/重连相对首帧顺序（注意 `serial.js:285` reconnect 回调先于 `pump()`）。协议改动两端同批。

### 优化项（另立性能冲刺）
- **OPT-1（Medium）** animator 热路径：全帧 PNG 重编码 + 同步落盘 3×/s + 静态左栏重绘 + sprite 重阈值。加 bitmap-only 渲染路径；预览写异步/节流至 ≤1/tick；缓存左栏。**须保留 mock PNG 行为**（`index.js:487-492`）。
- **OPT-2（Medium，固件）** 每脏矩形整屏 15KB SPI 刷新（`main.cpp:219-227` + `display_bsp.cpp:191-203`）。窗口化 ST7305 刷新至脏矩形——**需硬件验证**。
- **OPT-3（Medium）** 每 tick 串行 `npx ccusage` ×2（`usage.js:3-16`）。Promise.all / 解析 binary 一次 / 解耦渲染节奏。
- **OPT-4（Low）** `diffRect` 全扫无早退、`bitAt` 重算 rowBytes（`diff.js:9-18,35-39`）。

### 可维护性 / Nit
- **MNT-2（Low，usage-poll）** `DEFAULT_VERSION="2.1.0"` UA 回退值随时间漂移，端点对旧 UA 可能 429（`usage-poll.mjs:10`）；且 `ccVersion` 每次未节流 poll 都 spawnSync `claude --version`（阻塞 ~百 ms）——可进程内缓存一次。另注：同机 CodexBar 轮询同一 `/api/oauth/usage` 端点,与 buddy 共享账号级限流配额,排查 429 时需一并考虑。
- **MNT-3（Low，测试）** `main-orchestration.test.js` 用 `sleep(500)` 竞速判定 settled,`--test-concurrency=4` 高负载下偶发 timeout 抖动（2026-07-05 全量跑复现一次,单跑稳定绿）。可改条件轮询替代固定竞速窗口。
- **MNT-1（Low）** 重复 helper：`volumeByte`×3（index.js:608 / transport/index.js:105 / serial.js:427）、`fsync*`/`isParseableJsonFile`×2（config.js:76-106 == state.js:123-153）、`localYmd`×2（index.js:585 / usage.js:145）。抽取须保留 **0..100 音量契约** 与 **fsync/rename 崩溃安全**。
- **N1（Nit）** onboarding 按键缓冲上限 8 静默丢弃（`index.js:538`）。
- **N2（Nit）** `weekTokens` 生产环境无消费者（死计算，`usage.js:63-65`；测试仍读）。

## 连板冒烟清单（owner 手工，Batch G 产出）

- [ ] 上电后 host 收到 HELLO（proto_ver=1, snd_count），约 500ms 后收到第二次。
- [ ] 面板设 quietHours 进入静音窗后，设备本地 KEY 叫声静音（VOLUME 0 生效）；退出窗口后恢复。
- [ ] host 重发同 seq FRAME 时设备只回 ACK 不重刷屏（观察无闪烁）。
- [ ] 构造越界 rect / RLE mismatch → host 日志出现 NACK 且按重试上限放弃。
- [ ] 模拟 codec 故障（如断开 ES8311 总线）→ 屏幕/按键/串口仍正常，仅无声。
- [ ] SHTC3 测量失败路径与 USB short-write 需故障注入或长期日志观察。
- [ ] 进化闭环实机走查：长按关怀→bond 满→KEY 进化仙子伊布；面板 choose leafeon；面板给石头→KEY 进化水伊布。
