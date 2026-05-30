import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createMockTransport } from "../src/transport/mock.js";

test("mock transport writes frame, loops buttons, and feeds fixed sensor data", async () => {
  const framePath = join("out", "test-mock-frame.png");
  rmSync(framePath, { force: true });
  const mock = createMockTransport({ framePath, sensor: { t: 22.5, h: 51 } });
  const events = [];
  const off = mock.onButton((event) => events.push(event));

  await mock.push(Buffer.from([1, 2, 3]));
  mock.injectButton("KEY", "short");

  assert.equal(existsSync(framePath), true);
  assert.deepEqual([...readFileSync(framePath)], [1, 2, 3]);
  assert.deepEqual(events, [{ key: "KEY", kind: "short" }]);
  assert.deepEqual(mock.feedSensor(), { t: 22.5, h: 51 });

  off();
  mock.injectButton("KEY", "long");
  assert.equal(events.length, 1);
});
