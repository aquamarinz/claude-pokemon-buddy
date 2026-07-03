import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeOnboardingIo, runOnboardingGate } from "../src/index.js";

test("无 hatched → 跑 onboarding 并写 newborn(选中物种, bond 0, hatched)", async () => {
  const statePath = join("out", "test-gate-state.json");
  rmSync(statePath, { force: true });
  await runOnboardingGate({
    statePath,
    today: "2026-06-10",
    onboarding: async () => ({ species: "charmander", name: "小火龙" }),
    personalityRng: () => 0.5,
  });
  const s = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(s.hatched, true);
  assert.equal(s.species, "charmander");
  assert.equal(s.name, "小火龙");
  assert.equal(s.bond, 0);
  assert.equal(s.level, 1);
});

test("已 hatched → 跳过 onboarding，不覆盖存档", async () => {
  const statePath = join("out", "test-gate-hatched.json");
  rmSync(statePath, { force: true });
  const saved = { schemaVersion: 1, hatched: true, species: "umbreon", level: 9, bond: 70 };
  writeFileSync(statePath, JSON.stringify(saved));
  let called = false;
  await runOnboardingGate({
    statePath, today: "2026-06-10",
    onboarding: async () => { called = true; return { species: "x", name: "x" }; },
  });
  assert.equal(called, false);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).species, "umbreon");
});

test("makeOnboardingIo buffers button presses FIFO while frames are pushing", async () => {
  let onButton = null;
  const transport = {
    onButton(callback) {
      onButton = callback;
      return () => { onButton = null; };
    },
    async push() {},
  };
  const { io, off } = makeOnboardingIo(transport);

  onButton({ key: "KEY", seq: 1 });
  onButton({ key: "KEY", seq: 2 });
  onButton({ key: "KEY", seq: 3 });

  assert.deepEqual(await io.nextButton(), { key: "KEY", seq: 1 });
  assert.deepEqual(await io.nextButton(), { key: "KEY", seq: 2 });
  assert.deepEqual(await io.nextButton(), { key: "KEY", seq: 3 });

  const pending = io.nextButton();
  onButton({ key: "KEY", seq: 4 });
  assert.deepEqual(await pending, { key: "KEY", seq: 4 });
  off();
  assert.equal(onButton, null);
});
