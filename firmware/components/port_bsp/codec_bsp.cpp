#include "codec_bsp.h"

#include <esp_err.h>
#include <esp_log.h>

#include "codec_board.h"

static const char *TAG = "codec_bsp";

CodecPort::CodecPort(const char *board) {
    set_codec_board_type(board);
    codec_init_cfg_t cfg = {};
    cfg.in_mode    = CODEC_I2S_MODE_TDM;
    cfg.out_mode   = CODEC_I2S_MODE_TDM;
    cfg.in_use_tdm = false;
    cfg.reuse_dev  = false;
    esp_err_t err = init_codec(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "init_codec failed: %s; audio disabled", esp_err_to_name(err));
        playback_ = nullptr;
        return;
    }
    playback_ = get_playback_handle();
    if (!playback_) ESP_LOGE(TAG, "playback handle unavailable; audio disabled");
}

void CodecPort::open(int sample_rate, int channels, int bits) {
    if (!playback_) return;
    esp_codec_dev_sample_info_t fs = {};
    fs.sample_rate     = sample_rate;
    fs.channel         = channels;
    fs.bits_per_sample = bits;
    esp_err_t err = esp_codec_dev_open(playback_, &fs);
    if (err != ESP_OK) ESP_LOGE(TAG, "esp_codec_dev_open failed: %s; audio disabled", esp_err_to_name(err));
}

void CodecPort::set_volume(int vol) {
    if (!playback_) return;
    esp_codec_dev_set_out_vol(playback_, vol);
}

int CodecPort::write(const void *pcm, int len) {
    if (!playback_) return -1;
    return esp_codec_dev_write(playback_, (void *)pcm, len);
}
