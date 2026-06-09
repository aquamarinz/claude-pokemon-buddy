idf_component_register(
    SRCS "display_bsp.cpp" "shtc3.cpp" "multi_button.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_lcd esp_driver_i2c esp_timer
)
