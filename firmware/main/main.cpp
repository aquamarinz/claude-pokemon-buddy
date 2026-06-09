// Claude Pokemon Buddy firmware - Milestone B3
//
// Builds on B2 (host -> device 1bpp frame rx + blit + ack) by adding the
// device -> host uplink: periodic SHTC3 room temp/humidity (SENSOR frames) and
// KEY/BOOT button events (BUTTON frames). Wire format matches the host exactly
// (host/src/transport/proto.js + serial.js):
//
//   frame = [0xA5][type][seq][len_lo][len_hi][payload...][crc32 LE]
//           crc32 covers header+payload (first 5+len bytes), poly 0xEDB88320.
//   FRAME  0x01 (in)  = [x u16][y u16][w u16][h u16][RLE bytes]   -> blit
//   ACK    0x84 (out) = [acked_seq]                               (host matches seq)
//   SENSOR 0x83 (out) = [temp i16 LE, units 0.1C][humidity u8 %]  (seq ignored by host)
//   BUTTON 0x82 (out) = [key_id][kind_id]   key 1=KEY/2=BOOT, kind 1=short/2=long/3=double
//
// Uplink frames are fire-and-forget: the host emits events on them without
// ACKing, so we never wait. All USB-Serial-JTAG writes go through send_frame()
// under tx_mutex so concurrent ACK / SENSOR / BUTTON frames never interleave.

#include <assert.h>
#include <math.h>
#include <string.h>

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <driver/gpio.h>
#include <esp_timer.h>
#include <esp_log.h>
#include <esp_heap_caps.h>
#include "driver/usb_serial_jtag.h"

#include "display_bsp.h"
#include "shtc3.h"
#include "multi_button.h"

static const char *TAG = "buddy-b3";

// ---- Panel + sensor (constructed during C++ static init, on the main task) -
static constexpr int W = 400;
static constexpr int H = 300;
static DisplayPort RlcdPort(12, 11, 5, 40, 41, W, H);

static constexpr int I2C_SCL = 14;
static constexpr int I2C_SDA = 13;
// I2C + SHTC3 are built in app_main, NOT during C++ static init: the new-style
// i2c_master driver allocates an interrupt, which isn't reliably available when
// global constructors run, so constructing here boot-loops the device. (The SPI
// panel above happens to tolerate static-init construction; I2C does not.)
static I2cMasterBus *g_bus = nullptr;
static Shtc3 *g_sensor = nullptr;

// ---- Buttons ---------------------------------------------------------------
static constexpr int KEY_GPIO  = 18;   // board "KEY"  -> host key_id 1
static constexpr int BOOT_GPIO = 0;    // board "BOOT" -> host key_id 2
static constexpr uint8_t KEY_ID_KEY  = 1;
static constexpr uint8_t KEY_ID_BOOT = 2;
static constexpr uint8_t KIND_SHORT  = 1;
static constexpr uint8_t KIND_LONG   = 2;
static constexpr uint8_t KIND_DOUBLE = 3;

// ---- Protocol --------------------------------------------------------------
static constexpr uint8_t MAGIC    = 0xA5;
static constexpr uint8_t T_FRAME  = 0x01;
static constexpr uint8_t T_BUTTON = 0x82;
static constexpr uint8_t T_SENSOR = 0x83;
static constexpr uint8_t T_ACK    = 0x84;

static constexpr size_t RX_MAX   = 48 * 1024;     // > largest valid frame (~30KB)
static constexpr size_t RECT_MAX = (W * H) / 8;   // 15000B = full-screen 1bpp
static constexpr uint32_t SENSOR_PERIOD_MS = 30000;

static uint8_t *rxbuf = nullptr;                  // frame accumulation (PSRAM)
static size_t   rxlen = 0;
static uint8_t *rectbuf = nullptr;                // RLE-decoded rect (PSRAM)

static SemaphoreHandle_t tx_mutex = nullptr;      // serializes USJ writes
static QueueHandle_t     btn_queue = nullptr;     // button events -> button_task

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

// Build [MAGIC|type|seq|len(2)|payload|crc32] and write it atomically.
static void send_frame(uint8_t type, uint8_t seq, const uint8_t *payload, uint8_t len)
{
    uint8_t f[5 + 64 + 4];
    if (len > 64) return;
    f[0] = MAGIC; f[1] = type; f[2] = seq; f[3] = len; f[4] = 0;
    if (len) memcpy(f + 5, payload, len);
    uint32_t c = crc32(f, 5 + len);
    f[5 + len]     = c & 0xff;
    f[5 + len + 1] = (c >> 8) & 0xff;
    f[5 + len + 2] = (c >> 16) & 0xff;
    f[5 + len + 3] = (c >> 24) & 0xff;
    xSemaphoreTake(tx_mutex, portMAX_DELAY);
    usb_serial_jtag_write_bytes(f, 5 + (size_t)len + 4, pdMS_TO_TICKS(100));
    xSemaphoreGive(tx_mutex);
}

static void send_ack(uint8_t seq)
{
    send_frame(T_ACK, seq, &seq, 1);              // payload[0] = acked seq
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

    size_t out = 0;
    for (size_t i = 8; i + 1 < len; i += 2) {
        uint8_t count = p[i];
        uint8_t value = p[i + 1];
        if (out + count > need) return false;     // overrun guard
        memset(rectbuf + out, value, count);
        out += count;
    }
    if (out != need) return false;                // size mismatch -> drop

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

static void parse_frames(void)
{
    size_t pos = 0;
    while (rxlen - pos >= 5) {
        if (rxbuf[pos] != MAGIC) { pos++; continue; }
        uint16_t len = rxbuf[pos + 3] | (rxbuf[pos + 4] << 8);
        if (len > RX_MAX) { pos++; continue; }
        size_t frameLen = 5 + (size_t)len + 4;
        if (rxlen - pos < frameLen) break;
        const uint8_t *f = rxbuf + pos;
        uint32_t got = f[5 + len] | (f[5 + len + 1] << 8) |
                       (f[5 + len + 2] << 16) | ((uint32_t)f[5 + len + 3] << 24);
        if (crc32(f, 5 + len) == got) {
            if (f[1] == T_FRAME && handle_frame_payload(f + 5, len))
                send_ack(f[2]);                    // ACK only on success
            pos += frameLen;
        } else {
            pos++;                                 // bad CRC -> resync
        }
    }
    if (pos > 0) {
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
        if (rxlen + (size_t)n > RX_MAX) rxlen = 0;
        if ((size_t)n > RX_MAX) n = RX_MAX;
        memcpy(rxbuf + rxlen, tmp, n);
        rxlen += n;
        parse_frames();
    }
}

// Read SHTC3 every SENSOR_PERIOD_MS and uplink a SENSOR frame. First read runs
// immediately so the host's "room" field stops showing -- within a few seconds.
static void sensor_task(void *arg)
{
    for (;;) {
        float t, h;
        if (g_sensor->read(&t, &h)) {
            int16_t ti = (int16_t)lroundf(t * 10.0f);
            uint8_t p[3] = { (uint8_t)(ti & 0xff), (uint8_t)((ti >> 8) & 0xff),
                             (uint8_t)lroundf(h) };
            send_frame(T_SENSOR, 0, p, sizeof(p));
            ESP_LOGI(TAG, "sensor %.1fC %.0f%%", t, (double)h);
        } else {
            ESP_LOGW(TAG, "sensor read failed");
        }
        vTaskDelay(pdMS_TO_TICKS(SENSOR_PERIOD_MS));
    }
}

static void button_task(void *arg)
{
    uint16_t ev;                                   // (key_id << 8) | kind_id
    for (;;) {
        if (xQueueReceive(btn_queue, &ev, portMAX_DELAY) == pdTRUE) {
            uint8_t p[2] = { (uint8_t)(ev >> 8), (uint8_t)(ev & 0xff) };
            send_frame(T_BUTTON, 0, p, sizeof(p));
            ESP_LOGI(TAG, "button key=%u kind=%u", p[0], p[1]);
        }
    }
}

// ---- multi_button glue (runs on the esp_timer task; only enqueues) ---------
static Button KeyBtn;
static Button BootBtn;

static uint8_t read_btn(uint8_t button_id)
{
    return gpio_get_level(button_id == KEY_ID_KEY ? (gpio_num_t)KEY_GPIO
                                                  : (gpio_num_t)BOOT_GPIO);
}

static void btn_emit(uint8_t key_id, uint8_t kind_id)
{
    uint16_t ev = ((uint16_t)key_id << 8) | kind_id;
    xQueueSend(btn_queue, &ev, 0);                 // drop if full; events are advisory
}

static void on_key_single(Button *)  { btn_emit(KEY_ID_KEY,  KIND_SHORT);  }
static void on_key_double(Button *)  { btn_emit(KEY_ID_KEY,  KIND_DOUBLE); }
static void on_key_long(Button *)    { btn_emit(KEY_ID_KEY,  KIND_LONG);   }
static void on_boot_single(Button *) { btn_emit(KEY_ID_BOOT, KIND_SHORT);  }
static void on_boot_double(Button *) { btn_emit(KEY_ID_BOOT, KIND_DOUBLE); }
static void on_boot_long(Button *)   { btn_emit(KEY_ID_BOOT, KIND_LONG);   }

static void btn_tick_cb(void *) { button_ticks(); }

static void buttons_init(void)
{
    gpio_config_t gc = {};
    gc.mode         = GPIO_MODE_INPUT;
    gc.pin_bit_mask = (1ULL << KEY_GPIO) | (1ULL << BOOT_GPIO);
    gc.pull_up_en   = GPIO_PULLUP_ENABLE;
    ESP_ERROR_CHECK_WITHOUT_ABORT(gpio_config(&gc));

    button_init(&KeyBtn, read_btn, 0, KEY_ID_KEY);     // active low
    button_attach(&KeyBtn, BTN_SINGLE_CLICK,     on_key_single);
    button_attach(&KeyBtn, BTN_DOUBLE_CLICK,     on_key_double);
    button_attach(&KeyBtn, BTN_LONG_PRESS_START, on_key_long);
    button_start(&KeyBtn);

    button_init(&BootBtn, read_btn, 0, KEY_ID_BOOT);
    button_attach(&BootBtn, BTN_SINGLE_CLICK,     on_boot_single);
    button_attach(&BootBtn, BTN_DOUBLE_CLICK,     on_boot_double);
    button_attach(&BootBtn, BTN_LONG_PRESS_START, on_boot_long);
    button_start(&BootBtn);

    esp_timer_create_args_t targs = {};
    targs.callback = btn_tick_cb;
    targs.name     = "btn_tick";
    esp_timer_handle_t th = nullptr;
    ESP_ERROR_CHECK(esp_timer_create(&targs, &th));
    ESP_ERROR_CHECK(esp_timer_start_periodic(th, 5000));   // 5ms tick (multi_button)
}

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "B3: init ST7305 panel");
    RlcdPort.RLCD_Init();
    RlcdPort.RLCD_ColorClear(ColorWhite);
    // Boot/alive marker (bottom-right): proves firmware is up + waiting for host.
    for (int yy = H - 12; yy < H - 4; yy++)
        for (int xx = W - 12; xx < W - 4; xx++)
            RlcdPort.RLCD_SetPixel(xx, yy, ColorBlack);
    RlcdPort.RLCD_Display();

    rxbuf   = (uint8_t *) heap_caps_malloc(RX_MAX, MALLOC_CAP_SPIRAM);
    rectbuf = (uint8_t *) heap_caps_malloc(RECT_MAX, MALLOC_CAP_SPIRAM);
    assert(rxbuf && rectbuf);

    tx_mutex  = xSemaphoreCreateMutex();
    btn_queue = xQueueCreate(8, sizeof(uint16_t));
    assert(tx_mutex && btn_queue);

    usb_serial_jtag_driver_config_t cfg = {
        .tx_buffer_size = 1024,
        .rx_buffer_size = 4096,
    };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&cfg));

    ESP_LOGI(TAG, "B3: usb-serial-jtag up; rx frames + button uplink");
    // rx + button first so downlink/ACK and button uplink stay alive regardless
    // of the I2C sensor's state.
    xTaskCreate(rx_task,     "rx",     8192, nullptr, 6, nullptr);
    xTaskCreate(button_task, "btnup",  3072, nullptr, 5, nullptr);
    buttons_init();

    // I2C/SHTC3 deferred out of static init (see g_bus note). Sensor uplink last.
    g_bus    = new I2cMasterBus(I2C_SCL, I2C_SDA, 0);
    g_sensor = new Shtc3(*g_bus);
    xTaskCreate(sensor_task, "sensor", 3072, nullptr, 4, nullptr);
    ESP_LOGI(TAG, "B3: sensor up");
}
