#include "shtc3.h"

#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <esp_log.h>

static const char *TAG = "shtc3";

// SHTC3 16-bit commands, sent big-endian on the wire.
static constexpr uint16_t CMD_WAKEUP      = 0x3517;
static constexpr uint16_t CMD_SLEEP       = 0xB098;
static constexpr uint16_t CMD_SOFT_RESET  = 0x805D;
static constexpr uint16_t CMD_MEAS_T_RH   = 0x7866;  // T first, clock-stretch off
static constexpr uint8_t  SHTC3_ADDR      = 0x70;
static constexpr uint8_t  CRC8_POLY       = 0x31;    // SHT CRC-8 (x^8+x^5+x^4+1)
static constexpr float    SELF_HEAT_COMP  = 4.0f;    // Waveshare's self-heating offset (°C)

I2cMasterBus::I2cMasterBus(int scl_pin, int sda_pin, int i2c_port) {
    i2c_master_bus_config_t cfg = {};
    cfg.clk_source                   = I2C_CLK_SRC_DEFAULT;
    cfg.i2c_port                     = (i2c_port_t)i2c_port;
    cfg.scl_io_num                   = (gpio_num_t)scl_pin;
    cfg.sda_io_num                   = (gpio_num_t)sda_pin;
    cfg.glitch_ignore_cnt            = 7;
    cfg.flags.enable_internal_pullup = true;
    ESP_ERROR_CHECK(i2c_new_master_bus(&cfg, &bus_));
}

Shtc3::Shtc3(I2cMasterBus &bus) {
    i2c_device_config_t dev = {};
    dev.dev_addr_length = I2C_ADDR_BIT_LEN_7;
    dev.device_address  = SHTC3_ADDR;
    dev.scl_speed_hz    = 400000;
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus.handle(), &dev, &dev_));

    cmd(CMD_WAKEUP);
    cmd(CMD_SOFT_RESET);
    vTaskDelay(pdMS_TO_TICKS(20));
    cmd(CMD_SLEEP);
}

bool Shtc3::cmd(uint16_t c) {
    uint8_t b[2] = {(uint8_t)(c >> 8), (uint8_t)(c & 0xff)};
    return i2c_master_transmit(dev_, b, sizeof(b), pdMS_TO_TICKS(100)) == ESP_OK;
}

static uint8_t crc8(const uint8_t *d, int n) {
    uint8_t crc = 0xFF;
    for (int i = 0; i < n; i++) {
        crc ^= d[i];
        for (int b = 0; b < 8; b++)
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ CRC8_POLY) : (uint8_t)(crc << 1);
    }
    return crc;
}

bool Shtc3::read(float *temp_c, float *rh_pct) {
    if (!cmd(CMD_WAKEUP)) return false;
    vTaskDelay(pdMS_TO_TICKS(1));
    if (!cmd(CMD_MEAS_T_RH)) {
        cmd(CMD_SLEEP);
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(20));  // max conversion time

    uint8_t raw[6] = {0};
    bool ok = i2c_master_receive(dev_, raw, sizeof(raw), pdMS_TO_TICKS(100)) == ESP_OK;
    cmd(CMD_SLEEP);  // always re-sleep, even on read error
    if (!ok) return false;

    if (crc8(raw, 2) != raw[2] || crc8(raw + 3, 2) != raw[5]) {
        ESP_LOGW(TAG, "crc mismatch");
        return false;
    }

    uint16_t raw_t = (raw[0] << 8) | raw[1];
    uint16_t raw_h = (raw[3] << 8) | raw[4];
    *temp_c = 175.0f * raw_t / 65536.0f - 45.0f - SELF_HEAT_COMP;
    *rh_pct = 100.0f * raw_h / 65536.0f;
    return true;
}
