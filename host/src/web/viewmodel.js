const EVOLVE_BOND = 160;

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
        threshold: EVOLVE_BOND,
        ready: Boolean(pet.readyToEvolve),
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
