import { test } from "node:test";
import assert from "node:assert/strict";
import { runOnboarding } from "../src/pet/onboarding.js";
import { OAK_LINES, CANDIDATES } from "../src/pet/onboarding-data.js";

function mockIo(buttons) {
  let i = 0;
  const pushed = [], sounds = [];
  return {
    pushed, sounds,
    io: {
      push: async (f) => { pushed.push(f); },
      nextButton: async () => buttons[i++],
      playSound: (id) => sounds.push(id),
      delay: async () => {},
    },
  };
}

test("oak 翻页 + 切到第2候选 + 长按确认 + 诞生 → 返回该候选", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [
    ...oak,                              // 大木每页一次 KEY
    { key: "KEY", kind: "short" },       // 选蛋:切到 sel=1
    { key: "KEY", kind: "long" },        // 确认
    { key: "KEY", kind: "short" },       // 诞生屏:开始
  ];
  const { io, sounds } = mockIo(buttons);
  const r = await runOnboarding(io);
  assert.equal(r.species, CANDIDATES[1].species);
  assert.equal(r.name, CANDIDATES[1].name);
  assert.ok(sounds.length >= 1); // 播了孵化音
});

test("不切换直接确认 → 返回第1候选(伊布)", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [...oak, { key: "KEY", kind: "long" }, { key: "KEY", kind: "short" }];
  const { io } = mockIo(buttons);
  const r = await runOnboarding(io);
  assert.equal(r.species, "eevee");
});

test("BOOT/非KEY 在选蛋阶段被忽略，不前进", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [...oak, { key: "BOOT", kind: "short" }, { key: "KEY", kind: "long" }, { key: "KEY", kind: "short" }];
  const { io } = mockIo(buttons);
  const r = await runOnboarding(io);
  assert.equal(r.species, "eevee"); // BOOT 没切换，仍 sel=0
});
