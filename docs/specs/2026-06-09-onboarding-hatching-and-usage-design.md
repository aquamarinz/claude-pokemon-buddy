# 开局体验 v2 + usage 官方化 — 设计规格 (Design Spec)

> 状态：Design v1 · brainstorm 收尾 → writing-plans。日期：2026-06-09。
> 配套：原始设计 `docs/specs/2026-05-30-claude-pokemon-buddy-design.md`（**本 spec 是其增量修订**，未提及处沿用原 spec）。
> 触发：buddy 首次在 Mac 上试运行后，用户反馈 4 个问题。

## 1. 动机（试运行反馈 → 4 个根因）

| 反馈 | 根因（已查证） | 与原 spec 关系 |
|---|---|---|
| 没有正经 onboarding | 原 spec §7 设计了"首次开机选初始宝可梦"，但实现整段跳过，`ensurePet` 直接塞成品伊布 | **补回漏实现的设计** |
| 没有孵化过程 | 原 spec §2/§15 把"孵蛋"明确划到 v2，v1 开局是"选初始" | **修订**：把孵化提前到 v1 开局 |
| 亲密度不从 0 开始 | `ensurePet` 默认 `bond:120`（刻意，为 10 天进化节奏）；且当前存档 `_rebuilt:true/Lv7/bond129` 是 salvage 重建的开发残留 | **修订**：起点改 0 + 重置脏档 |
| Claude usage 错误 | `usage.js` 分子用含 cacheRead（占 93%）的 `totalTokens` ÷ 写死的 22 万预算 → 永远爆 100%；偏离原 spec §6"参考额度=滚动高水位/setup 预算" | **修复 bug**：改用官方 statusline `rate_limits` |

## 2. 范围 / 非目标

**范围**
- 孵化式 onboarding（设备屏闭环，4 选 1：伊布 + 初代御三家）。
- 亲密度从 0 起、约 2 周首次进化 + 脏档重置。
- usage 改用 Claude Code 官方 statusline `rate_limits`（官方 5h/周%）。

**非目标（不做）**
- 全 Pokédex / 孵蛋解锁更多宝可梦 → 仍 v2。
- 不动已稳定的渲染管线 / 串口协议 / dashboard 框架 / B1–B5 固件。
- 候选池就这 4 只，不扩。
- 不碰会被限流的 Anthropic OAuth usage 端点（走官方文档化的 statusline stdin）。

## 3. 对原始 spec 的修订点（差异表）

| 维度 | 原始 spec | v2 |
|---|---|---|
| onboarding 形态 | 选初始宝可梦（御三家时刻，无孵化） | **孵蛋 + 孵出时 4 选 1** |
| 孵化 | v2 功能 | **提前到 v1 开局仪式** |
| 候选池 | 伊布 + setup 选的固定 box | **伊布 + 初代御三家（妙蛙种子/小火龙/杰尼龟）** |
| bond 起点 | 120 | **0**（newborn） |
| 进化节奏 | 从 120 约 10 天 | **从 0 约 2 周首进化** |
| usage 来源 | ccusage `totalTokens` ÷ 固定预算 | **官方 statusline `rate_limits`** + ccusage 仅出 cost/token |
| 大木开场白 | v1.5 彩蛋 | **提前进首次孵化开场**（作为验 pipeline 的签名彩蛋） |

## 4. 孵化 onboarding（设备屏闭环）

**触发**：host 启动时若 `state.json` 无 `hatched:true` 标志 → 进 onboarding 状态机（替代现在的 `ensurePet` 直接产成品）。

**状态机（设备屏，KEY/BOOT 两键）**
1. **大木开场白**：逐字打字机式 1-bit 文本（"欢迎来到宝可梦世界…"），KEY 推进/跳过。
2. **选择**：屏上呈现一颗蛋 + 候选指示；KEY = 在 `伊布 / 妙蛙种子 / 小火龙 / 杰尼龟` 间循环切换，BOOT = 返回上一步。
3. **确认**：KEY 长按或二次 KEY 确认选中。
4. **孵化动画**：蛋摇晃 → 裂纹 → 裂开 → 孵出选中物种 + 孵化音（复用 B4/B5 的 PLAY 音 + 现有 1-bit 低帧动效管线）。
5. **命名**：给默认名（物种中文名，如"伊布"）；不在设备屏打字。
6. **落地**：写 `hatched:true` + `species` + `name` + 初始养成态 → 进日常养成。

**改名**：走 dashboard 已有的 settings（取名字段），非 onboarding 必经。

**送礼友好**：全程设备屏闭环，朋友插上 USB 即可完整体验，不强制打开网页。

## 5. 候选池 + 进化数据

- **伊布**：已有 8 向分支（`seed/evolution/eevee.json`，亲密 + RTC/温湿/care/石头），不改。
- **御三家**：各 3 段线性进化（妙蛙种子→妙蛙草→妙蛙花；小火龙→火恐龙→喷火龙；杰尼龟→卡咪龟→水箭龟），触发用**等级/累计用量阈值**（符合原 spec §7.2"其余宝可梦用更简单触发"）。
- **要 seed 的资产**：3 条御三家进化链 JSON（同 `eevee.json` schema）+ 灰度精灵（PokeAPI 源，已在 dashboard `app.js` 的 SPECIES 表登记 bulbasaur/charmander，需补杰尼龟/中后段 + 灰度抖动调校）+ 各物种简单"用法人格"映射。
- **进化引擎**：`resolveEvolution` 数据驱动、已支持任意物种，加御三家 = 加数据不改引擎逻辑。

## 6. 亲密度 + 进化节奏

- newborn 孵出 `bond=0`。
- **基调**：约 2 周首次进化——伊布看亲密度（阈值/日增重算）、御三家看等级（累计用量）；两轨节奏感对齐到"约 2 周"。
- **具体公式 + v0 数值表**（进化阈值、日增、软上限、每日结算时机）由 **plan 的平衡参数表产出**（沿用原 spec §17 约定），design 只定基调。
- 约束：调整 `PARAMS`（`evolveBond` / `bondPerActiveDay` / `dailyBondCap` 等）时，断更衰减（`settlement.js`）与之联动重校，保证"约 2 周"在正常用量下成立。

## 7. usage 官方%（statusline bridge）

**架构变化**：从"host 主动跑 ccusage 算%"改为"CC 把官方% 经 statusline 推给 bridge → 文件 → host 读"。

```
朋友用 Claude Code → CC 每次更新 spawn bridge 脚本 (stdin 喂 JSON)
   → bridge 提取 rate_limits → 原子写 usage.json
   → buddy host 读 usage.json 出官方 5h/周%
   → ccusage 仍跑，只出 today cost / token 明细
```

**bridge 脚本**（新增 Node 脚本，注册为 CC statusLine command）从 stdin JSON 取：
- `rate_limits.five_hour.used_percentage`（官方 5h%，0–100）+ `.resets_at`（epoch 秒）
- `rate_limits.seven_day.used_percentage`（官方 周%）+ `.resets_at`
- 落地写 `usage.json`（原子写）；statusline 本身也 print 一行（不破坏朋友看 statusline 的体验）。

**host usage 模块改造**：
- 5h%/周%/reset ← 读 `usage.json`（官方值）。
- today cost / today tokens ← 仍由 ccusage daily 出（那部分口径本就对）。
- **缺失/stale 兜底**：`rate_limits` 仅 Pro/Max 订阅者、会话首个 API 响应后才出现、`five_hour`/`seven_day` 可能各自缺失 → 一律 `?? null`，UI 显示"等待请求/--"而非炸成 0/100；`usage.json` 带写入时间戳，host 判 staleness。

**朋友 Windows 部署**：CC ≥ 2.1.80；`settings.json` 加 `statusLine` 指向 bridge 脚本（路径用正斜杠，避免 Git Bash 反斜杠转义）。由 gift-giver 预配。

**当前 Mac 试运行**：同样可配 statusLine（用本机 CC 的 rate_limits）即时验证官方%；注意不要覆盖用户现有 statusline（如 claude-hud）——plan 需处理"已有 statusline 共存/链式调用"。

## 8. 脏档重置 + 可重启幸存

- **脏档**：当前 Mac 上 `Lv7/bond129/_rebuilt` 开发残留 → onboarding 上线后**直接重置**，下次启动无 `hatched` 标志即触发孵化。
- **schemaVersion 升级**：新增 `hatched` / `name` / 选中 `species` 字段；老档（无 `hatched`）一律当未孵化处理。
- **onboarding 幂等**：`hatched:true` 持久化进 `state.json`（原子写，沿用 §9）；reboot / 设备重插 / host 重启**不重复孵化**。
- **维护后门**（原 spec §17）：gift-giver 的 `reset` 应清 `hatched` 标志以重新触发孵化（便于重开档）。

## 9. 成功标准（可验证）

1. 全新档（无 `hatched`）启动 → 设备屏依次走：大木开场白 → 4 选 1（KEY 切换 + 确认）→ 孵化动画 + 音 → 默认名 → 进养成。
2. 选不同候选 → 对应物种成为 buddy；御三家按等级、伊布按亲密各自正确进化。
3. `hatched` 持久化：host 重启 / 设备重插 / reboot 后**不重复孵化**，养成进度延续。
4. newborn `bond=0`；正常用量下约 2 周触发首次进化。
5. usage：bridge 写出 `usage.json`，host 显示官方 5h/周%（与 `claude` statusline `rate_limits` 一致，非建模值）；字段缺失时显示"--/等待"不炸成 0/100；today cost/token 由 ccusage 正常出。
6. 脏档重置后从孵化开始；维护后门 `reset` 能重新触发孵化。

## 10. 风险 / 待解

- **御三家灰度精灵质量**：6 个中后段形态（火恐龙/喷火龙/卡咪龟/水箭龟/妙蛙草/妙蛙花）的 1-bit 抖动质量需逐个调校（原 spec §14 已列"上千精灵抖动参差"，此处仅 4 家族可控）。
- **孵化动画呈现**：蛋摇晃/裂开在 1-bit 低帧的观感 → 用 `mockups/` standalone HTML 先验证（沿用项目既有方式，不用 superpowers visual server）。
- **statusline 字段缺失边界**：Pro/Max only、会话早期缺失 → 必须 null 兜底（§7）；非订阅用户无 rate_limits 时的降级显示需明确。
- **statusline 共存**：朋友/用户若已有 statusline，bridge 需链式调用或合并，不能覆盖（plan 处理）。
- **命名体验**：默认物种名是否够好；改名引导是否需要在设备屏给提示"去 dashboard 改名"。
- **进化节奏联动**：bond 参数改动要与断更衰减重校，避免"2 周进化"被衰减抵消。

## 11. 实现约束

- **codex 不可用**：codeagent/codex CLI 因 credit block 到 2026-06-11；按用户既有授权，本批可 Claude **直写**实现（沿用 B1–B5 模式），或等 codex 解封走 codeagent。plan 阶段确认。
- **视觉验证**：孵化动画 / 候选选择界面用 `mockups/` standalone HTML（`open` 直接看）验证，再落 canvas 渲染。
- **分阶段建议**（plan 细化）：① usage bridge（独立、风险最低、立即可验证官方%）；② 孵化 onboarding 状态机 + 脏档重置；③ 御三家 seed 数据 + 进化；④ 大木开场白彩蛋 + 孵化动画打磨。

## 12. 参考

- 原始设计：`docs/specs/2026-05-30-claude-pokemon-buddy-design.md`
- usage 调研结论：Claude Code 官方 statusline `rate_limits`（code.claude.com/docs/en/statusline，v2.1.80+）；对比 ccusage（建模）/ CodexBar（Mac-only）/ Windows EXE（纯 GUI 无 JSON 出口）。
- 现有实现：`host/src/index.js`(`ensurePet`/`runOneTick`)、`host/src/pet/{sim,settlement,evolution,personality}.js`、`host/src/usage.js`、`host/seed/evolution/eevee.json`、`host/src/web/`（dashboard）。
