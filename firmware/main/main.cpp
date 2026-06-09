// Claude Pokemon Buddy firmware - Milestone B1
//
// Minimal proof that our firmware can drive the Waveshare ESP32-S3-RLCD-4.2
// ST7305 panel via the vendored DisplayPort BSP. No USB protocol, no UI
// framework, no audio - those are later milestones. We just draw one
// hardcoded, deliberately ASYMMETRIC test pattern so that, looking at the
// physical panel, we can read off pixel addressing, orientation and mirroring
// (which corner the filled square lands in) - the info B2 needs to map the
// host's 400x300 frame correctly.

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <esp_log.h>

#include "display_bsp.h"

static const char *TAG = "buddy-b1";

// Landscape 400x300. Constructor args: (mosi, scl, dc, cs, rst, width, height).
// Global object: its constructor runs hardware init (SPI bus + PSRAM buffers)
// during C++ static init, mirroring the Waveshare factory firmware.
static DisplayPort RlcdPort(12, 11, 5, 40, 41, 400, 300);

static constexpr int W = 400;
static constexpr int H = 300;

static void draw_test_frame()
{
    RlcdPort.RLCD_ColorClear(ColorWhite);

    // 2px border around the full edge.
    for (int x = 0; x < W; ++x) {
        for (int t = 0; t < 2; ++t) {
            RlcdPort.RLCD_SetPixel(x, t, ColorBlack);
            RlcdPort.RLCD_SetPixel(x, H - 1 - t, ColorBlack);
        }
    }
    for (int y = 0; y < H; ++y) {
        for (int t = 0; t < 2; ++t) {
            RlcdPort.RLCD_SetPixel(t, y, ColorBlack);
            RlcdPort.RLCD_SetPixel(W - 1 - t, y, ColorBlack);
        }
    }

    // Both diagonals.
    for (int x = 0; x < W; ++x) {
        int y = (x * (H - 1)) / (W - 1);
        RlcdPort.RLCD_SetPixel(x, y, ColorBlack);
        RlcdPort.RLCD_SetPixel(x, H - 1 - y, ColorBlack);
    }

    // Solid 40x40 square in the TOP-LEFT corner ONLY (asymmetry marker).
    for (int y = 0; y < 40; ++y)
        for (int x = 0; x < 40; ++x)
            RlcdPort.RLCD_SetPixel(x, y, ColorBlack);

    RlcdPort.RLCD_Display();
}

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "B1: init ST7305 panel");
    RlcdPort.RLCD_Init();
    draw_test_frame();
    ESP_LOGI(TAG, "B1: test frame drawn, holding");

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
