// ES8311 speaker playback via the codec_board framework. The mic/ES7210/echo
// paths and embedded-music helpers from Waveshare's reference BSP are dropped —
// the buddy only needs to chirp. codec_board's init_codec owns the codec's I2C
// control bus and *reuses* the bus our SHTC3 already created (see codec_init.c
// `_i2c_init`), so this wrapper never touches I2C directly.

#ifndef CODEC_BSP_H
#define CODEC_BSP_H

#include "codec_init.h"   // codec_init_cfg_t, init_codec, esp_codec_dev_handle_t

class CodecPort {
public:
    explicit CodecPort(const char *board);
    void open(int sample_rate, int channels, int bits);
    void set_volume(int vol);                  // 0..100
    int  write(const void *pcm, int len);      // bytes; blocks until pushed to I2S

private:
    esp_codec_dev_handle_t playback_ = nullptr;
};

#endif
