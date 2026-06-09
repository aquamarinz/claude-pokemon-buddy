// Claude Pokemon Buddy firmware - Milestone B2
//
// Receive 1bpp frames from the host over USB-Serial-JTAG, decode the
// dirty-rect + RLE wire format (matching host/src/transport/proto.js and
// encodeDirtyPayload in transport/index.js), blit to the ST7305 panel, and
// ACK each frame so the host's stop-and-wait sender advances.
//
// Wire format (little-endian), mirroring the host exactly:
//   frame = [0xA5][type][seq][len_lo][len_hi][payload...][crc32 LE]
//           crc32 covers header+payload (the first 5+len bytes), poly 0xEDB88320.
//   FRAME payload (type 0x01) = [x u16][y u16][w u16][h u16][RLE bytes]
//     RLE = (count,value) pairs; decoded = row-major 1bpp, ceil(w/8) bytes/row,
//     bit 7 = leftmost pixel, bit 1 = ink (black).
//   ACK (type 0x84) back to host: payload = [acked_seq].

#include <assert.h>
#include <string.h>

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <esp_log.h>
#include <esp_heap_caps.h>
#include "driver/usb_serial_jtag.h"

#include "display_bsp.h"

static const char *TAG = "buddy-b2";

// ---- Panel -----------------------------------------------------------------
static constexpr int W = 400;
static constexpr int H = 300;
// Global: constructor runs SPI + PSRAM init during C++ static init (factory pattern).
static DisplayPort RlcdPort(12, 11, 5, 40, 41, W, H);

// ---- Protocol --------------------------------------------------------------
static constexpr uint8_t MAGIC = 0xA5;
static constexpr uint8_t T_FRAME = 0x01;
static constexpr uint8_t T_ACK   = 0x84;

static constexpr size_t RX_MAX   = 48 * 1024;     // > largest valid frame (~30KB)
static constexpr size_t RECT_MAX = (W * H) / 8;   // 15000B = full-screen 1bpp

static uint8_t *rxbuf = nullptr;                  // frame accumulation (PSRAM)
static size_t   rxlen = 0;
static uint8_t *rectbuf = nullptr;                // RLE-decoded rect (PSRAM)

static uint32_t crc32(const uint8_t *b, size_t n)
{
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) {
        c ^= b[i];
        for (int k = 0; k < 8; k++)
            c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}

static void send_ack(uint8_t seq)
{
    uint8_t f[10];
    f[0] = MAGIC; f[1] = T_ACK; f[2] = seq; f[3] = 1; f[4] = 0;
    f[5] = seq;                                   // payload[0] = acked seq
    uint32_t c = crc32(f, 6);
    f[6] = c & 0xff; f[7] = (c >> 8) & 0xff; f[8] = (c >> 16) & 0xff; f[9] = (c >> 24) & 0xff;
    usb_serial_jtag_write_bytes(f, sizeof(f), pdMS_TO_TICKS(100));
}

// Decode a FRAME payload (dirty-rect header + RLE) and blit it. Returns true
// only when the payload is well-formed and fully applied.
static bool handle_frame_payload(const uint8_t *p, size_t len)
{
    if (len < 8) return false;
    uint16_t x = p[0] | (p[1] << 8);
    uint16_t y = p[2] | (p[3] << 8);
    uint16_t w = p[4] | (p[5] << 8);
    uint16_t h = p[6] | (p[7] << 8);
    if (w == 0 || h == 0 || (int)(x + w) > W || (int)(y + h) > H) return false;

    const size_t rectRowBytes = (w + 7) / 8;      // w is multiple of 8
    const size_t need = rectRowBytes * h;
    if (need > RECT_MAX) return false;

    // RLE decode payload[8..] into rectbuf.
    size_t out = 0;
    for (size_t i = 8; i + 1 < len; i += 2) {
        uint8_t count = p[i];
        uint8_t value = p[i + 1];
        if (out + count > need) return false;     // overrun guard
        memset(rectbuf + out, value, count);
        out += count;
    }
    if (out != need) return false;                // size mismatch -> drop

    // Blit: host bit 1 = ink -> ColorBlack, 0 = paper -> ColorWhite.
    for (uint16_t row = 0; row < h; row++) {
        const uint8_t *r = rectbuf + (size_t)row * rectRowBytes;
        for (uint16_t col = 0; col < w; col++) {
            uint8_t bit = (r[col >> 3] >> (7 - (col & 7))) & 1;
            RlcdPort.RLCD_SetPixel(x + col, y + row, bit ? ColorBlack : ColorWhite);
        }
    }
    RlcdPort.RLCD_Display();                       // blocks until SPI transfer done
    return true;
}

// Parse all complete frames currently in rxbuf, consuming them.
static void parse_frames(void)
{
    size_t pos = 0;
    while (rxlen - pos >= 5) {
        if (rxbuf[pos] != MAGIC) { pos++; continue; }          // resync to MAGIC
        uint16_t len = rxbuf[pos + 3] | (rxbuf[pos + 4] << 8);
        if (len > RX_MAX) { pos++; continue; }                 // implausible -> skip
        size_t frameLen = 5 + (size_t)len + 4;
        if (rxlen - pos < frameLen) break;                     // wait for more bytes
        const uint8_t *f = rxbuf + pos;
        uint32_t got = f[5 + len] | (f[5 + len + 1] << 8) |
                       (f[5 + len + 2] << 16) | ((uint32_t)f[5 + len + 3] << 24);
        if (crc32(f, 5 + len) == got) {
            if (f[1] == T_FRAME && handle_frame_payload(f + 5, len))
                send_ack(f[2]);                                // ACK only on success
            pos += frameLen;
        } else {
            pos++;                                             // bad CRC -> resync
        }
    }
    if (pos > 0) {                                             // drop consumed bytes
        memmove(rxbuf, rxbuf + pos, rxlen - pos);
        rxlen -= pos;
    }
}

static void rx_task(void *arg)
{
    uint8_t tmp[1024];
    for (;;) {
        int n = usb_serial_jtag_read_bytes(tmp, sizeof(tmp), pdMS_TO_TICKS(100));
        if (n <= 0) continue;
        if (rxlen + (size_t)n > RX_MAX) rxlen = 0;             // overflow safety: resync
        if ((size_t)n > RX_MAX) n = RX_MAX;
        memcpy(rxbuf + rxlen, tmp, n);
        rxlen += n;
        parse_frames();
    }
}

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "B2: init ST7305 panel");
    RlcdPort.RLCD_Init();
    RlcdPort.RLCD_ColorClear(ColorWhite);
    // Boot/alive marker (bottom-right): proves firmware is up + waiting for host.
    // The host's first full-screen frame overwrites it.
    for (int yy = H - 12; yy < H - 4; yy++)
        for (int xx = W - 12; xx < W - 4; xx++)
            RlcdPort.RLCD_SetPixel(xx, yy, ColorBlack);
    RlcdPort.RLCD_Display();

    rxbuf   = (uint8_t *) heap_caps_malloc(RX_MAX, MALLOC_CAP_SPIRAM);
    rectbuf = (uint8_t *) heap_caps_malloc(RECT_MAX, MALLOC_CAP_SPIRAM);
    assert(rxbuf && rectbuf);

    usb_serial_jtag_driver_config_t cfg = {
        .tx_buffer_size = 1024,
        .rx_buffer_size = 4096,
    };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&cfg));

    ESP_LOGI(TAG, "B2: usb-serial-jtag up, waiting for host frames");
    xTaskCreate(rx_task, "rx", 8192, nullptr, 6, nullptr);
}
