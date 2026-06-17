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

test("pause/resume is reference-counted (nested pause stays paused)", async (t) => {
  const pushes = [];
  const animator = createBuddyAnimator({
    transport: { push: async () => { pushes.push(1); } },
    getModel: () => ({ buddy: {} }),
    render: (m) => ({ animPhase: m.buddy.animPhase }),
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
  });
  t.after(() => animator.stop()); // 红态断言抛出也能停掉自调度 loop，防泄漏
  animator.start();
  animator.pause();          // depth 1
  animator.pause();          // depth 2
  animator.resume();         // depth 1 → 仍暂停
  const before = pushes.length;
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(pushes.length, before); // 仍暂停
  animator.resume();         // depth 0 → 恢复
  for (let i = 0; i < 2; i += 1) await new Promise((r) => setImmediate(r));
  animator.stop();
  assert.ok(pushes.length > before);
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
