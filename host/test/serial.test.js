import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeFrame, encodeFrame, T } from "../src/transport/proto.js";
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

class FakePort extends EventEmitter {
  writes = [];

  write(bytes, callback) {
    this.writes.push(Uint8Array.from(bytes));
    callback?.();
    return true;
  }

  emitData(bytes) {
    this.emit("data", Buffer.from(bytes));
  }
}

function sensorPayload(tempTenths, humidity) {
  const payload = new Uint8Array(3);
  const view = new DataView(payload.buffer);
  view.setInt16(0, tempTenths, true);
  payload[2] = humidity;
  return payload;
}
