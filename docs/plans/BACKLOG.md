# BACKLOG（2026-07 审查修复冲刺遗留）

> 来源：R 系列修复冲刺（`2026-07-03-review-remediation-spec.md`）各批 PM review 中按约定不回改、记档的 Medium/Low 项，以及需要连板的手工验证清单。

## 代码遗留（Low）

1. **`collectStandaloneButtonSnapshot` 是误导性结构**（`host/src/index.js:496`）：订阅后立即在 finally 退订，实际恒返回空数组。行为无害（standalone/once 模式本就不消费 tick 间按键），但读者会误以为它在收集事件。建议直接返回 `[]` 并加注释说明 standalone 模式不收集按键。
2. **serial `timeoutMs` 注入语义变窄**（`host/src/transport/serial.js:344`）：Batch A 后 `retryTimeoutFor = max(DEFAULT_TIMEOUT_MS, timeoutMs, 150+ceil(len/16))`，注入低于 250ms 的值不再生效（只可调高不可调低）。当前无快超时用例，测试均用 mock timers，无实际影响；若未来需要可将下限改为 `min(timeoutMs, 250)` 语义。

## 连板冒烟清单（owner 手工，Batch G 产出）

- [ ] 上电后 host 收到 HELLO（proto_ver=1, snd_count），约 500ms 后收到第二次。
- [ ] 面板设 quietHours 进入静音窗后，设备本地 KEY 叫声静音（VOLUME 0 生效）；退出窗口后恢复。
- [ ] host 重发同 seq FRAME 时设备只回 ACK 不重刷屏（观察无闪烁）。
- [ ] 构造越界 rect / RLE mismatch → host 日志出现 NACK 且按重试上限放弃。
- [ ] 模拟 codec 故障（如断开 ES8311 总线）→ 屏幕/按键/串口仍正常，仅无声。
- [ ] SHTC3 测量失败路径与 USB short-write 需故障注入或长期日志观察。
- [ ] 进化闭环实机走查：长按关怀→bond 满→KEY 进化仙子伊布；面板 choose leafeon；面板给石头→KEY 进化水伊布。
