import { deriveMood, PARAMS } from "../pet/sim.js";

export function toDashboardView({ pet, usage, weather, sensors, journey, secrets, config }) {
  return {
    buddy: {
      name: config.name,
      species: pet.species,
      level: pet.level,
      exp: pet.exp,
      bond: pet.bond,
      mood: pet.mood,
      nature: pet.nature,
      iv: pet.iv,
      characteristic: pet.characteristic,
      badges: pet.badges,
      nextEvo: {
        bond: pet.bond,
        threshold: PARAMS.evolveBond,
        ready: Boolean(pet.readyToEvolve),
        pendingCandidates: normalizeCandidates(pet.pendingCandidates),
      },
    },
    usage: {
      p5h: usage.p5h,
      pweek: usage.pweek,
      todayCost: usage.todayCost,
      todayTokens: usage.todayTokens,
      streak: usage.streak,
      modelled: usage.modelled,
      rateStale: Boolean(usage.rateStale),
    },
    weather,
    room: {
      t: sensors.roomT,
      h: sensors.roomH,
    },
    journey: journey ?? [],
    secrets: {
      discovered: secrets.discovered,
      discoveredCount: secrets.discovered.length,
      lockedCount: Math.max(0, secrets.total - secrets.discovered.length),
      total: secrets.total,
    },
    settings: {
      name: config.name,
      quietHours: config.quietHours,
      volume: config.volume,
      lat: config.lat,
      lon: config.lon,
    },
    difficulty: "NORMAL · 锁定",
  };
}

export function toDashboardRuntimeView({ pet: petState, usage, weather, room, config }) {
  const pet = dashboardPet(petState, usage);
  const view = toDashboardView({
    pet,
    usage: dashboardUsage(usage, pet),
    weather,
    sensors: dashboardSensors(room),
    journey: dashboardJourney(pet),
    secrets: dashboardSecrets(pet),
    config,
  });
  return {
    ...view,
    box: Array.isArray(config.box) && config.box.length > 0 ? config.box : [pet.species],
  };
}

export function dashboardPet(pet, usage) {
  const normalized = {
    species: "eevee",
    level: 1,
    exp: 0,
    bond: 0,
    streak: 0,
    ...pet,
  };
  return {
    ...normalized,
    mood: normalized.mood ?? deriveMood(dashboardUsage(usage, normalized)),
    nature: normalized.nature ?? "—",
    iv: Array.isArray(normalized.iv) ? normalized.iv : [],
    characteristic: normalized.characteristic ?? "—",
    badges: Array.isArray(normalized.badges) ? normalized.badges : dashboardBadges(normalized),
  };
}

export function dashboardUsage(usage, pet = {}) {
  return {
    p5h: null,
    pweek: null,
    todayCost: null,
    todayTokens: null,
    streak: pet.streak ?? 0,
    modelled: false,
    ...usage,
  };
}

export function dashboardSensors(room) {
  const r = room ?? {};
  return {
    roomT: r.roomT ?? r.t ?? null,
    roomH: r.roomH ?? r.h ?? null,
  };
}

export function dashboardJourney(pet) {
  if (Array.isArray(pet.journey)) return pet.journey;
  const date = pet.lastGrowthDay ?? pet.lastSettled;
  return date ? [{ date, text: `亲密度 ${pet.bond}` }] : [];
}

export function dashboardSecrets(pet) {
  const source = pet.secrets ?? {};
  const discovered = Array.isArray(source.discovered)
    ? source.discovered
    : Array.isArray(pet.discoveredSecrets)
      ? pet.discoveredSecrets
      : [];
  return {
    discovered,
    total: Number.isFinite(source.total) ? source.total : 12,
  };
}

export function dashboardBadges(pet) {
  const badges = [];
  if ((pet.streak ?? 0) >= 7) badges.push("7d");
  if ((pet.bond ?? 0) >= PARAMS.evolveBond) badges.push("EVO");
  return badges;
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .filter((candidate) => typeof candidate?.to === "string")
    .map((candidate) => ({ to: candidate.to, priority: candidate.priority }));
}
