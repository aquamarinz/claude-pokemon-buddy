import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeFrame, encodeFrame, MAGIC, T } from "../src/transport/proto.js";
import { findEspPort, makeTransport } from "../src/transport/serial.js";

test("findEspPort returns first serial path with Espressif VID 303A", async () => {
  const SerialPort = {
    async list() {
      return [
        { path: "/dev/cu.other", vendorId: "10C4" },
        { path: "/dev/cu.usbmodem101", vendorId: "303a" },
      ];
    },
  };

  assert.equal(await findEspPort({ SerialPort }), "/dev/cu.usbmodem101");
});

test("pushFrame writes FRAME and resolves only after matching ACK", async () => {
  const port = new FakePort();
  const transport = makeTransport({ port, timeoutMs: 50, maxRetries: 0 });

  const sent = transport.pushFrame(Uint8Array.from([1, 2, 3]));
  assert.equal(port.writes.length, 1);
  const frame = decodeFrame(port.writes[0]);
  assert.equal(frame.type, T.FRAME);
  assert.equal(frame.seq, 0);
  assert.deepEqual([...frame.payload], [1, 2, 3]);

  let settled = false;
  sent.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  port.emitData(encodeFrame({ type: T.ACK, seq: frame.seq, payload: Uint8Array.from([frame.seq]) }));
  assert.deepEqual(await sent, { ok: true, seq: 0 });
});

test("pushFrame keeps later frames queued until the current frame is ACKed", async () => {
  const port = new FakePort();
  const transport = makeTransport({ port, timeoutMs: 50, maxRetries: 0 });

  const first = transport.pushFrame(Uint8Array.from([1]));
  const second = transport.pushFrame(Uint8Array.from([2]));
  assert.equal(port.writes.length, 1);

  const firstFrame = decodeFrame(port.writes[0]);
  port.emitData(encodeFrame({ type: T.ACK, seq: firstFrame.seq, payload: Uint8Array.from([firstFrame.seq]) }));
  assert.deepEqual(await first, { ok: true, seq: 0 });

  assert.equal(port.writes.length, 2);
  const secondFrame = decodeFrame(port.writes[1]);
  assert.equal(secondFrame.seq, 1);
  assert.deepEqual([...secondFrame.payload], [2]);

  port.emitData(encodeFrame({ type: T.ACK, seq: secondFrame.seq, payload: Uint8Array.from([secondFrame.seq]) }));
  assert.deepEqual(await second, { ok: true, seq: 1 });
});

test("incoming BUTTON and SENSOR frames dispatch callbacks", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  const buttons = [];
  const sensors = [];

  transport.onButton((event) => buttons.push(event));
  transport.onSensor((event) => sensors.push(event));
  port.emitData(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([1, 2]) }));
  port.emitData(encodeFrame({ type: T.SENSOR, seq: 10, payload: sensorPayload(234, 56) }));

  assert.deepEqual(buttons, [{ key: "KEY", kind: "long" }]);
  assert.deepEqual(sensors, [{ t: 23.4, h: 56 }]);
  assert.deepEqual(transport.feedSensor(), { t: 23.4, h: 56 });
});

test("pushFrame resends on timeout and resolves stale after max retries", async () => {
  const port = new FakePort();
  const transport = makeTransport({ port, timeoutMs: 5, maxRetries: 2 });

  const result = await transport.pushFrame(Uint8Array.from([9]));

  assert.equal(port.writes.length, 3);
  assert.deepEqual(result, { ok: false, stale: true, seq: 0 });
});

test("pushFrame resolves disconnected immediately after port close", async () => {
  const port = new FakePort();
  const transport = makeTransport({
    port,
    openPort: async () => null,
    reconnectDelayMs: 5,
  });

  port.emitClose();

  const result = await transport.pushFrame(Uint8Array.from([1]));

  assert.deepEqual(result, { ok: false, disconnected: true });
  assert.equal(port.writes.length, 0);
  transport.close();
});

test("pushFrame uses a reconnected port after close", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  const transport = makeTransport({
    port: port1,
    openPort: async () => port2,
    reconnectDelayMs: 5,
    timeoutMs: 50,
    maxRetries: 0,
  });

  port1.emitClose();
  await waitFor(() => port2.listenerCount("data") > 0);

  const sent = transport.pushFrame(Uint8Array.from([7]));
  assert.equal(port2.writes.length, 1);
  const frame = decodeFrame(port2.writes[0]);

  port2.emitData(encodeFrame({ type: T.ACK, seq: frame.seq, payload: Uint8Array.from([frame.seq]) }));

  assert.deepEqual(await sent, { ok: true, seq: 0 });
  transport.close();
});

test("onReconnect callback runs after automatic reconnect", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  const transport = makeTransport({
    port: port1,
    openPort: async () => port2,
    reconnectDelayMs: 5,
  });
  let reconnects = 0;

  const off = transport.onReconnect(() => {
    reconnects += 1;
  });
  port1.emitClose();

  await waitFor(() => reconnects === 1);
  assert.equal(reconnects, 1);
  off();
  transport.close();
});

test("automatic reconnect retries until openPort returns a port", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  let attempts = 0;
  const transport = makeTransport({
    port: port1,
    openPort: async () => {
      attempts += 1;
      return attempts < 3 ? null : port2;
    },
    reconnectDelayMs: 5,
    timeoutMs: 50,
    maxRetries: 0,
  });

  port1.emitClose();
  await waitFor(() => attempts >= 3 && port2.listenerCount("data") > 0);

  const sent = transport.pushFrame(Uint8Array.from([8]));
  const frame = decodeFrame(port2.writes[0]);
  port2.emitData(encodeFrame({ type: T.ACK, seq: frame.seq, payload: Uint8Array.from([frame.seq]) }));

  assert.deepEqual(await sent, { ok: true, seq: 0 });
  transport.close();
});

test("button and sensor callbacks remain active after reconnect", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  const transport = makeTransport({
    port: port1,
    openPort: async () => port2,
    reconnectDelayMs: 5,
  });
  const buttons = [];
  const sensors = [];

  transport.onButton((event) => buttons.push(event));
  transport.onSensor((event) => sensors.push(event));
  port1.emitClose();
  await waitFor(() => port2.listenerCount("data") > 0);

  port2.emitData(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([2, 5]) }));
  port2.emitData(encodeFrame({ type: T.SENSOR, seq: 10, payload: sensorPayload(187, 44) }));

  assert.deepEqual(buttons, [{ key: "BOOT", kind: "up" }]);
  assert.deepEqual(sensors, [{ t: 18.7, h: 44 }]);
  assert.deepEqual(transport.feedSensor(), { t: 18.7, h: 44 });
  transport.close();
});

test("close stops reconnect attempts", async () => {
  const port = new FakePort();
  let attempts = 0;
  const transport = makeTransport({
    port,
    openPort: async () => {
      attempts += 1;
      return null;
    },
    reconnectDelayMs: 5,
  });

  transport.close();
  port.emitClose();
  await sleep(20);

  assert.equal(attempts, 0);
});

test("write callback errors trigger reconnect instead of rejecting", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  let attempts = 0;
  port1.writeError = new Error("disconnected");
  const transport = makeTransport({
    port: port1,
    openPort: async () => {
      attempts += 1;
      return port2;
    },
    reconnectDelayMs: 5,
    timeoutMs: 50,
  });

  const result = await transport.pushFrame(Uint8Array.from([1]));

  assert.deepEqual(result, { ok: false, disconnected: true });
  await waitFor(() => attempts === 1);
  transport.close();
});

test("setActiveCry writes a CONFIG frame with the sound id", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  transport.setActiveCry(7);
  const frame = decodeFrame(port.writes.at(-1));
  assert.equal(frame.type, T.CONFIG);
  assert.equal(frame.seq, 0);
  assert.deepEqual([...frame.payload], [7]);
});

test("playSound write error triggers reconnect (M8)", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  let attempts = 0;
  port1.writeError = new Error("disconnected");
  const transport = makeTransport({
    port: port1,
    openPort: async () => { attempts += 1; return port2; },
    reconnectDelayMs: 5,
  });

  transport.playSound(2);
  await waitFor(() => attempts === 1);
  assert.equal(attempts, 1);
  transport.close();
});

test("setActiveCry write error triggers reconnect (M8)", async () => {
  const port1 = new FakePort();
  const port2 = new FakePort();
  let attempts = 0;
  port1.writeError = new Error("disconnected");
  const transport = makeTransport({
    port: port1,
    openPort: async () => { attempts += 1; return port2; },
    reconnectDelayMs: 5,
  });

  transport.setActiveCry(7);
  await waitFor(() => attempts === 1);
  assert.equal(attempts, 1);
  transport.close();
});

test("RX recovers from a stray MAGIC with a bogus length and still parses later frames (H3)", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  const buttons = [];
  transport.onButton((e) => buttons.push(e));

  // stray MAGIC + bogus huge length (0xFFFF), no real frame yet
  port.emitData(Uint8Array.from([MAGIC, T.BUTTON, 0x00, 0xff, 0xff]));
  // then a genuine BUTTON frame arrives
  port.emitData(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([1, 1]) }));

  assert.deepEqual(buttons, [{ key: "KEY", kind: "short" }]);
  transport.close();
});

test("RX resyncs past a bad-CRC frame to the next valid frame (H3)", () => {
  const port = new FakePort();
  const transport = makeTransport({ port });
  const buttons = [];
  transport.onButton((e) => buttons.push(e));

  const corrupt = Uint8Array.from(encodeFrame({ type: T.BUTTON, seq: 9, payload: Uint8Array.from([1, 1]) }));
  corrupt[corrupt.length - 1] ^= 0xff; // break the CRC
  port.emitData(corrupt);
  port.emitData(encodeFrame({ type: T.BUTTON, seq: 10, payload: Uint8Array.from([2, 2]) }));

  // corrupt frame dropped; the valid second frame is still delivered
  assert.deepEqual(buttons, [{ key: "BOOT", kind: "long" }]);
  transport.close();
});

class FakePort extends EventEmitter {
  writes = [];
  closed = false;
  writeError = null;

  write(bytes, callback) {
    this.writes.push(Uint8Array.from(bytes));
    callback?.(this.writeError);
    return true;
  }

  close() {
    this.closed = true;
  }

  emitData(bytes) {
    this.emit("data", Buffer.from(bytes));
  }

  emitClose() {
    this.emit("close");
  }

  emitError(error = new Error("serial error")) {
    this.emit("error", error);
  }
}

function sensorPayload(tempTenths, humidity) {
  const payload = new Uint8Array(3);
  const view = new DataView(payload.buffer);
  view.setInt16(0, tempTenths, true);
  payload[2] = humidity;
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await sleep(2);
  }
  assert.equal(predicate(), true);
}
