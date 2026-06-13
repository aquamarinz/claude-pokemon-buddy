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
- 精灵球 → **Oak 立绘 scale 2**（80×126），水平居中，y≈46。
- 开场白 4 行（OAK_LINES）17px 居中，块起点 y≈196，行距 24px。
- 底部页码点：4 个圆点，当前页实心、其余描边（`○○○●` 第 4 页）。
- 右下「▶ KEY」。
- **布局约束**：Oak(126px) + 文字(4×24=96px) + 页码点必须不重叠出血。若紧，页码点与末行留 ≥8px。

**验收**：oak.png 资产存在且 1-bit；drawOak 渲染出可辨认 Oak + 4 行白 + 页码点；离线 PNG 全表面图人工确认。

### 项 B — 4 个差异化蛋（`render/onboarding.js` 新增 per-species egg 绘制）

替换现有单一 `egg(g,cx,cy,scale,crack,shake)`（所有候选同形换斑）为 **`drawEgg(g, species, cx, cy, scale, {crack, shake})`**，4 个候选物种各自形态：

- **eevee**：标准椭圆(rx34/ry44) + 中段水平锯齿毛领带 + 3 散斑。
- **bulbasaur**：椭圆 + 顶部茎(y-44→-58)+两叶+卷 + 3 大块叶斑。
- **charmander**：水滴形(上尖 y-50 下圆，bezier) + 顶部火簇三角 + 3 个向上火苗三角纹。
- **squirtle**：矮圆(rx38/ry40) + 3 条横向龟壳分段带(按椭圆宽度截断) + 顶部波浪水纹。

`crack`/`shake` 参数仍支持（孵化动画用），裂纹叠加在各蛋形上。非候选物种（理论不出现）回退 eevee 蛋。

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
- f9-f10：**闪黑全屏**（`fillRect` 全黑），此时 `io.playSound(SOUND.EVOLVE)`（在第一帧闪黑时播一次）。
- 闪黑后**不画揭晓帧**——`runOnboarding` 直接转入诞生屏（项 E）。
- 删除「♪ 孵化音」字样（改为视觉闪黑 + 实际声音）。

`drawHatch(g, frame, species)` 末帧不再画 critter/sprite（揭晓交给 born 屏）。`runOnboarding` 的 hatch 循环逐帧 `io.push` + `io.delay`（帧间 ~160-230ms），闪黑帧后 `playSound`。

**验收**：单测断言帧序列（静→抖→裂→闪黑）+ playSound 在闪黑帧调用一次；离线逐帧图确认；mock io 单测不碰设备。

### 项 E — 诞生庆祝屏（`render/onboarding.js` drawBorn）

- sprite 背后 **12 条放射线**（rays，r1≈82 r2≈108）。
- 标题「✦ {name} 诞生了！ ✦」24px 居中，两侧 ✦。
- 「默认名 {name} · 想改名去 dashboard」12px 居中（「默认名」行并入改名提示）。
- 「▶ KEY 开始养成」。

**验收**：离线图确认放射线 + ✦ + sprite 清晰。

### 项 F — 日常屏（`render/layout.js` drawBuddyPanel）

1. **物种中文名**：sprite 下方加 species 中文名（需 `SPECIES_ZH` 全 18 物种映射，见下）。位置 ≈ sprite 下、mood 行(y205)上方，留空间。
2. **可进化徽章**：当 `model.buddy.readyToEvolve`（需从 pet 传入 buddy）时，物种名行 → **反色徽章「▲ 按 KEY 进化！」**（黑底白字 bar）。非 ready 显示物种名。
3. **爱心**：现已是 5 颗(16px)。改 **加大** + **半心精度**：`heartCount(bond)` 返回 0-5 含 0.5 步进（不四舍五入到整数）；`drawHeart` 支持 `fill ∈ {0, 0.5, 1}`（半心 = clip 左半填充）。bond→心数映射粒度不变（仍 bond/分段），只是显示精度细化。
4. **火焰 streak**：`drawFlame` 已存在，保留。

**SPECIES_ZH 映射**（新增，放 `pet/species-meta.js` 或并入 `cries.js`）：覆盖全 18：伊布/水伊布/雷伊布/火伊布/太阳伊布/月亮伊布/叶伊布/冰伊布/仙子伊布/妙蛙种子/妙蛙草/妙蛙花/小火龙/火恐龙/喷火龙/杰尼龟/卡咪龟/水箭龟。与 dashboard `app.js` SPECIES label 中文部分一致。

**验收**：日常屏物种名显示正确；readyToEvolve 时徽章替换；半心在 bond 非整数段显示；离线图全 18 物种 + ready/非 ready 两态确认。

### 项 G — 进化全屏动画（`src/index.js` runOneTick 进化分支 + `render/` 新增 evolution 渲染 + 多帧推送）

现状：KEY 触发进化时 `evolvePet` 后只 `playSound(EVOLVE)` + 下一帧换 sprite，**无动画**。

新增 GB 闪白动画序列（进化确定后、写 state 前推一串帧）：
- 闪黑×2（全屏黑）→ playSound(EVOLVE)。
- 新旧物种**剪影**加速交替 ×8（旧 species silhouette ↔ 新 species silhouette，帧间隔 420→110ms 递减）。silhouette = sprite 非透明像素全黑。
- 闪黑×2。
- 放射线揭晓新 species sprite + 「✦ {旧名} 进化成了 {新名}！ ✦」，定格等 KEY。

**实现约束**：runOneTick 是「一 tick 一帧」模型，动画需一个**多帧推送子程序**（类似 onboarding io 的 push+delay 序列）。抽出 `playEvolutionAnimation(transport, fromSpecies, toSpecies)` async，在进化 KEY 分支调用。剪影渲染复用 sprite gray + 阈值反相。揭晓帧后正常进入日常屏。需 `SPECIES_ZH` 取中文名。

**验收**：单测断言动画推送帧数 + playSound 调用；离线逐帧图确认剪影交替 + 揭晓；mock transport 单测不碰设备。

## 单元测试要求（requirement-driven）

- **drawEgg**：4 species 各自 pngBuffer 互不相同；带 crack 与不带不同。
- **drawHatch**：闪黑帧为全黑 bitmap；序列长度正确。
- **runOnboarding（mock io）**：hatch 阶段 playSound(EVOLVE) 调用一次（闪黑帧）；born 阶段返回 {species,name}。
- **heartCount 半心**：bond 落半心段返回 0.5 步进值；边界 0 和满。
- **SPECIES_ZH**：18 物种全有映射，无 undefined。
- **playEvolutionAnimation（mock transport）**：推送帧数 == 序列长度；playSound(EVOLVE) 一次；fromSpecies≠toSpecies 的剪影帧不同。
- **drawBuddyPanel readyToEvolve**：ready 态徽章 bitmap ≠ 非 ready 态。
- 全量回归 0 fail（`node --test --test-concurrency=1 --test-force-exit`，设备插着 + host 不跑时也 0 fail）。

## 全表面自验（交付前，亲眼看 1-bit）

经真实管线离线渲染并人工确认：
1. onboarding 全流程：大木(Oak立绘+页码) → 选蛋(4蛋+联动+反色) → 孵化逐帧(抖/裂/闪黑) → 诞生(放射线+✦)。
2. 日常屏 × 全 18 物种（物种名 + 半心 + 火焰）+ readyToEvolve 态徽章。
3. 进化动画逐帧（闪黑/剪影交替/揭晓）至少 1 条进化线（如 eevee→espeon）。

## 风险

- **Oak 立绘 1-bit 可辨性**：40×63 像素，scale 2 后脸部细节少——已真机预览确认可辨（用户接受）。
- **进化动画推送时序**：多帧 push 经串口需确认不阻塞/不丢帧（复用 onboarding io 已验证的 push+delay 模式）。
- **半心 bond 映射**：须确认 granularity 改动不影响进化阈值判定（进化看 raw bond，不看显示心数——已表驱动，安全）。
