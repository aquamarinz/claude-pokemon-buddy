# Pokémon 机制 → Buddy 适配调研（2026-05-30）

> 5 路并行调研（web-access skill）综合，一手来源以 Bulbapedia / Serebii / Cave of Dragonflies 为主。
> 用途：喂给 `claude-pokemon-buddy` 项目的正式 spec。设备 = 1-bit 单色 400×300 反射屏 + 喇叭 + 麦克风 + SHTC3 温湿度 + RTC + KEY/BOOT 两键；host(Windows/Node)渲染整屏图经 USB 推 ESP32；用量(ccusage)驱动养成；硬核温柔度=**挑战型**（断更衰减/生病/退化但**可恢复**、streak 攒护盾、伊布分支进化）。

## 0. 主线洞察（设计北极星）
1. **同构介质**：1-bit 屏 + 单喇叭 = 初代 GB 的原生介质。皮卡丘叫声=1-bit 数据、Missingno=乱码块、GB Printer 奖状=1-bit 打印 → 这些彩蛋是**原汁原味而非降级模仿**。
2. **真实世界 1:1 喂进游戏机制**（本项目独有卖点）：
   - 真实 **RTC 昼夜** → 太阳/月亮伊布进化分叉。
   - 真实 **Open-Meteo 天气** → Pokémon GO 式"真实天气→属性加成"（架构完全相同，映射表可抄）+ 雨天进化（黏美龙）。
   - 真实 **SHTC3 室温/湿度** → 叶伊布(暖湿)/冰伊布(冷)的"苔藓岩/冰冷岩"环境。
   - 真实 **日历月** → 第五世代四季（含南半球月份翻转）。
   - **Claude 用量** → Pokémon Pikachu/Pokéwalker 的"步数→watt"、Poké Pelago 的被动放置成长。

## 1. Eevee 进化分支映射（养成核心）
亲密度阈值现代值 **160**（满 255，Gen VIII+）。**伊布亲密分支只有 3 个**；叶/冰是地点进化；水雷火是石头。

| 进化 | 原作条件 | 现实映射 | 适配 |
|---|---|---|---|
| Espeon 太阳 | 高亲密 + 白天升级 | 亲密≥160 + 白天(RTC, ~06–18)触发 | 完美 |
| Umbreon 月亮 | 高亲密 + 夜晚升级 | 亲密≥160 + 夜晚(RTC, ~18–06)触发 | 完美 |
| Sylveon 仙子 | 高亲密 + 会妖精招 | 亲密≥160 + care/互动达标(摸摸/对话计数, 类比 GO 70 爱心) | 完美 |
| Leafeon 叶 | 苔藓岩升级(Gen8+ 叶之石) | SHTC3 湿度高 + 天气晴暖时触发；或手动叶之石 | 需改造(传感器独有) |
| Glaceon 冰 | 冰冷岩升级(Gen8+ 冰之石) | SHTC3 室温<阈值 / 真实下雪时触发；或手动冰之石 | 需改造(传感器独有) |
| Vaporeon/Jolteon/Flareon 水雷火 | 水/雷/火之石 | 累计用量解锁后**手动按键选石** | 完美(一次按键) |

> 进化交互建议：亲密满后伊布"开始发光"，等玩家**下次互动**才进化——把分叉时刻(昼/夜)控制权交给玩家，呼应原作"只看最终升级时刻时段"。进化动画用 1-bit 黑白反相闪烁 + 方波进化音。

**伊布起步分支图**
```
Eevee ─(累计用量达标 + 手动选石)→ 水/雷/火伊布 (氪强度型)
      ─(亲密≥160)─┬ 白天(RTC) → Espeon (日间生产型)
                   ├ 夜晚(RTC) → Umbreon (夜猫子型)
                   ├ care/互动达标 → Sylveon (陪伴宠爱型)
                   ├ 室温暖+湿度高/晴 → Leafeon (温润型)
                   └ 室温冷/下雪 → Glaceon (冬日型)
```

## 2. 亲密度 / Friendship（养成燃料，数值一手）
- 单字节 0–255；进化阈值 **160**(现代)；满威力 255；特效分档 180/220/255。
- **升**：走步(每128步50%+1)、升级(+5/+3/+2)、维生素(+5/+3/+2)、友好树果(**+10/+5/+2，可破软上限**)、按摩(+30/+10/+5)、Luxury Ball(增量+1)、Soothe Bell(×1.5，可叠)、起始 120。
- **降**：濒死(−1；战斗外/大等级差 −5/−10)、苦味草药(−5~−20)。
- **软上限**：日常行为只能推到 ~160–180；冲 255 必须靠"特殊喂养"(树果/野餐) → 做成"需主动行为解锁的顶层"。
- **映射**：亲密度=每日坚持+care 喂养（会衰减）；等级=累计用量（永久不掉）。两条曲线解耦。断更分级衰减 −1/−5/−10、先扣 streak 护盾、7+ 天退化(降形态)、恢复用量回涨。退化态招式 报恩→迁怒(闹脾气彩蛋)。
- **Friendship Checker 台词** → buddy 自述："还在打量你 / 慢慢熟了 / 很黏你 / 超爱你"（零成本高情感）。

## 3. 个性层（每只 buddy 独一无二，几乎零像素成本）
- **Nature 性格**(25种, ±10%能力, 5中立)：领养/前7天画像后**一次性定、终身不变**。绑用量风格(爆发→急性子/Hasty喜甜；慢深聊→Relaxed喜酸苦；重任务→Adamant喜辣；多轮对话→Modest喜干；平稳→中立)。驱动 (a)待机动画细节 (b)口味喜恶(喂"喜欢的味"涨亲密多)。
- **IV 个体值**(6项0–31, 随机终身)：领养随机骰 → 抽卡稀缺感；Judge 式"天赋鉴定"。
- **EV 努力值**(单项252/总510)：累计用量按**类型分流**(代码→攻击、长文→特攻、高频→速度) → 专精 vs 全能；驱动等级(永久)。
- **Characteristic 签名**(最高IV mod5 → 30句之一, 终身)："爱睡午觉/有点小丑/…"。纯文本签名档。
- **Ability 特性**：给 buddy 一个被动 perk(晨型/夜行)；**隐藏特性**=极稀有彩蛋(如连续100天streak解锁)。
- **Condition 五维**(帅气/美丽/可爱/聪明/强壮)：可做第二条"颜值"养成线；1-bit 屏建议精简到 1–2 主轴。

## 4. 被动养成 + 照料互动（"不变 chore"是铁律）
- **Pokémon Pikachu(1998 计步器)** = 本 buddy 的祖型：20步=1 watt → 用量当步数；RTC 切时段动画；"摇晃生气"→**室温过高/低时 buddy 不适**(SHTC3 接管)。**KEY=摸摸/给watt、BOOT=查看状态**。
- **Pokéwalker**：花 watt 触发随机彩蛋("探宝"掉小道具)；每次最多升1级=**单日贡献设上限**防暴涨；USB 同步=红外同步仪式("把今天战利品交给你")。
- **Poké Pelago**：真实时间被动推进、关机也长、资源(豆)=用量；**进度停滞不暴跌**=温柔衰减。RTC 跑 tick。
- **Refresh 战后护理**："蔫了/落灰/橙圈提示"→**按 KEY 一下梳理/擦干恢复**(单次3秒)；湿度高→"吹干"(BOOT)；**麦克风对它说话 +亲密**。完美契合"轻量、可恢复"。
- **Camp 想玩值**：刚互动过再狂按**收益递减** → 防机械刷、逼自然节奏。
- ⚠ **反面教材 Sheen**：宝芬/方块**终生喂养上限255**(喂满永久不能再喂) → **绝不照搬**(会"养死"buddy)；只用每日软上限。

## 5. 真实世界 → 游戏机制 1:1 链路
- **RTC 昼夜**(套 HGSS 边界：晨04–10/昼10–20/夜20–04) → 待机动画/BGM 切换 + 太阳/月亮伊布分叉。
- **天气(Open-Meteo) → GO 式属性加成**（整点拉真实天气，映射表）：晴=草/地/火、雨=水/电/虫、多云=普/岩、阴=妖/斗/毒、风=飞/龙/超、雪=冰/钢、雾=恶/幽。对应属性 buddy"更精神/加成光环"。雨天可触发雨系进化。
- **室温(SHTC3)** → 叶/冰伊布环境门控 + 冷热情绪(原创，无原作锚点，传感器独有差异点)。
- **日历月 → 第五世代四季**(春1/5/9 夏2/6/10 秋3/7/11 冬4/8/12；**南半球+6月翻转**)：背景四季换皮、小鹿/萌芽鹿形态。
- **计步**：设备暂无计步硬件 → 用"通电时长/互动次数/用量"代理"步数"；若日后加传感器再接 Pokéwalker(20步=1watt)/GO 孵蛋距离。

## 6. 彩蛋库
**Top 推荐（一看一听即会心 × 单色屏+喇叭最能还原）**
1. Eevee 昼夜进化(Espeon/Umbreon) — 镇店之宝。
2. 闪光 buddy：真 **1/8192**(Gen2–5) → Gen6+ 1/4096；星星闪光+ping 音("Shiny"词源)。
3. **Missingno.** 倒L乱码块(1-bit 原生) + 失真叫声，隐藏指令触发。
4. **血量过低滴滴警报**(单方波循环) — 绑低电量隐喻。
5. **卡车下梦幻** — "推开→nothing happened"自嘲(原版是假的，硬核玩家都懂)。
6. **大木博士开场白**(逐字首次开机) + **"There's a time and place for everything, but not now"** 自行车梗。
7. **宝可梦中心治疗音**(完成恢复/同步) + **精灵球晃3下**捕获 jingle。
8. **道馆徽章=成就系统**(初代徽章几何形 1-bit) / **图鉴 Diploma = GB Printer 1-bit 奖状**。
9. **真实天气→GO属性加成** + **真实四季**(南半球翻转)。
10. **跟随宝可梦心情**(黄版皮卡丘/HGSS Mood) — buddy 心情图标。

**音效池（喇叭主场，全 1-bit 可行）**：宝可梦叫声(各代方波)、升级音、胜利 fanfare(野生/训练师/道馆三段)、效果拔群/不好打击音、获得道具音、自行车 BGM、紫菜镇 BGM(深夜，**仅正常旋律**)。

## 7. 必避坑 & 别碰的假梗（诚实声明）
- **Sheen 终生上限**：别照搬，否则养满即"死"。用每日软上限。
- **紫菜镇"致病高频"**：已被 Bulbapedia 辟谣的 creepypasta，**只用正常旋律+深夜氛围**，不做猎奇高频。
- **卡车下梦幻/怪力推车出梦幻**：原版是假的 → 做"nothing happened"自嘲版才是真情怀笑点。
- 部分数值(Let's Go 分段%、亲密增减表)为 Bulbapedia 二次提取，**最终落数前回原页/ Serebii 复核一遍**。

## 8. 适配度结论
- **完美适配**：昼夜进化、天气→属性加成、四季、亲密度、个性层(Nature/IV/Characteristic)、被动放置(Pelago)、几乎全部音效彩蛋、Missingno/奖状(1-bit 原生)。
- **需改造**：叶/冰伊布(地点→传感器)、计步类(无硬件→代理)。
- **不适配**：通信交换进化(需双机)、性别/随机分支(伊布无关)。

## 9. Sources（一手优先）
- Bulbapedia: Evolution, Eevee, Eeveelution, Friendship, Friendship Evolution, Return (move), Nature, Flavor, Contest condition, Characteristic, Individual values, Effort values, Ability, Time, Weather, Weather (GO), Season (game mechanic), Pokéwalker, Pokémon Pikachu / Pikachu 2 GS, Poké Pelago, Pokémon-Amie / Refresh / Camp, Walking Pokémon, Cry, Shiny Pokémon, MissingNo., Lavender Town, S.S. Anne, Professor Oak/Quotes, Pokémon Center, Badge, Diploma, Safari Zone, Starter Pokémon, Ice Stone, List of Eggs in Pokémon GO, List of battle music themes, Type.
- Serebii: Eevee SV Pokédex, Eevee #0133 GO.
- The Cave of Dragonflies: Espeon & Umbreon Guide.
- Wikiquote: Pokémon Red and Blue (Oak intro 交叉验证).
- pret/pokecrystal (低血量 beep 反汇编), Hooktheory (自行车曲乐理).
- 二手交叉(标注)：GO 运营机制(Fandom/Dexerto)、都市传说(Gaming Urban Legends Wiki, 已辟谣)。
