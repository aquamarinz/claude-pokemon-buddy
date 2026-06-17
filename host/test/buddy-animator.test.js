import { test } from "node:test";
import assert from "node:assert/strict";

import { createBuddyAnimator } from "../src/render/buddy-animator.js";

const tick = () => new Promise((r) => setImmediate(r));

test("animator pushes frames with incrementing animPhase while running", async () => {
  const pushes = [];
  let phase = -1;
  const animator = createBuddyAnimator({
    transport: { push: async (f) => { pushes.push(f.animPhase); } },
    getModel: () => ({ buddy: {} }),
    render: (m) => { phase = m.buddy.animPhase; return { animPhase: m.buddy.animPhase }; },
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  animator.start();
  for (let i = 0; i < 4; i += 1) await tick();
  animator.stop();
  assert.ok(pushes.length >= 3);
  assert.deepEqual(pushes.slice(0, 3), [0, 1, 2]); // animPhase 递增
});

test("paused animator does not push; resumes after resume()", async () => {
  const pushes = [];
  const animator = createBuddyAnimator({
    transport: { push: async () => { pushes.push(1); } },
    getModel: () => ({ buddy: {} }),
    render: (m) => ({ animPhase: m.buddy.animPhase }),
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  animator.start();
  animator.pause();
  const before = pushes.length;
  for (let i = 0; i < 3; i += 1) await tick();
  assert.equal(pushes.length, before); // pause 期间不推
  animator.resume();
  for (let i = 0; i < 2; i += 1) await tick();
  animator.stop();
  assert.ok(pushes.length > before); // resume 后恢复
});

test("animator skips a frame when getModel returns null (no model yet)", async () => {
  const pushes = [];
  const animator = createBuddyAnimator({
    transport: { push: async () => { pushes.push(1); } },
    getModel: () => null,
    render: () => ({}),
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  animator.start();
  for (let i = 0; i < 3; i += 1) await tick();
  animator.stop();
  assert.equal(pushes.length, 0); // 无 model 不推
});
