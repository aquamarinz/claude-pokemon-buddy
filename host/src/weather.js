const WMO = {
  0: "晴",
  1: "晴",
  2: "多云",
  3: "多云",
  45: "雾",
  48: "雾",
  51: "小雨",
  61: "小雨",
  63: "雨",
  71: "雪",
  80: "阵雨",
  95: "雷雨",
};

export function makeWeather({ fetch = globalThis.fetch, ttlMs = 30 * 60 * 1000 } = {}) {
  let last = null;
  let lastAt = 0;

  return {
    async get(lat, lon) {
      const now = Date.now();
      if (last && now - lastAt < ttlMs) return { ...last, degraded: false };

      try {
        const response = await fetch(weatherUrl(lat, lon));
        if (!response.ok) throw new Error("weather request failed");

        const json = await response.json();
        last = normalizeWeather(json);
        lastAt = now;
        return { ...last, degraded: false };
      } catch {
        return last ? { ...last, degraded: true } : { cond: "—", temp: null, degraded: true };
      }
    },
  };
}

function weatherUrl(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
  );
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  url.searchParams.set("timezone", "auto");
  return url;
}

function normalizeWeather(json) {
  const current = json.current;
  const daily = json.daily;

  return {
    cond: WMO[current.weather_code] ?? "—",
    temp: rounded(current.temperature_2m),
    feels: rounded(current.apparent_temperature),
    humidity: rounded(current.relative_humidity_2m),
    hi: rounded(daily.temperature_2m_max[0]),
    lo: rounded(daily.temperature_2m_min[0]),
    precip: rounded(daily.precipitation_probability_max[0]),
    wind: rounded(current.wind_speed_10m),
  };
}

function rounded(value) {
  const n = Math.round(value);
  if (!Number.isFinite(n)) throw new Error("weather number missing");
  return n;
}
