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
    todayProvider: () => "2026-06-10",
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

test("孵化日取 onboarding 完成之时（设备延迟接入不写陈旧日期）", async () => {
  const statePath = join("out", "test-gate-completion-day.json");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true });
  // 进程启动那天是 01-01；onboarding 直到 01-05 才真正完成。
  let clock = "2026-01-01";
  await runOnboardingGate({
    statePath,
    todayProvider: () => clock, // 完成后才求值 → 应读到 01-05
    onboarding: async () => {
      clock = "2026-01-05"; // 设备接入并完成 onboarding 的真实日期
      return { species: "eevee", name: "伊布" };
    },
    personalityRng: () => 0.5,
  });
  const s = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(s.lastSettled, "2026-01-05");
});

test("已 hatched → 跳过 onboarding，不覆盖存档", async () => {
  const statePath = join("out", "test-gate-hatched.json");
  rmSync(statePath, { force: true });
  const saved = { schemaVersion: 1, hatched: true, species: "umbreon", level: 9, bond: 70 };
  writeFileSync(statePath, JSON.stringify(saved));
  let called = false;
  await runOnboardingGate({
    statePath, todayProvider: () => "2026-06-10",
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

test("新孵化：教程开始前存档已是 hatched:true+tutorialDone:false；结束后 true", async () => {
  const statePath = join("out", "test-gate-tutorial.json");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true }); // loadState 会回退读 .bak，须一并清理
  let midState = null;
  const result = await runOnboardingGate({
    statePath, todayProvider: () => "2026-07-05",
    onboarding: async () => ({ species: "eevee", name: "伊布" }),
    tutorial: async () => { midState = JSON.parse(readFileSync(statePath, "utf8")); },
    personalityRng: () => 0.5,
  });
  assert.equal(midState.hatched, true);
  assert.equal(midState.tutorialDone, false);   // 教程前已落档 → 断电不重孵化
  assert.equal(result.tutorialDone, true);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).tutorialDone, true);
});

test("hatched+tutorialDone:false（教程中断电）→ 只补播教程，不重孵化", async () => {
  const statePath = join("out", "test-gate-replay.json");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true }); // loadState 会回退读 .bak，须一并清理
  // schemaVersion 必须带上：loadState 对缺版本的档走 salvage 重建，会丢 tutorialDone
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, hatched: true, species: "squirtle", level: 3, tutorialDone: false }));
  let onboardingCalled = false, tutorialCalled = false;
  const result = await runOnboardingGate({
    statePath, todayProvider: () => "2026-07-05",
    onboarding: async () => { onboardingCalled = true; return { species: "x", name: "x" }; },
    tutorial: async () => { tutorialCalled = true; },
  });
  assert.equal(onboardingCalled, false);
  assert.equal(tutorialCalled, true);
  assert.equal(result.species, "squirtle");     // 存档其余字段不丢
  assert.equal(result.level, 3);
  assert.equal(result.tutorialDone, true);
});

test("老存档（hatched 无 tutorialDone 字段）→ 不补播", async () => {
  const statePath = join("out", "test-gate-legacy.json");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true }); // loadState 会回退读 .bak，须一并清理
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, hatched: true, species: "umbreon", level: 9 }));
  let tutorialCalled = false;
  const result = await runOnboardingGate({
    statePath, todayProvider: () => "2026-07-05",
    onboarding: async () => ({ species: "x", name: "x" }),
    tutorial: async () => { tutorialCalled = true; },
  });
  assert.equal(tutorialCalled, false);
  assert.equal(result.species, "umbreon");
  assert.equal("tutorialDone" in result, false); // 老档不补写字段
});

test("hatched+tutorialDone:true → 都不调用", async () => {
  const statePath = join("out", "test-gate-done.json");
  rmSync(statePath, { force: true });
  rmSync(`${statePath}.bak`, { force: true }); // loadState 会回退读 .bak，须一并清理
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, hatched: true, species: "eevee", tutorialDone: true }));
  let called = 0;
  await runOnboardingGate({
    statePath, todayProvider: () => "2026-07-05",
    onboarding: async () => { called += 1; return { species: "x", name: "x" }; },
    tutorial: async () => { called += 1; },
  });
  assert.equal(called, 0);
});
