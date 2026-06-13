# 视觉打磨轮 P1+P2 — 设计文档

> 日期：2026-06-13 · 分支：`feat/hatching-2b` · worktree：`~/Projects/claude-pokemon-buddy-2b`
> 触发：用户两次反馈宠物 sprite「太糊/太粗糙」+ 孵化 onboarding 各屏简陋。

## 背景与目标

孵化 onboarding（Plan 2b）+ usage bridge 已上线，但视觉质量不达标：
1. 宠物 sprite 是 40-56px 像素图放大 3x，颗粒粗、中间调塌成黑团；
2. onboarding 各屏（大木/选蛋/孵化/诞生）+ 日常屏缺乏打磨与戏剧性。

目标：在**不改运行时渲染管线契约**（host canvas → 1bpp → 脏区推 ESP32）、**不改养成数值逻辑**的前提下，把 7 项视觉做到「礼物级」。所有改动落在 `host/src/render/` + `host/src/pet/onboarding*` + sprite/Oak 资产，外加进化动画的多帧推送序列。

非目标：不动 sim/进化触发逻辑（上一轮已修表驱动）、不动 usage/weather/state、不动固件、不改 dashboard 数值。

## 已完成（基线，commit d050030）

**项① sprite 全 18 只换 Dream World 矢量线稿**——已 merge。烘焙管线（定稿，需固化为 `host/scripts/bake-sprites.mjs` 入库可复现）：

```
PokeAPI Dream World SVG (扁平色块矢量)
 → 4x 超采样栅格 (targetMax*4, 关键: 2x 时细线断成虚线)
 → 白底合成 (去透明)
 → 降采样到 120px 最长边 (imageSmoothingQuality=high)
 → 灰度
 → 自动阈值: 墨水占比首次 ≥13% 的阈值 +25 校准 (每只单独)
 → 1-bit PNG (黑=不透明, 白=透明)
```

矢量源无渐变，描边与填色存在干净分隔阈值 → 二值化无毛边。18 物种全有 DW 源（含 Gen6 仙子伊布）。运行时 `loadBuddySprite → drawSprite` 对已 1-bit 图再阈值幂等，**渲染管线零改动**。全表面验证（日常屏/孵化末帧/诞生屏经真实 runOneTick 管线）已通过。

> **遗留**：烘焙逻辑目前在 /tmp 临时脚本。本轮须固化为 `host/scripts/bake-assets.mjs`（sprite + 项 A 的 Oak）入库，URL/阈值写死可复现。**单测绝不依赖网络下载**——资产 PNG 已入库，测试只读本地资产（codex 评审采纳）。

> 本 spec 余下部分是**尚未实现**的 6 类视觉项。

## 设计决策记录（用户逐项确认）

| 项 | 决策 | 备注 |
|---|---|---|
| ① sprite | DW 矢量 4x 线稿 | 已 merge |
| 蛋设计 | **同人差异化蛋**（非官方） | 查证官方共用通用蛋；用户选差异化 |
| ⑤ 大木 | **FRLG 真·大木立绘**（非精灵球） | 用户要 canon |
| 进化动画 | GB 闪白交替 | 早期已确认风格 |

## 实现项

### 项 A — Oak 立绘资产 + 大木开场屏（`render/onboarding.js` drawOak）

**资产**：FRLG 官方 Oak 立绘（`Spr_FRLG_Oak.png`，源 Bulbapedia archives）→ threshold 175 → bbox 裁剪 → 1-bit PNG 存 `host/seed/oak.png`（40×63）。烘焙逻辑并入 `bake-sprites.mjs`（或独立 `bake-oak.mjs`），URL + 阈值写死可复现。

**drawOak 改动**：
- 顶部标题「大木博士」12px（已是中文，保留）+ 下划线。
- 精灵球 → **Oak 立绘 scale 2**（80×126），水平居中，y≈46。Oak 资产经 `loadOakSprite()`（类比 loadBuddySprite，读 `seed/oak.png`）。
- 开场白 4 行（OAK_LINES）17px 居中，块起点 y≈196，行距 24px。
- 底部页码点：当前页实心、其余描边（`○○○●` 第 4 页）。
- 右下「▶ KEY」。
- **页码点数据**：`runOnboarding` 的 oak scene 必须显式传 `{ page, total }`（`pet/onboarding.js` 的 oak 循环已知 page=循环变量、total=OAK_LINES.length），drawOak 不再从 lines 长度猜。scene 形如 `{ kind:"oak", lines, page, total }`。
- **布局约束**：Oak(126px) + 文字(4×24=96px) + 页码点不重叠出血。若紧，页码点与末行留 ≥8px。

**验收**：oak.png 资产存在且 1-bit；drawOak 渲染出可辨认 Oak + 4 行白 + 页码点；离线 PNG 全表面图人工确认。

### 项 B — 4 个差异化蛋（`render/onboarding.js` 新增 per-species egg 绘制）

替换现有单一 `egg(g,cx,cy,scale,crack,shake)`（所有候选同形换斑）为 **`drawEgg(g, species, cx, cy, scale, {crack, shake})`**，4 个候选物种各自形态：

- **eevee**：标准椭圆(rx34/ry44) + 中段水平锯齿毛领带 + 3 散斑。
- **bulbasaur**：椭圆 + 顶部茎(y-44→-58)+两叶+卷 + 3 大块叶斑。
- **charmander**：水滴形(上尖 y-50 下圆，bezier) + 顶部火簇三角 + 3 个向上火苗三角纹。
- **squirtle**：矮圆(rx38/ry40) + 3 条横向龟壳分段带(按椭圆宽度截断) + 顶部波浪水纹。

`crack`/`shake` 参数仍支持（孵化动画用），裂纹/碎片作为**共享 overlay** 叠加在各蛋形上（不为每蛋重写裂纹）。非候选物种（理论不出现）回退 eevee 蛋。

**⚠️ 反向测试冲突**：现有 `test/onboarding-render.test.js` 的 "hatch mid-frame egg animation is species-agnostic" 断言不同 species 的非末帧蛋**相同**。本项让蛋按 species 区分 → 该断言必须**反转**为「不同 species 的蛋帧不同」。

**验收**：4 蛋大图并排一眼可区分；选蛋屏小 chip(~26px)仍可辨；离线图确认。

### 项 C — 选蛋屏（`render/onboarding.js` drawChoose）

- 中央大蛋 `drawEgg(候选[sel].species, ...)` 随 sel 联动。
- 中央 24px 物种名（已有）。
- 4 个候选 chip：选中项**整块反色**（黑底 + 白蛋白字，用 globalCompositeOperation 或先填黑底再以 PAPER 描白蛋）；未选描边。chip 内小蛋用对应 species 的 `drawEgg(scale≈0.42)` + 编号 `#n`。
- 底部「KEY 切换 · 长按确认」。

**验收**：KEY 循环切换中央蛋 + 名 + 高亮 chip 联动；选中反色清晰。

### 项 D — 孵化动画加戏（`pet/onboarding.js` runOnboarding + `render/onboarding.js` drawHatch）

12 帧序列（替换现 6 帧蛋抖一下）：
- f0：静止蛋（所选 species 的 drawEgg）。
- f1-f4：摇晃渐强（shake ±3 → ±8 交替）。
- f5-f6：裂纹一段 + 碎片(shard)飞出。
- f7-f8：裂纹两段 + 更多碎片。
- f9-f10：**闪黑全屏**（`fillRect` 全黑）。
- 闪黑后**不画揭晓帧**——`runOnboarding` 直接转入诞生屏（项 E）。
- 删除「♪ 孵化音」字样（改为视觉闪黑 + 实际声音）。

**音效时序（明确）**：`runOnboarding` hatch 循环逐帧 `await io.push(frame)` + `io.delay`（帧间 ~160-230ms）。**第一帧闪黑（f9）push 成功后立即 `io.playSound(SOUND.EVOLVE)`，再 delay**——不是等所有 hatch 帧结束才播（现实现是循环后才播，需改）。

`drawHatch(g, frame, species)` 末帧不再画 critter/sprite（揭晓交给 born 屏）。

**⚠️ 反向测试冲突**：现有 "hatch end-frame shows the chosen species' real sprite" 断言末帧按 species 揭晓 sprite。本项把揭晓移到 born 屏 → 末帧改为闪黑，该断言必须**改写**为「末帧是全黑 bitmap」。

**验收**：单测断言帧序列（静→抖→裂→闪黑）+ playSound 在首个闪黑帧后调用一次；离线逐帧图确认；mock io 单测不碰设备。

### 项 E — 诞生庆祝屏（`render/onboarding.js` drawBorn）

- sprite 背后 **12 条放射线**（rays，r1≈82 r2≈108）。
- 标题「✦ {name} 诞生了！ ✦」24px 居中，两侧 ✦。
- 「默认名 {name} · 想改名去 dashboard」12px 居中（「默认名」行并入改名提示）。
- 「▶ KEY 开始养成」。

**验收**：离线图确认放射线 + ✦ + sprite 清晰。

### 项 F — 日常屏（`render/layout.js` drawBuddyPanel + `src/index.js` buddy model）

**数据流改动（前置，否则渲染拿不到数据）**：`index.js` 构建 buddy render model 处（约 index.js:112）当前只传 `bond: bondHearts(pet.bond)`（已压成 0-5 整数心，`bondHearts` 仅此处用）。改为：
- `species: pet.species`（新增，渲染物种名用）
- `readyToEvolve: pet.readyToEvolve`（新增，徽章用；pet 上已由表驱动写入，见 index.js:88）
- `bond: pet.bond`（**传 raw bond**，删除 `bondHearts` 预压；半心映射统一移到 render 层）

**drawBuddyPanel 改动**：
1. **物种中文名**：sprite 下方加 `SPECIES_ZH[buddy.species]`。坐标：sprite 占 y60-196 区，物种名放 **y≈190 居中**（panelX+panelW/2），mood 行(y205/213)、Lv(y245)、exp(y255)、亲密度(y277-288) **保持不动**（物种名塞进 sprite 与 mood 间的空白，不整体下移）。
2. **可进化徽章**：当 `buddy.readyToEvolve` 为真，**物种名那一行**改画反色徽章「▲ 按 KEY 进化！」（INK 填充 bar + PAPER 文字，约 y184-200）；非 ready 显示物种名。两者互斥占同一 y 行，下方布局不变。
3. **爱心半心**：导出纯函数 **`heartCount(rawBond)` 返回 0-5 含 0.5 步进**：`clamp(round(rawBond / 40 * 2) / 2, 0, 5)`（bond/40 的 granularity 不变，仅显示精度细化到半心）。`drawHeart(g,x,y,fill)` 的 `fill ∈ {0, 0.5, 1}`，半心 = clip 左半填充。`drawHearts` 仍画 5 颗，按整数部分实心 + 余 0.5 画半心。心可适当加大（当前 16px 宽/20px 距，可增至 ~18-20px，不溢出面板）。
4. **火焰 streak**：`drawFlame` 已存在，保留不动。

**SPECIES_ZH 映射**（新增 `host/src/pet/species-meta.js`，**不并入 cries.js**——那是叫声职责；**不依赖 web/app.js**——那是浏览器端硬编码）：全 18：伊布/水伊布/雷伊布/火伊布/太阳伊布/月亮伊布/叶伊布/冰伊布/仙子伊布/妙蛙种子/妙蛙草/妙蛙花/小火龙/火恐龙/喷火龙/杰尼龟/卡咪龟/水箭龟。进化动画（项 G）也用它。

**验收**：日常屏物种名显示正确；readyToEvolve 时徽章替换物种名行、下方布局不动；半心在 bond 非整 40 倍段显示；离线图全 18 物种 + ready/非 ready 两态确认。

### 项 G — 进化全屏动画（`src/index.js` runOneTick 进化分支 + `render/` 新增 evolution 渲染 + 顺序多帧推送）

现状：KEY 触发进化时 `evolvePet` 后只 `playSound(EVOLVE)` + 下一帧换 sprite，**无动画**。

**动画序列**（GB 风）：
- 闪黑×2（全屏黑）。
- 新旧物种**正常 1-bit sprite** 加速交替 ×8（from-sprite ↔ to-sprite，帧间隔 420→110ms 递减）。**不做 silhouette**——当前 DW sprite 是黑描边+透明内部，"非透明像素全黑"得到的剪影与原图几乎一样、无意义；直接交替两只物种的正常 sprite 即读作"形态在变"，零新资产（codex 评审采纳）。
- 闪黑×2。
- 放射线揭晓 to-species sprite + 「✦ {fromZH} 进化成了 {toZH}！ ✦」，**定格固定 ~1000ms 后回日常屏**（**不等 KEY**——runOneTick 无 onboarding 的 `nextButton()` 阻塞输入模型，等 KEY 会卡死主 tick loop；codex 评审指出，改定时定格）。

**契约约束（codex 评审必修，全部采纳）**：
1. **持久化顺序**：进化 KEY 分支里先 `evolvePet` 更新 pet → **`saveState(statePath, pet)` 落盘** → 再 `playEvolutionAnimation` → 最后推日常帧。保证动画失败/进程中断时进化已持久化（现实现是先 save 再 push，本项把"算 from/to + save"提到动画前）。
2. **顺序推送**：`playEvolutionAnimation` 每帧 **`await transport.push(frame)` 成功后再 `delay` 再推下一帧**——绝不并发 fire-and-forget。serial transport 是 stop-and-wait 且只在 ACK 成功后更新 `previousBytes` 脏区基线（transport/index.js:49、serial.js:64），并发会让后续帧用旧基线算 dirty rect → 设备残影。
3. **可注入 delay**：签名 `playEvolutionAnimation({ transport, fromSpecies, toSpecies, delay = realDelay })`，测试注入 fake delay（否则真等 420→110ms）。
4. **playSound 时机**：第一帧闪黑 push 成功后播一次 EVOLVE。
5. 中文名取自 `SPECIES_ZH`（项 F 的 species-meta.js）。

**实现位置**：`playEvolutionAnimation` 放 `render/` 或 `pet/`（async 子程序，不污染 runOneTick 主体）；evolution 帧渲染（闪黑/双 sprite 交替/放射线揭晓）复用 `loadBuddySprite` + frame.js 的 `imageDataToFrame`。**不做通用动画 scheduler**（YAGNI，codex 采纳）。

**验收**：集成测试 `runOneTick` 进化 KEY 分支推送多帧动画 + 最终日常帧 + 保存 evolved state；`playEvolutionAnimation` 用 fake delay + spy transport 断言**顺序推送**（下一次 push 不早于上一次 resolve）+ playSound 一次 + from≠to 帧不同；离线逐帧图确认交替 + 揭晓；mock transport 不碰设备。

## 单元测试要求（requirement-driven）

新增：
- **drawEgg**：4 species 各自 pngBuffer 互不相同；带 crack 与不带不同。
- **drawHatch**：末帧（f9/f10）为全黑 bitmap；序列长度正确。
- **runOnboarding（mock io）**：hatch 首个闪黑帧后 playSound(EVOLVE) 调用一次；born 阶段返回 {species,name}；oak scene 收到 {page,total}。
- **heartCount 半心（导出纯函数）**：raw bond 落半心段返回 0.5 步进（如 bond=60→1.5）；边界 0 和满(bond≥200→5)。
- **SPECIES_ZH**：18 物种全有映射，无 undefined。
- **playEvolutionAnimation（fake delay + spy transport）**：推送帧数 == 序列长度；**顺序推送**（下一次 push 不早于上一次 resolve）；playSound(EVOLVE) 一次；from≠to 的交替帧不同。
- **runOneTick 进化集成（mock transport）**：ready pet + KEY → 推送 >1 帧（动画+日常）+ **saveState 写入 evolved species**。
- **drawBuddyPanel readyToEvolve（经 renderFrame 比 bitmap，不暴露私有函数）**：ready 态 ≠ 非 ready 态。

改写（反向测试同步）：
- onboarding-render.test "hatch end-frame shows sprite" → **末帧为全黑**。
- onboarding-render.test "hatch mid-frame species-agnostic" → **不同 species 蛋帧不同**。

全量回归 0 fail（`node --test --test-concurrency=1 --test-force-exit`，**设备插着 + host 不跑时也 0 fail**，新测试一律注入 mock/fake transport，绝不默认 `createTransport()` 真实探测串口）。

## 全表面自验（交付前，亲眼看 1-bit）

经真实管线离线渲染并人工确认：
1. onboarding 全流程：大木(Oak立绘+页码) → 选蛋(4蛋+联动+反色) → 孵化逐帧(抖/裂/闪黑) → 诞生(放射线+✦)。
2. 日常屏 × 全 18 物种（物种名 + 半心 + 火焰）+ readyToEvolve 态徽章。
3. 进化动画逐帧（闪黑/剪影交替/揭晓）至少 1 条进化线（如 eevee→espeon）。

## 风险

- **Oak 立绘 1-bit 可辨性**：40×63 像素，scale 2 后脸部细节少——已真机预览确认可辨（用户接受）。
- **进化动画推送时序**：多帧 push 经串口需确认不阻塞/不丢帧（复用 onboarding io 已验证的 push+delay 模式）。
- **半心 bond 映射**：须确认 granularity 改动不影响进化阈值判定（进化看 raw bond，不看显示心数——已表驱动，安全）。
