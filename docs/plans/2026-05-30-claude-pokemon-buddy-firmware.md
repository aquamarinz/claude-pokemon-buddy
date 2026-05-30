# Claude Pokémon Buddy — Plan B：固件 + USB-CDC 串口链路 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。实现经 codeagent(codex/gpt-5.5)。步骤 `- [ ]`。
> **配套**：spec `docs/specs/2026-05-30-...-design.md`(§3 硬件/§10 链路/§4 音频) · Plan A `...-host-core.md`(已 merge 到 main) · 官方 demo `github.com/waveshareteam/ESP32-S3-RLCD-4.2`(`02_Example/ESP-IDF/10_FactoryProgram` 的 `port_bsp`+`ExternLib/codec_board`)。

**Goal:** ESP32-S3-RLCD-4.2 固件——收 host(Plan A) 经 **USB-CDC** 推的 1bpp 帧→刷 ST7305 屏；回传 KEY/BOOT + SHTC3；放叫声/UI 音。host 端把 Plan A 的 mock transport 换成真 `serialport`。

**Architecture:** **复用官方 BSP**（vendor `port_bsp`=DisplayPort/button/i2c/adc + `ExternLib/codec_board`=ST7305 lcd_init/ES8311 codec_init + SensorLib=SHTC3），**砍掉 LVGL/ui_bsp/wifi**。固件不渲染 UI，只收帧 blit + 回传 + 放音。**帧契约（B0 spike 已定）**：host 发 **row-major 1bpp 横屏(400×300, rowBytes=50, 15000B) 脏区+RLE**；**固件用 BSP 的 `RLCD_SetPixel`(内含横屏 LUT) 重打包进 `DispBuffer` → `RLCD_Display()`**（面板私有位布局留固件，host 保持 panel-agnostic、Plan A 零返工）。

**Tech Stack:** ESP-IDF v5.x (C/C++)；vendored Waveshare BSP 组件；ESP32-S3 原生 USB（TinyUSB CDC 或 USB-Serial-JTAG，B1 确认）。Host：`serialport`(npm) + Plan A 既有模块。

---

## B0：帧/链路契约（spike 已完成，记录于此）

**已读 `display_bsp.cpp`（FactoryProgram）确认**：
- 引脚：ST7305 SPI3——`DC=GPIO5 CS=40 SCK=11 MOSI=12 RST=41 TE=6`；I2C `SDA=13 SCL=14`。
- `DisplayPort`：`RLCD_Init()` / `RLCD_ColorClear(c)` / `RLCD_SetPixel(x,y,color)`(LUT 优化) / `RLCD_Display()`(设窗口 0x2A/0x2B/0x2C + 整块送 `DispBuffer`)。`DispBuffer`=15000B(PSRAM)。颜色 `ColorBlack=0 / ColorWhite=0xff`（1-bit）。
- `DispBuffer` 是 **ST7305 私有打包**（LUT：inv_y 垂直翻转、4 行块、2 列字节）→ 故由固件 `RLCD_SetPixel` 重打包，host 不碰。

**协议（spec §10）**：帧 `magic|type|seq|len|payload|crc32`。
- Host→ESP32：`FRAME`(脏矩形头 x,y,w,h + row-major 1bpp+RLE) / `SOUND_LOAD`(id,len,pcm) / `PLAY`(id) / `CONFIG`。
- ESP32→Host：`HELLO`(fwVer,board,vid) / `BUTTON`(key,evt) / `SENSOR`(tempC×10,rh) / `ACK`(seq) / `NACK`(seq) / 心跳。
- 流控：stop-and-wait（host 等 ACK 再发下一帧）；背压丢中间帧。

**像素极性**（B2 真机确认）：host bit `1`=墨(ink) → `RLCD_SetPixel(x,y,ColorBlack=0)`；`0`=纸 → `ColorWhite`。若真机反相，在固件一处取反。

---

## 文件结构

```
firmware/                         # 新 ESP-IDF 工程
  CMakeLists.txt, sdkconfig.defaults
  main/ main.cpp(app_main: init BSP→起 serial_link + sensor/button/audio task), user_config.h(引脚)
  components/
    port_bsp/  codec_board/  SensorLib/      # vendored 官方
    serial_link/  serial_link.cpp · frame_rx.cpp(解帧→RLE 解→脏区 RLCD_SetPixel→RLCD_Display) · proto.h
host/src/transport/ serial.js(真 serialport: COM 认 VID 0x303A + 编码) · proto.js(帧编解码纯函数, 与固件 proto.h 对齐)
host/test/ proto.test.js · diff.test.js · serial.test.js
```

---

## 里程碑 Bh：host 真串口 transport（**无需板子，现在可做、可测**）

### Task h1：proto 帧编解码（纯函数 TDD）
**Files:** Create `host/src/transport/proto.js`, `host/test/proto.test.js`
- [ ] **Step 1: 失败测试**

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { encodeFrame, decodeFrame, rleEncode, rleDecode } from "../src/transport/proto.js";
test("rle roundtrip", () => { const b=Uint8Array.from([0,0,0,0,255,255,1,2,2,2]); assert.deepEqual([...rleDecode(rleEncode(b))],[...b]); });
test("frame roundtrip w/ crc+seq+type", () => { const f=encodeFrame({type:0x01,seq:7,payload:Uint8Array.from([1,2,3,4,5])}); const d=decodeFrame(f); assert.equal(d.type,1); assert.equal(d.seq,7); assert.deepEqual([...d.payload],[1,2,3,4,5]); });
test("decode rejects bad crc", () => { const f=encodeFrame({type:1,seq:1,payload:Uint8Array.from([9])}); f[f.length-1]^=0xff; assert.throws(()=>decodeFrame(f)); });
```

- [ ] **Step 2: 失败** → `cd host && node --test test/proto.test.js` → FAIL。
- [ ] **Step 3: 实现 proto.js**（magic `0xA5`；header `magic|type|seq|len(2B LE)`；尾 `crc32(4B LE)`；RLE=`count,value` 对, count 1..255）

```js
export const MAGIC=0xA5;
export const T={FRAME:0x01,SOUND_LOAD:0x02,PLAY:0x03,CONFIG:0x04,HELLO:0x81,BUTTON:0x82,SENSOR:0x83,ACK:0x84,NACK:0x85};
export function rleEncode(b){const o=[];for(let i=0;i<b.length;){let v=b[i],n=1;while(i+n<b.length&&b[i+n]===v&&n<255)n++;o.push(n,v);i+=n;}return Uint8Array.from(o);}
export function rleDecode(b){const o=[];for(let i=0;i<b.length;i+=2){const n=b[i],v=b[i+1];for(let k=0;k<n;k++)o.push(v);}return Uint8Array.from(o);}
function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return(~c)>>>0;}
export function encodeFrame({type,seq,payload}){const len=payload.length;const head=Uint8Array.from([MAGIC,type,seq,len&255,(len>>8)&255]);const body=new Uint8Array(head.length+len);body.set(head);body.set(payload,head.length);const c=crc32(body);const out=new Uint8Array(body.length+4);out.set(body);out.set([c&255,(c>>8)&255,(c>>16)&255,(c>>24)&255],body.length);return out;}
export function decodeFrame(f){if(f[0]!==MAGIC)throw new Error("magic");const len=f[3]|(f[4]<<8);const end=5+len;const got=(f[end]|(f[end+1]<<8)|(f[end+2]<<16)|(f[end+3]<<24))>>>0;if(crc32(f.slice(0,end))!==got)throw new Error("crc");return{type:f[1],seq:f[2],payload:f.slice(5,end)};}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(host): serial proto frame/RLE/crc codec (Bh)`

### Task h2：脏矩形 diff（纯函数 TDD）
**Files:** Create `host/src/transport/diff.js`, `host/test/diff.test.js`
- [ ] **Step 1:** 失败测试：`diffRect(prevBits,nextBits,w,h)`→ 全同返回 null；首帧(prev=null)返回全屏 {x:0,y:0,w,h,bytes}；局部变化返回最小包围盒(x 按 8 对齐) + 该区 row-major 1bpp bytes。
- [ ] **Step 2:** 失败 → **Step 3:** 实现(行列扫描求变化包围盒, x 向下取整到 8、宽补齐到 8)。
- [ ] **Step 4:** PASS → **Step 5:** Commit `feat(host): dirty-rect diff (Bh)`

### Task h3：serial transport（COM 自动认 + stop-and-wait ACK；注入 port 可测）
**Files:** Create `host/src/transport/serial.js`, `host/test/serial.test.js`
- [ ] **Step 1:** 失败测试（注入 fake port：`pushFrame(bytes)` 发 FRAME 等 ACK 才 resolve；注入 BUTTON/SENSOR 帧 → onButton/onSensor 回调；ACK 超时重发 N 次后标 stale）。
- [ ] **Step 2:** 失败 → **Step 3:** 实现：`serialport` 真实现 + `SerialPort.list()` 扫 `path` 取 vendorId `303A`；`makeTransport({port})` 可注入；stop-and-wait + 超时重发；解析 ESP→host 帧分发。
- [ ] **Step 4:** PASS → **Step 5:** Commit `feat(host): real serialport transport (autodetect+ACK) (Bh)`

### Task h4：transport 工厂接进 Plan A 主循环（无设备优雅回退 mock）
**Files:** Modify `host/src/index.js`; Create `host/src/transport/index.js`
- [ ] **Step 1:** 失败测试：检测不到 ESP COM → 用 mock(出 PNG)；检测到 → real。
- [ ] **Step 2/3:** 实现 transport 工厂(real/mock 选择) + 接 `runOneTick`(push 当前帧 diff)。
- [ ] **Step 4:** PASS → **Step 5:** Commit `feat(host): transport factory + wire into loop (Bh)`

> **Bh 完成**：帧/RLE/脏区/ACK 全纯函数单测覆盖、真 transport 就绪；无板子自动回退 mock 出 PNG。**到货即插即用。**

---

## 里程碑 B1–B4（固件 · **执行待板子到货 + ESP-IDF 环境**；代码可先写，烧录/真机验收待板）

### B1：最小 ESP-IDF 工程 + 点屏（vendor BSP）
- [ ] 建 `firmware/` 工程；vendor 官方 `port_bsp`/`codec_board`/`SensorLib`；`user_config.h` 照搬引脚。
- [ ] `app_main`：`DisplayPort disp(MOSI,SCK,DC,CS,RST,300,400)`(横屏 LUT) → `RLCD_Init()` → 画**写死测试帧** → `RLCD_Display()`。
- [ ] **smoke(板)**：`idf.py flash monitor` → 屏显测试帧、串口 init OK。
- [ ] commit `feat(fw): minimal esp-idf project + ST7305 test frame (B1)`

### B2：USB-CDC + 收帧→刷屏（对接 host Bh）
- [ ] `serial_link`：USB-CDC（确认 TinyUSB CDC vs USB-Serial-JTAG——查 demo `sdkconfig`/`main`）；`proto.h` 与 host `proto.js` 对齐。
- [ ] `frame_rx`：解 `FRAME`→RLE 解→脏矩形内每像素 `RLCD_SetPixel(x,y, bit?ColorBlack:ColorWhite)`→`RLCD_Display()`；回 `ACK(seq)`；`HELLO` 握手。
- [ ] **smoke(板)**：host `npm start` 真 transport → **真屏显示 host 渲的仪表盘+buddy**(= frame.png 上真机)；校像素极性，反相则固件一处取反。
- [ ] commit `feat(fw): usb-cdc rx + frame blit + ack (B2)`

### B3：回传 KEY/BOOT + SHTC3
- [ ] `port_bsp/button_bsp`(multi_button) → KEY/BOOT 单击/长按/双击 `BUTTON` 帧。
- [ ] SensorLib SHTC3(I2C 13/14) 周期读 → `SENSOR` 帧（host 用于室内温湿度 + 叶/冰伊布门控）。
- [ ] **smoke(板)**：按键 host 收到对应事件；host 室内温湿度显真实值。
- [ ] commit `feat(fw): button + shtc3 uplink (B3)`

### B4：音频（ES8311）
- [ ] vendor `codec_board/codec_init`；`SOUND_LOAD`(PCM→PSRAM 缓存当前 buddy 叫声)、`PLAY(id)`(UI 音/叫声)。
- [ ] **smoke(板)**：host 发 PLAY → 出声；切 buddy → SOUND_LOAD+PLAY 出叫声。
- [ ] commit `feat(fw): es8311 audio play + sound_load (B4)`

---

## 测试策略
- **现在可跑(Bh, 纯 Node)**：proto/RLE/CRC/脏区 diff/transport ACK 全单测。
- **待板(B1–B4)**：无 host 测试运行器 → 逐里程碑**真机 smoke**(flash+monitor 日志+看屏/听音)；host↔固件靠共享 proto 常量 + Bh 单测 + B2 联调对齐。

## DoD
- [ ] Bh：`cd host && npm test` 含 proto/diff/transport 新测全绿；无板子 `npm start` 仍出 `out/frame.png`(回退 mock)。
- [ ] B1：板显写死测试帧。 B2：板显 host 实时仪表盘+buddy(与 frame.png 一致)，按键 ACK 正常。
- [ ] B3：按键事件 + 真实 SHTC3 室内温湿度回 host 上屏。 B4：PLAY/SOUND_LOAD 出声。
- [ ] `host 重启`/`设备拔插` 自动重连重刷。

## 与 spec 覆盖核对
§3 引脚/BSP ✓(B0/B1) · §10 链路(USB-CDC/脏区+RLE/ACK/重连) ✓(Bh/B2) · §4 音频 ✓(B4) · §7 KEY 触发进化(Plan A readyToEvolve + B3 真 KEY) ✓ · 室内温湿度真实化 ✓(B3)。留给 Plan C=dashboard；v1.5=音效池/全 Pokédex/麦克风。

## 风险 & 待解
- USB 物理层(TinyUSB CDC vs USB-Serial-JTAG)——B1 查 demo sdkconfig/main；host 认 VID 0x303A。
- 像素极性/横屏 LUT 边界——B2 真机校(极性一处取反兜底)。
- 大变化帧(进化全屏闪)脏区退化为全帧——可接受(15KB@原生 USB 毫秒级)。
- ES8311 采样率/格式、PCM PSRAM 容量——B4 据 codec_init 定。
- 官方 BSP C++/混用——vendor 进 ESP-IDF 注意 component CMake/依赖。

## 参考
官方 demo `github.com/waveshareteam/ESP32-S3-RLCD-4.2` → `02_Example/ESP-IDF/10_FactoryProgram`(`port_bsp`/`codec_board`/`SensorLib`)、`07_Audio_Test`、`08_LVGL_V8`/`11_U8G2`(显示)。引脚/驱动 `port_bsp/display_bsp.{h,cpp}` + `main/user_config.h`。契约见 spec §10 + 本计划 B0。
