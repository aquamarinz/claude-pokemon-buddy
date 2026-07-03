import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createMockTransport({
  framePath = "out/frame.png",
  sensor = { t: 23.4, h: 56 },
} = {}) {
  const buttons = new EventEmitter();

  return {
    async push(pngBuffer) {
      mkdirSync(dirname(framePath), { recursive: true });
      writeFileSync(framePath, pngBuffer);
      return { ok: true, path: framePath };
    },

    onButton(callback) {
      buttons.on("button", callback);
      return () => buttons.off("button", callback);
    },

    injectButton(key, kind = "short") {
      buttons.emit("button", { key, kind });
    },

    feedSensor() {
      return { ...sensor };
    },

    sendVolume() {},
  };
}
