# 朋友侧"一条指令安装" + 完整 Onboarding 体验 — 设计规格 (Design Spec)

> 状态：Design v1 · brainstorm 收尾 → codex review → writing-plans。日期：2026-07-05。
> 配套：原始设计 `docs/specs/2026-05-30-claude-pokemon-buddy-design.md`、孵化 onboarding `docs/specs/2026-06-09-onboarding-hatching-and-usage-design.md`（本 spec 是它们的**分发/首启体验补全**，未提及处沿用原 spec）。

## 1. 场景与动机

朋友（Windows 用户、Claude Code 用户、非开发者假设）拿到一台**完全空白**的 ESP32-S3-RLCD-4.2（只有电池、无 SD 卡、固件未烧），USB 线连上他的 Windows 电脑。目标体验：

> 他只需给他的 Claude 发**一条指令**，Claude 自动完成从零到"屏幕亮起、开始孵蛋"的全部安装；孵化后设备屏轻教程 + Claude 讲解玩家手册接管新手引导。

现状差距（已核实）：仓库 **私有**、**无任何 Release/预编译固件**、**无 README/安装文档**、无设备屏教程、无玩家手册、无开机自启步骤、config 默认坐标是奥克兰。

架构前提（利好）：固件是"哑终端"（烧一次不再动），全部逻辑在 host（Node.js，仅 2 个 npm 依赖）；串口按 Espressif VID `303a` 探测（Windows COM 口同样适用，`host/src/transport/serial.js:26`）；设备屏孵化 onboarding（大木开场白→选蛋→孵化）已实现（`host/src/pet/onboarding.js`），全程不需要 SD 卡；usage bridge 的 Windows 配置已有文档（`host/docs/usage-bridge-setup.md`，Windows 直配 `usage-bridge.mjs`，无需 wrapper）。

## 2. 已拍板的决策（owner 确认，2026-07-05）

| 决策点 | 结论 |
|---|---|
| 仓库访问 | **转公开仓库**（接受项目内容可见的代价） |
| 固件分发 | **预编译 GitHub Release + esptool 烧录**（朋友侧不装 ESP-IDF） |
| 朋友环境最低假设 | **仅假设 Claude Code 已装好并登录**（git/Node 等全由指令驱动 Claude 自动装） |
| 新手教程形态 | **设备屏轻教程（孵化后大木 3-4 屏）+ Claude 讲解玩家手册** 双层 |
| "一条指令"形态 | **方案 C**：agent 化安装文档 SETUP-WINDOWS.md 为骨架，机械易错步骤内嵌完整可复制命令，验证/排障交给执行的 Claude |

## 3. 范围 / 非目标

**范围**
- 仓库公开化前置（敏感信息历史扫查）。
- 固件 Release 流程（owner Mac 侧构建合并 bin → `gh release create`）。
- `README.md`（仓库门面）。
- `SETUP-WINDOWS.md`（写给 Claude 执行的安装文档，含"那条指令"正文与微信话术）。
- `PLAYER-GUIDE.md`（玩家手册，Claude 讲解底稿）。
- 孵化后设备屏轻教程（host 侧状态机扩展，固件零改动）。
- Windows 开机自启（作为 SETUP 文档中的一步，非代码资产）。
- config 个性化步骤（城市→lat/lon）纳入 SETUP 流程。

**非目标（不做）**
- 不动固件（B1–B5 稳定；教程纯 host 侧文本屏）。
- 不做 PowerShell 大一统安装脚本（方案 B 已否决）。
- 不做网页烧录器（ESP Web Tools）。
- 崩溃自愈 supervisor、单 exe 打包、托盘程序、后续 OTA/更新机制 → 记 BACKLOG（P2）。
- 不改现有孵化流程本身。

## 4. 七幕体验全链路

### 第 0 幕 · Owner 侧（发布，一次性）
1. **敏感信息扫查**：对全 git 历史扫 token/密钥/邮箱/个人路径等不可公开信息（gitleaks 或等效 + 人工抽查）。串口序列号等设备指纹属低敏，可留。
2. **转公开**：`gh repo edit --visibility public`。
3. **固件 Release**：Mac 侧 `idf.py build` → `esptool merge-bin`（bootloader + partition-table + app 合并为单文件、0x0 起）→ `gh release create fw-vX.Y.Z` 上传 `cpb-firmware-merged.bin`。Release notes 注明目标板与烧录命令。固件后续极少变更，此流程手动即可，不建 CI（YAGNI）。

### 第 1 幕 · 朋友收到的"指导内容"（微信可发）
一小段人话（这是什么礼物 + 用 USB **数据线**连电脑）+ 那条指令全文。指令核心形态：

> 请打开并严格执行 `https://raw.githubusercontent.com/aquamarinz/claude-pokemon-buddy/main/SETUP-WINDOWS.md` —— 这是一份写给你（Claude）的安装手册。我桌上有一台连着 USB 的宝可梦小设备，请按手册把它从零装好，每一步都要跑手册里的验证命令确认成功再继续。

确切话术在 SETUP-WINDOWS.md 顶部维护一份权威版本（微信话术与文档同源，避免漂移）。

### 第 2 幕 · Claude 自动安装（SETUP-WINDOWS.md 驱动，目标 ≤15 分钟）
文档结构（每步 = 目的 + 命令 + **机器可判定的验证** + 失败分支）：

0. **给 Claude 的执行契约**（文档序言）：逐步执行；每步验证通过才前进；失败先走文档失败分支再自行诊断；需要主人操作（按键/拔插）时明确说人话；除城市提问外不问不必要的问题。
1. **环境自举**：`winget install Git.Git OpenJS.NodeJS.LTS`；esptool 用**官方 Windows 独立 exe**（esptool releases 的 win64 zip，免 Python）。验证：`git --version`、`node --version`、`esptool version`。
2. **取码装依赖**：`git clone` → `cd host && npm install`（仅 serialport + @napi-rs/canvas，均有 Windows 预编译产物）。验证：`npm ls --depth=0` 无 error。
3. **烧固件**：下载 Release bin → 探测 Espressif COM 口（`esptool` 自动探测；备选 PowerShell 查 `VID_303A`）→ `esptool --chip esp32s3 write-flash 0x0 cpb-firmware-merged.bin`。验证：命令输出 `Hash of data verified`。失败分支：a) 找不到 COM 口 → 检查是否充电线（无数据）、换口；b) 烧录失败/无法进入下载模式 → **按住 BOOT 键插线**再试；c) 串口被占用 → 找出占用进程。
4. **配 statusline（usage bridge）**：**merge 而非覆盖** `~/.claude/settings.json`，加 `statusLine.command = node <abs>/host/src/usage-bridge.mjs`（正斜杠路径；若已有 statusLine，按 `usage-bridge-setup.md` 的共存说明处理）。前置检查：`claude --version` ≥ 2.1.80。
5. **个性化**：Claude 问主人所在城市 → 写 `config.json` 的 `lat`/`lon`（默认值是奥克兰，必须改）。名字用默认"阿布"，改名走 dashboard（手册讲）。
6. **开机自启**：Startup 文件夹放 `.vbs`（`wscript` 隐窗拉起 `node src/index.js`，工作目录 = host/）。验证：`Test-Path` 该文件。选 Startup 而非 schtasks：免管理员权限、可见可删、对非开发者最不吓人。
7. **启动 + 端到端验证**：启动 host → 屏幕出画面（问主人确认）；在 Claude Code 里发一条消息触发 statusline → `Test-Path ~/.claude/cpb-usage.json` 且含数字百分比（仅 Pro/Max 有 `rate_limits`，文档注明）；按一下 KEY 有响应。
8. **交接**：进入第 5 幕（讲解手册）。

### 第 3 幕 · 设备屏孵化（已实现，零改动）
大木开场白 → KEY 短按切换 4 候选蛋 → KEY 长按确认 → 孵化动画 + 音效 → 诞生。

### 第 4 幕 · 设备屏轻教程（新增，host 侧）
诞生画面按 KEY 后、进入日常养成前，插入 3-4 屏大木文本（复用 onboarding 的打字机文本管线）：
1. 按键：KEY 短按/长按干什么、BOOT 键干什么。
2. 左屏用量表怎么读（5h/周 两条）。
3. "它靠你的 Claude 用量成长；几天不理它会蔫、会退步——但永远救得回来。" + 收尾。
- KEY 逐屏推进，长按跳过全部；存档写 `tutorialDone: true`，只出现一次；老存档（已 `hatched` 无该字段）**不补播**。
- 状态机扩展落在 `host/src/pet/onboarding.js` / `onboarding-data.js`，文案进 data 文件。

### 第 5 幕 · Claude 讲解手册（新增 PLAYER-GUIDE.md）
SETUP-WINDOWS.md 末步指示 Claude："用大木博士的口吻，把 PLAYER-GUIDE.md 讲给主人听，最后问他有没有想问的"。手册内容（写给 Claude 转述，也可人读）：
- 按键全集（含教程里没细讲的组合）；
- 养成模型人话版：用量→成长、亲密从 0 起、约 2 周首次进化、御三家 vs 伊布分支差异（不剧透具体分支条件）；
- 蔫/退化的可逆性（"没有 game over"）；
- dashboard（`127.0.0.1:8765`）：改名、设置、只读图鉴定位；
- 彩蛋："存在，不剧透"；
- 常见问题：拔线会怎样（断电、进度在电脑上不丢）、电脑睡眠/重启会怎样（自启+热插拔自愈）、找谁修（把 SETUP 的排障节喂给他的 Claude）。

### 第 6 幕 · 长期运行（既有能力 + 本期自启）
开机自启（第 2 幕第 6 步）+ 已有串口热插拔自动重连。supervisor/托盘/更新机制 → BACKLOG。

## 5. 交付物清单

| 交付物 | 位置 | 级别 |
|---|---|---|
| 敏感信息扫查 + 仓库转公开 | GitHub 操作（owner 手动，plan 给命令与检查单） | P0 |
| 固件合并 bin + Release | `gh release`（owner 手动流程文档化在 SETUP 附录或 docs/） | P0 |
| `README.md` | 仓库根 | P0 |
| `SETUP-WINDOWS.md`（含指令正文+微信话术） | 仓库根 | P0 |
| `PLAYER-GUIDE.md` | 仓库根 | P1 |
| 设备屏轻教程 | `host/src/pet/onboarding.js` + `onboarding-data.js` + 测试 | P1 |
| BACKLOG 追加 P2 项 | `docs/plans/BACKLOG.md` | P2 |

## 6. 测试与验收

**代码（轻教程）**——requirement-driven（node --test）：
- 孵化完成 → 教程首屏出现；KEY 逐屏推进；长按跳过；末屏后 `tutorialDone:true` 落档。
- 有 `tutorialDone` 的存档重启 → 不再出现；老存档（`hatched:true` 无该字段）→ 不补播。
- 教程中断电重启 → 不重复孵化，教程从头播（教程无中途存档，KISS）。

**文档（SETUP-WINDOWS.md）**——每步验证命令在真实 Windows 上跑通一遍（owner 已有 Windows 部署环境）；烧录步骤用 Release bin 在自有板上从 `erase-flash` 后的空白态实测一次。

**端到端验收**：空白板 + 干净 Windows 用户环境，只发"那条指令"，Claude 无人工兜底走到第 7 步全绿 → 孵化 → 教程 → 手册讲解完成。

## 7. 风险

1. **宝可梦 IP（最高风险）**：公开仓库含宝可梦形象/叫声衍生资产 + 仓库名带 pokemon，理论上有 DMCA 下架风险。属个人非商业礼物项目，owner 已选择公开=接受此风险；缓解：README 注明 fan project / 非商业 / 不分发官方 ROM 资产之外的声明。**若未来被下架，退回"打包发行包"分发即可，架构不受影响。**
2. statusline 覆盖：朋友若已有 statusLine 配置会被替换 → SETUP 写 merge/共存分支。
3. `rate_limits` 仅 Pro/Max 且首个 API 响应后出现 → 验证步骤已内置"发一条消息再查"。
4. Windows 现场差异（杀软拦 winget/esptool、公司机策略）→ SETUP 失败分支 + Claude 现场诊断兜底；无法穷举，验收以干净个人机为准。
5. esptool 独立 exe 与 merge-bin 参数随 esptool v5 命名变化（`write-flash`/`merge-bin` 连字符化）→ plan 阶段以实测版本为准锁定命令。

## 8. BACKLOG 候选（P2，本期不做）
- host 崩溃自愈 supervisor / 托盘程序 / 单 exe 打包（原 spec §241 遗留）。
- 后续更新机制（`git pull` + 重启的 agent 化 UPDATE.md，或自动更新）。
- 网页烧录器（ESP Web Tools）作为非 Claude 用户的备选安装路径。
