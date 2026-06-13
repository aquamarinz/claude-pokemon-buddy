import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";

import { fitTodayLineFont, formatReset, heartCount, layoutText, weatherIconKind } from "../src/render/layout.js";
import { renderFrame } from "../src/render/frame.js";
import { LEFT_W } from "../src/render/palette.js";

test("layout text includes wind in the weather detail row", () => {
  const text = layoutText({
    clock: "09:14",
    p5h: 72,
    pweek: 41,
    resets5h: "resets in 2h",
    resetsWeek: "wk resets Jun 2",
    todayCost: 4.1,
    todayTokens: 5_300_000,
    weather: {
      cond: "多云",
      temp: 19,
      feels: 17,
      hi: 22,
      lo: 14,
      precip: 30,
      wind: 11,
    },
  });

  assert.match(text.weatherDetail, /风11/);
});

test("layout text formats clock and reset ISO values", () => {
  const now = new Date(2026, 4, 30, 10, 0);
  const text = layoutText({
    now,
    resets5h: new Date(2026, 4, 30, 12, 14).toISOString(),
    resetsWeek: new Date(2026, 5, 2, 15, 45).toISOString(),
  });

  assert.equal(text.clock, "10:00");
  assert.equal(text.resets5h, "in 2h14m");
  assert.equal(text.resetsWeek, "Jun 02, 15:45");
  assert.doesNotMatch(text.resets5h, /2026-/);
  assert.doesNotMatch(text.resetsWeek, /2026-/);
});

test("formatReset handles short, cross-day, later, and empty reset values", () => {
  const now = new Date(2026, 4, 30, 10, 0);

  assert.equal(formatReset(new Date(2026, 4, 30, 10, 42).toISOString(), now), "in 42m");
  assert.equal(formatReset(new Date(2026, 4, 31, 0, 15).toISOString(), new Date(2026, 4, 30, 23, 30)), "tomorrow 00:15");
  assert.equal(formatReset(new Date(2026, 5, 2, 15, 45).toISOString(), now), "Jun 02, 15:45");
  assert.equal(formatReset(null, now), "reset unknown");
});

test("weather text keeps feels and wind mapped to the correct fields", () => {
  const text = layoutText({
    weather: {
      cond: "雨",
      temp: 19,
      feels: 17,
      hi: 22,
      lo: 14,
      precip: 30,
      wind: 11,
    },
  });

  assert.equal(text.weatherMain, "雨 19°");
  assert.equal(text.weatherFeels, "体感17°");
  assert.equal(text.weatherDetail, "高22°低14° 降30% 风11");
  assert.doesNotMatch(text.weatherMain, /风/);
});

test("weather icon kind follows the current condition", () => {
  assert.equal(weatherIconKind({ cond: "晴" }), "sun");
  assert.equal(weatherIconKind({ cond: "多云" }), "cloud");
  assert.equal(weatherIconKind({ cond: "雨" }), "rain");
  assert.equal(weatherIconKind({ cond: "雪" }), "snow");
  assert.equal(weatherIconKind({ cond: "雾" }), "fog");
});

test("heartCount maps raw bond to 0-5 in half-heart steps", () => {
  assert.equal(heartCount(0), 0);
  assert.equal(heartCount(40), 1);
  assert.equal(heartCount(60), 1.5);
  assert.equal(heartCount(200), 5);
  assert.equal(heartCount(9999), 5);
});

test("layout draws hearts without platform heart glyphs", () => {
  const source = readFileSync(new URL("../src/render/layout.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /[♥♡]/);
});

test("today usage line fits before the left panel divider", () => {
  const text = layoutText({
    todayCost: 598.35,
    todayTokens: 400_600_000,
  });
  const g = createCanvas(400, 300).getContext("2d");

  g.font = fitTodayLineFont(g, text.today);

  assert.match(g.font, /12px "Zpix"/);
  assert.ok(g.measureText(text.today).width <= LEFT_W - 23);
});

test("layout uses the registered Zpix pixel font on the 12px grid", () => {
  const source = readFileSync(new URL("../src/render/layout.js", import.meta.url), "utf8");
  const staticFontSizes = [...source.matchAll(/g\.font = `[^`]*?(\d+)px \$\{(?:MONO|CJK)\}`/g)]
    .map((match) => Number(match[1]));

  assert.match(source, /GlobalFonts\.registerFromPath/);
  assert.doesNotMatch(source, /Courier New|PingFang|Hiragino|Microsoft YaHei/);
  assert.ok(staticFontSizes.length > 0);
  assert.deepEqual(staticFontSizes.filter((size) => size % 12 !== 0), []);
});

test("layout text uses degraded labels instead of fake reset data", () => {
  const text = layoutText({
    now: new Date(2026, 4, 30, 9, 5),
    degraded: true,
    p5h: null,
    pweek: null,
    resets5h: null,
    resetsWeek: null,
    todayCost: null,
    todayTokens: null,
    weather: { degraded: true },
  });

  assert.equal(text.clock, "09:05");
  assert.equal(text.p5h, "--");
  assert.equal(text.pweek, "--");
  assert.equal(text.resets5h, "reset unknown");
  assert.equal(text.resetsWeek, "reset unknown");
  assert.equal(text.today, "today $-- · -- tok");
  assert.match(text.weatherMain, /degraded/);
  assert.match(text.weatherMain, /--°/);
  assert.match(text.weatherDetail, /风--/);
});

test("ready-to-evolve badge differs from species-name line", async () => {
  const normal = await renderFrame(baseModel({ readyToEvolve: false }));
  const ready = await renderFrame(baseModel({ readyToEvolve: true }));
  assert.ok(!normal.pngBuffer.equals(ready.pngBuffer), "badge state must render differently");
});

function baseModel(extra) {
  return {
    p5h: 12,
    pweek: 34,
    todayCost: 1,
    now: new Date(2026, 5, 10, 14),
    weather: { cond: "多云", temp: 12, humidity: 50 },
    room: { t: 21, h: 45 },
    out: { t: 12, h: 50 },
    buddy: {
      spriteGray: new Uint8Array(40 * 40).fill(255),
      spriteW: 40,
      spriteH: 40,
      mood: "happy",
      level: 5,
      bond: 40,
      expPct: 40,
      bubble: "Bui!",
      species: "eevee",
      readyToEvolve: false,
      ...extra,
    },
  };
}
