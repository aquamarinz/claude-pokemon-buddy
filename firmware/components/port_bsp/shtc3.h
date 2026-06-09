// SHTC3 temperature/humidity over I2C — trimmed from Waveshare's i2c_bsp +
// i2c_equipment (RTC / SensorLib stripped). The I2cMasterBus wrapper is kept
// separate so B4's ES8311 codec can add its own device onto the same bus.

#ifndef SHTC3_H
#define SHTC3_H

#include <driver/i2c_master.h>

// Thin owner of one I2C master controller (new IDF i2c_master API).
class I2cMasterBus {
public:
    I2cMasterBus(int scl_pin, int sda_pin, int i2c_port);
    i2c_master_bus_handle_t handle() const { return bus_; }

private:
    i2c_master_bus_handle_t bus_ = nullptr;
};

// SHTC3 sensor (fixed I2C addr 0x70). read() returns false on bus error or a
// failed CRC so the caller can simply skip uplink for that tick.
class Shtc3 {
public:
    explicit Shtc3(I2cMasterBus &bus);
    bool read(float *temp_c, float *rh_pct);

private:
    bool cmd(uint16_t c);
    i2c_master_dev_handle_t dev_ = nullptr;
};

#endif
