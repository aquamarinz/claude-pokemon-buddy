const ALLOWED_FIELDS = new Set(["name", "quietHours", "volume", "lat", "lon"]);

export function validateSettings(input) {
  if (!isPlainObject(input)) return fail("settings must be an object");

  const value = {};
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) return fail(`unknown setting: ${key}`);
  }

  if ("name" in input) {
    if (typeof input.name !== "string") return fail("name must be a string");
    const name = input.name.trim();
    if (name.length > 16) return fail("name must be 0-16 characters");
    value.name = name;
  }

  if ("quietHours" in input) {
    const quietHours = input.quietHours;
    if (!isPlainObject(quietHours)) return fail("quietHours must be an object");
    if (!isHour(quietHours.start) || !isHour(quietHours.end)) {
      return fail("quietHours start/end must be 0-23");
    }
    value.quietHours = { start: quietHours.start, end: quietHours.end };
  }

  if ("volume" in input) {
    if (!isInRange(input.volume, 0, 100)) return fail("volume must be 0-100");
    value.volume = input.volume;
  }

  if ("lat" in input) {
    if (!isInRange(input.lat, -90, 90)) return fail("lat must be -90..90");
    value.lat = input.lat;
  }

  if ("lon" in input) {
    if (!isInRange(input.lon, -180, 180)) return fail("lon must be -180..180");
    value.lon = input.lon;
  }

  return { ok: true, value };
}

function fail(error) {
  return { ok: false, error };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isHour(value) {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

function isInRange(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
