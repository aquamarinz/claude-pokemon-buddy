#include "codec_bsp.h"

#include <assert.h>
#include <esp_log.h>

#include "codec_board.h"

CodecPort::CodecPort(const char *board) {
    set_codec_board_type(board);
    codec_init_cfg_t cfg = {};
    cfg.in_mode    = CODEC_I2S_MODE_TDM;
    cfg.out_mode   = CODEC_I2S_MODE_TDM;
    cfg.in_use_tdm = false;
    cfg.reuse_dev  = false;
    ESP_ERROR_CHECK(init_codec(&cfg));
    playback_ = get_playback_handle();
    assert(playback_);
}

void CodecPort::open(int sample_rate, int channels, int bits) {
    esp_codec_dev_sample_info_t fs = {};
    fs.sample_rate     = sample_rate;
    fs.channel         = channels;
    fs.bits_per_sample = bits;
    esp_codec_dev_open(playback_, &fs);
}

void CodecPort::set_volume(int vol) {
    esp_codec_dev_set_out_vol(playback_, vol);
}

int CodecPort::write(const void *pcm, int len) {
    return esp_codec_dev_write(playback_, (void *)pcm, len);
}
