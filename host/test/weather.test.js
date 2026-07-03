import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWeather } from "../src/weather.js";

test("maps WMO code to Chinese condition and returns fields", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      current: {
        temperature_2m: 19,
        apparent_temperature: 17,
        relative_humidity_2m: 64,
        weather_code: 3,
        wind_speed_10m: 11,
      },
      daily: {
        temperature_2m_max: [22],
        temperature_2m_min: [14],
        precipitation_probability_max: [30],
      },
    }),
  });

  const w = makeWeather({ fetch: fakeFetch });
  const r = await w.get(-36.8, 174.7);

  assert.equal(r.cond, "多云");
  assert.equal(r.temp, 19);
  assert.equal(r.feels, 17);
  assert.equal(r.humidity, 64);
  assert.equal(r.hi, 22);
  assert.equal(r.lo, 14);
  assert.equal(r.precip, 30);
  assert.equal(r.wind, 11);
  assert.equal(r.degraded, false);
});

test("on fetch fail returns last-known degraded weather", async () => {
  let ok = true;
  const fakeFetch = async () => {
    if (ok) {
      ok = false;
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 19,
            weather_code: 0,
            apparent_temperature: 18,
            relative_humidity_2m: 50,
            wind_speed_10m: 5,
          },
          daily: {
            temperature_2m_max: [20],
            temperature_2m_min: [10],
            precipitation_probability_max: [0],
          },
        }),
      };
    }

    throw new Error("net");
  };

  const w = makeWeather({ fetch: fakeFetch, ttlMs: 0 });
  await w.get(0, 0);
  const r = await w.get(0, 0);

  assert.equal(r.degraded, true);
  assert.equal(r.temp, 19);
  assert.equal(r.cond, "晴");
});

test("hung weather fetch aborts at timeout and returns degraded null weather", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let sawSignal = false;
  let settled = false;
  const fakeFetch = async (_url, init = {}) => {
    sawSignal = init.signal instanceof AbortSignal;
    if (!init.signal) throw new Error("missing timeout signal");
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };

  const w = makeWeather({ fetch: fakeFetch, timeoutSignal: timeoutSignalFactory() });
  const pending = w.get(0, 0).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();

  assert.equal(sawSignal, true);
  assert.equal(settled, false);
  t.mock.timers.tick(9_999);
  await Promise.resolve();
  assert.equal(settled, false);

  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { cond: "—", temp: null, degraded: true });
});

test("fetch fail after location change does not reuse another location's weather", async () => {
  let ok = true;
  const fakeFetch = async () => {
    if (ok) {
      ok = false;
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 19,
            weather_code: 0,
            apparent_temperature: 18,
            relative_humidity_2m: 50,
            wind_speed_10m: 5,
          },
          daily: {
            temperature_2m_max: [20],
            temperature_2m_min: [10],
            precipitation_probability_max: [0],
          },
        }),
      };
    }

    throw new Error("net");
  };

  const w = makeWeather({ fetch: fakeFetch, ttlMs: 0 });
  await w.get(1, 2);
  const r = await w.get(3, 4);

  assert.equal(r.degraded, true);
  assert.equal(r.temp, null);
  assert.equal(r.cond, "—");
});

test("weather cache is keyed by lat/lon (location change refetches)", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        current: { temperature_2m: 19, apparent_temperature: 17, relative_humidity_2m: 64, weather_code: 3, wind_speed_10m: 11 },
        daily: { temperature_2m_max: [22], temperature_2m_min: [14], precipitation_probability_max: [30] },
      }),
    };
  };

  const w = makeWeather({ fetch: fakeFetch }); // default 30-min TTL
  await w.get(1, 2);
  await w.get(1, 2); // same coords within TTL -> cached, no refetch
  assert.equal(calls, 1);
  await w.get(3, 4); // different coords -> refetch
  assert.equal(calls, 2);
});

function timeoutSignalFactory() {
  return (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("timeout")), ms);
    return controller.signal;
  };
}
