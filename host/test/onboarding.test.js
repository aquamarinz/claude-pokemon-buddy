import { test } from "node:test";
import assert from "node:assert/strict";
import { runOnboarding } from "../src/pet/onboarding.js";
import { OAK_LINES, CANDIDATES } from "../src/pet/onboarding-data.js";
import { renderOnboarding } from "../src/render/onboarding.js";
import { SOUND } from "../src/transport/proto.js";

function mockIo(buttons) {
  let i = 0;
  const pushed = [], sounds = [], events = [];
  return {
    pushed, sounds, events,
    io: {
      push: async (f) => {
        pushed.push(f);
        events.push({ t: "push", frame: f });
      },
      nextButton: async () => buttons[i++],
      playSound: (id) => {
        sounds.push(id);
        events.push({ t: "sound", id });
      },
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

test("hatch plays EVOLVE sound right after the first black-flash frame", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [...oak, { key: "KEY", kind: "long" }, { key: "KEY", kind: "short" }];
  const { io, events } = mockIo(buttons);

  await runOnboarding(io);

  const blackIndex = events.findIndex((event) =>
    event.t === "push" && event.frame.bitmap.bytes.every((b) => b === 0xff));
  const soundIndexes = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.t === "sound" && event.id === SOUND.EVOLVE)
    .map(({ index }) => index);

  assert.ok(blackIndex >= 0, "hatch sequence must push a black flash frame");
  assert.deepEqual(soundIndexes, [blackIndex + 1], "EVOLVE must play immediately after first black flash");
});

test("runOnboarding passes {page,total} to each oak scene", async () => {
  const oak = OAK_LINES.map(() => ({ key: "KEY", kind: "short" }));
  const buttons = [...oak, { key: "KEY", kind: "long" }, { key: "KEY", kind: "short" }];
  const { io } = mockIo(buttons);
  const scenes = [];

  await runOnboarding(io, {
    render: async (scene) => {
      scenes.push(scene);
      return renderOnboarding(scene);
    },
  });

  const oakScenes = scenes.filter((scene) => scene.kind === "oak");
  assert.equal(oakScenes.length, OAK_LINES.length);
  assert.ok(oakScenes.every((scene, i) => scene.page === i + 1 && scene.total === OAK_LINES.length));
});
