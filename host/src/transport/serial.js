import { EventEmitter } from "node:events";

import { SerialPort as NodeSerialPort } from "serialport";

import { decodeFrame, encodeFrame, MAGIC, T } from "./proto.js";

const ESPRESSIF_VID = "303A";
const DEFAULT_BAUD_RATE = 115200;
const DEFAULT_TIMEOUT_MS = 250;
const DEFAULT_MAX_RETRIES = 3;
const BUTTON_KEYS = new Map([
  [1, "KEY"],
  [2, "BOOT"],
]);
const BUTTON_KINDS = new Map([
  [1, "short"],
  [2, "long"],
  [3, "double"],
  [4, "down"],
  [5, "up"],
]);

export async function findEspPort({ SerialPort = NodeSerialPort } = {}) {
  const ports = await SerialPort.list();
  return ports.find((port) => normalizeVid(port.vendorId) === ESPRESSIF_VID)?.path ?? null;
}

export async function createSerialTransport({
  SerialPort = NodeSerialPort,
  baudRate = DEFAULT_BAUD_RATE,
  path,
  port,
  ...transportOptions
} = {}) {
  if (port) return makeTransport({ port, ...transportOptions });

  const serialPath = path ?? await findEspPort({ SerialPort });
  if (!serialPath) return null;
  return makeTransport({
    port: new SerialPort({ path: serialPath, baudRate }),
    ...transportOptions,
  });
}

export function makeTransport({
  port,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
} = {}) {
  if (!port) throw new Error("port is required");

  const events = new EventEmitter();
  const queue = [];
  let rx = new Uint8Array(0);
  let pending = null;
  let nextSeq = 0;
  let latestSensor = null;

  port.on?.("data", (chunk) => {
    rx = append(rx, chunk);
    readAvailableFrames();
  });

  function pushFrame(payload) {
    return new Promise((resolve, reject) => {
      queue.push({
        type: T.FRAME,
        payload: Uint8Array.from(payload),
        resolve,
        reject,
      });
      pump();
    });
  }

  function pump() {
    if (pending || queue.length === 0) return;
    pending = {
      ...queue.shift(),
      seq: nextSeq,
      sends: 0,
      timer: null,
    };
    nextSeq = (nextSeq + 1) & 0xff;
    sendPending();
  }

  function sendPending() {
    const current = pending;
    current.sends += 1;
    const bytes = encodeFrame({
      type: current.type,
      seq: current.seq,
      payload: current.payload,
    });
    port.write(bytes, (error) => {
      if (error && pending === current) failPending(error);
    });
    current.timer = setTimeout(() => {
      if (pending !== current) return;
      if (current.sends <= maxRetries) {
        sendPending();
        return;
      }
      finishPending({ ok: false, stale: true, seq: current.seq });
    }, timeoutMs);
  }

  function readAvailableFrames() {
    while (rx.length >= 5) {
      const magicOffset = rx.indexOf(MAGIC);
      if (magicOffset < 0) {
        rx = new Uint8Array(0);
        return;
      }
      if (magicOffset > 0) rx = rx.slice(magicOffset);
      if (rx.length < 5) return;

      const len = rx[3] | (rx[4] << 8);
      const frameLen = 5 + len + 4;
      if (rx.length < frameLen) return;

      const frameBytes = rx.slice(0, frameLen);
      rx = rx.slice(frameLen);
      try {
        handleFrame(decodeFrame(frameBytes));
      } catch {
        // Drop corrupt frames and keep scanning subsequent bytes.
      }
    }
  }

  function handleFrame(frame) {
    if (frame.type === T.ACK) {
      if (pending && ackSeq(frame) === pending.seq) {
        finishPending({ ok: true, seq: pending.seq });
      }
      return;
    }

    if (frame.type === T.NACK) {
      if (pending && ackSeq(frame) === pending.seq) sendPending();
      return;
    }

    if (frame.type === T.BUTTON) {
      events.emit("button", parseButton(frame.payload));
      return;
    }

    if (frame.type === T.SENSOR) {
      latestSensor = parseSensor(frame.payload);
      if (latestSensor) events.emit("sensor", latestSensor);
    }
  }

  function finishPending(result) {
    const current = pending;
    clearTimeout(current.timer);
    pending = null;
    current.resolve(result);
    pump();
  }

  function failPending(error) {
    const current = pending;
    clearTimeout(current.timer);
    pending = null;
    current.reject(error);
    pump();
  }

  return {
    pushFrame,
    onButton(callback) {
      events.on("button", callback);
      return () => events.off("button", callback);
    },
    onSensor(callback) {
      events.on("sensor", callback);
      return () => events.off("sensor", callback);
    },
    feedSensor() {
      return latestSensor ? { ...latestSensor } : null;
    },
    close() {
      clearTimeout(pending?.timer);
      port.close?.();
    },
  };
}

function normalizeVid(vendorId) {
  return String(vendorId ?? "").replace(/^0x/i, "").toUpperCase();
}

function append(a, b) {
  const chunk = Uint8Array.from(b);
  const out = new Uint8Array(a.length + chunk.length);
  out.set(a);
  out.set(chunk, a.length);
  return out;
}

function ackSeq(frame) {
  return frame.payload.length > 0 ? frame.payload[0] : frame.seq;
}

function parseButton(payload) {
  return {
    key: BUTTON_KEYS.get(payload[0]) ?? `KEY_${payload[0]}`,
    kind: BUTTON_KINDS.get(payload[1]) ?? `evt_${payload[1]}`,
  };
}

function parseSensor(payload) {
  if (payload.length < 3) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    t: view.getInt16(0, true) / 10,
    h: payload[2],
  };
}
