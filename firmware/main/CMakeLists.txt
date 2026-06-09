idf_component_register(
    SRCS "main.cpp"
    INCLUDE_DIRS "."
    REQUIRES port_bsp esp_driver_usb_serial_jtag driver esp_timer
)
