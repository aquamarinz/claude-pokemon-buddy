import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutText } from "../src/render/layout.js";

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

test("layout text uses degraded and dashes instead of fake clock or reset data", () => {
  const text = layoutText({
    degraded: true,
    p5h: null,
    pweek: null,
    resets5h: null,
    resetsWeek: null,
    todayCost: null,
    todayTokens: null,
    weather: { degraded: true },
  });

  assert.equal(text.clock, "--:--");
  assert.equal(text.p5h, "--");
  assert.equal(text.pweek, "--");
  assert.equal(text.resets5h, "--");
  assert.equal(text.resetsWeek, "--");
  assert.equal(text.today, "today $-- · -- tok");
  assert.match(text.weatherMain, /degraded/);
  assert.match(text.weatherMain, /--°/);
  assert.match(text.weatherDetail, /风--/);
});
