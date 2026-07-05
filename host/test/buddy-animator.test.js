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

test("animator throttles consecutive render failure warnings", async (t) => {
  let attempts = 0;
  const warnings = [];
  const animator = createBuddyAnimator({
    transport: { push: async () => {} },
    getModel: () => ({ buddy: {} }),
    render: () => {
      attempts += 1;
      throw new Error("render failed");
    },
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
    logger: { warn: (...args) => warnings.push(args) },
  });
  t.after(() => animator.stop());

  animator.start();
  await waitFor(() => attempts >= 60);
  animator.stop();

  assert.ok(warnings.length >= 1);
  assert.ok(warnings.length <= 3);
  assert.ok(warnings.length < attempts);
});

test("animator resets failure throttle after a successful frame", async (t) => {
  let attempts = 0;
  const warnings = [];
  const outcomes = ["fail", "fail", "success", "fail"];
  const animator = createBuddyAnimator({
    transport: { push: async () => {} },
    getModel: () => ({ buddy: {} }),
    render: (model) => {
      const outcome = outcomes[attempts] ?? "success";
      attempts += 1;
      if (outcome === "fail") throw new Error("render failed");
      return { animPhase: model.buddy.animPhase };
    },
    intervalMs: 0,
    sleep: () => new Promise((r) => setImmediate(r)),
    logger: { warn: (...args) => warnings.push(args) },
  });
  t.after(() => animator.stop());

  animator.start();
  await waitFor(() => attempts >= outcomes.length);
  animator.stop();

  assert.equal(warnings.length, 2);
});

async function waitFor(predicate, maxTicks = 500) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error("condition was not met");
}
