# 固件发布手册（owner，Mac）

朋友侧安装依赖 GitHub Release 的预编译合并固件。固件极少变更，流程手动执行（YAGNI，不建 CI）。

## 1. 构建

```bash
cd firmware
idf.py build
```

## 2. 合并为单文件（0x0 起烧）

```bash
cd build   # 以下第 3、4 节命令都在 firmware/build 目录执行
# 实测（2026-07-06）：先 source ~/esp/esp-idf/export.sh；IDF 5.4 env 内是 esptool v4，
# 子命令用下划线 merge_bin；系统 esptool v5 则是连字符 merge-bin，二选一均可
python -m esptool --chip esp32s3 merge_bin -o cpb-firmware-merged.bin @flash_args
```

> `flash_args` 是 idf.py build 生成的烧录参数清单（含 bootloader/分区表/app 的偏移），merge_bin 直接消费它，偏移永不手抄。

## 3. 空白态实测（发布前必做）

```bash
esptool --chip esp32s3 --port /dev/cu.usbmodem1301 erase-flash
esptool --chip esp32s3 --port /dev/cu.usbmodem1301 write-flash 0x0 cpb-firmware-merged.bin
```

预期：`Hash of data verified`；设备重启后屏幕出待机画面；host 连上后功能正常（注意先停本机 host 释放串口）。

## 4. 发布

```bash
# 仍在 firmware/build 目录（接第 3 节）；换目录则改用对应绝对路径
gh release create fw-v1 cpb-firmware-merged.bin \
  --title "Firmware v1" \
  --notes "目标板：Waveshare ESP32-S3-RLCD-4.2。烧录：esptool --chip esp32s3 --port COMx write-flash 0x0 cpb-firmware-merged.bin"
```

> SETUP-WINDOWS.md 用 `releases/latest/download/cpb-firmware-merged.bin` 固定 URL 取**最新** Release 的同名资产——资产文件名必须保持 `cpb-firmware-merged.bin` 不变；后续版本换 tag（fw-v2…）即可。
