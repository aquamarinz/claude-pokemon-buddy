import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  shouldPlaySignature,
  shouldQueueButtonForTick,
  createActionQueue,
  createButtonDispatcher,
} from "../src/index.js";

test("KEY short on a non-evolving pet triggers signature", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, { readyToEvolve: false }), true);
});

test("readyToEvolve pet does NOT trigger signature (evolution owns KEY)", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, { readyToEvolve: true }), false);
});

test("long/double/boot presses do not trigger signature", () => {
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "long" }, { readyToEvolve: false }), false);
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "double" }, { readyToEvolve: false }), false);
  assert.equal(shouldPlaySignature({ key: "BOOT", kind: "short" }, { readyToEvolve: false }), false);
});

test("tick queue accepts KEY short/long/double and ignores unrelated buttons", () => {
  assert.equal(shouldQueueButtonForTick({ key: "KEY", kind: "short" }), true);
  assert.equal(shouldQueueButtonForTick({ key: "KEY", kind: "long" }), true);
  assert.equal(shouldQueueButtonForTick({ key: "KEY", kind: "double" }), true);
  assert.equal(shouldQueueButtonForTick({ key: "BOOT", kind: "short" }), false);
});

test("missing pet/event is safe (no trigger)", () => {
  assert.equal(shouldPlaySignature(undefined, undefined), false);                 // undefined!==false
  assert.equal(shouldPlaySignature({ key: "KEY", kind: "short" }, undefined), false);
});

test("action queue serializes: 2nd action starts only after 1st resolves", async () => {
  const q = createActionQueue();
  const log = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const a = q.run(async () => { log.push("a-start"); await gate; log.push("a-end"); });
  const b = q.run(async () => { log.push("b-start"); });
  await Promise.resolve();
  assert.deepEqual(log, ["a-start"]);                 // b 尚未开始 → tick 帧不会插进招牌
  release();
  await Promise.all([a, b]);
  assert.deepEqual(log, ["a-start", "a-end", "b-start"]);
});

test("dispatcher routes non-ready KEY-short to signature animation only", async () => {
  const transport = createButtonTransport();
  const model = { buddy: { species: "eevee" } };
  const signatures = [];
  const lifecycle = [];
  const runs = [];
  const dispatcher = createButtonDispatcher({
    transport,
    getPet: () => ({ readyToEvolve: false }),
    getModel: () => model,
    actions: {
      run(fn) {
        const result = fn();
        runs.push(result);
        return result;
      },
    },
    animator: {
      pause: () => lifecycle.push("pause"),
      resume: () => lifecycle.push("resume"),
    },
    playSignature: async ({ model: pressModel }) => {
      signatures.push(pressModel);
    },
  });

  transport.emitButton({ key: "KEY", kind: "short" });
  await Promise.all(runs);

  assert.deepEqual(signatures, [model]);
  assert.deepEqual(lifecycle, ["pause", "resume"]);
  assert.deepEqual(dispatcher.drainTickEvents(), []);
  dispatcher.stop();
  assert.equal(transport.listenerCount(), 0);
});

test("dispatcher drops rapid signature presses while one is in flight", async () => {
  const transport = createButtonTransport();
  const signatures = [];
  const runs = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const dispatcher = createButtonDispatcher({
    transport,
    getPet: () => ({ readyToEvolve: false }),
    getModel: () => ({ buddy: { species: "eevee" } }),
    actions: {
      run(fn) {
        const result = fn();
        runs.push(result);
        return result;
      },
    },
    playSignature: async () => {
      signatures.push("signature");
      await gate;
    },
  });

  transport.emitButton({ key: "KEY", kind: "short" });
  transport.emitButton({ key: "KEY", kind: "short" });
  transport.emitButton({ key: "KEY", kind: "short" });
  await Promise.resolve();

  assert.equal(signatures.length, 1);
  assert.deepEqual(dispatcher.drainTickEvents(), []);
  release();
  await Promise.all(runs);
  dispatcher.stop();
});

test("dispatcher queues ready KEY-short, long, and double presses for tick snapshots", () => {
  const transport = createButtonTransport();
  const dispatcher = createButtonDispatcher({
    transport,
    getPet: () => ({ readyToEvolve: true }),
  });

  transport.emitButton({ key: "KEY", kind: "short" });
  transport.emitButton({ key: "KEY", kind: "long" });
  transport.emitButton({ key: "KEY", kind: "double" });
  transport.emitButton({ key: "BOOT", kind: "short" });

  assert.deepEqual(dispatcher.drainTickEvents().map(({ kind }) => kind), ["short", "long", "double"]);
  dispatcher.stop();
});

test("dispatcher requeues a drained tick snapshot once without adding listeners", () => {
  const transport = createButtonTransport();
  const dispatcher = createButtonDispatcher({ transport });
  assert.equal(transport.listenerCount(), 1);

  transport.emitButton({ key: "KEY", kind: "long" });
  const firstDrain = dispatcher.drainTickEvents();
  assert.equal(firstDrain.length, 1);

  assert.equal(dispatcher.requeueForRetry(firstDrain), 1);
  assert.equal(transport.listenerCount(), 1);

  const retryDrain = dispatcher.drainTickEvents();
  assert.equal(retryDrain.length, 1);
  assert.equal(retryDrain[0].requeued, true);

  assert.equal(dispatcher.requeueForRetry(retryDrain), 0);
  assert.deepEqual(dispatcher.drainTickEvents(), []);
  dispatcher.stop();
  assert.equal(transport.listenerCount(), 0);
});

function createButtonTransport() {
  const emitter = new EventEmitter();
  return {
    onButton(callback) {
      emitter.on("button", callback);
      return () => emitter.off("button", callback);
    },
    emitButton(event) {
      emitter.emit("button", event);
    },
    listenerCount() {
      return emitter.listenerCount("button");
    },
  };
}
