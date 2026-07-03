import { rollPersonality } from "./personality.js";
import { resolveEvolution } from "./evolution.js";

export function ensurePet(state, today, personalityRng = Math.random) {
  // No hatched flag = fresh start (or pre-hatched dirty save) -> newborn from bond 0.
  // The onboarding gate handles species choice + hatch; ensurePet is the no-gate
  // fallback (tests / CPB_ONCE) and births a plain eevee.
  if (!state?.hatched) {
    return {
      species: "eevee",
      level: 1,
      exp: 0,
      bond: 0,
      streak: 0,
      shield: 0,
      lastSettled: today,
      lastGrowthDay: null,
      todayCreditedExp: 0,
      todayCreditedBond: 0,
      hatched: true,
      ...rollPersonality(personalityRng),
    };
  }

  const pet = {
    species: "eevee",
    level: 1,
    exp: 0,
    bond: 0,
    streak: 0,
    shield: 0,
    lastSettled: today,
    lastGrowthDay: null,
    todayCreditedExp: 0,
    todayCreditedBond: 0,
    ...state,
  };
  return hasPersonality(pet) ? pet : { ...pet, ...rollPersonality(personalityRng) };
}

export function applyPetTransitions({
  pet,
  weather,
  room,
  now,
  buttonEvents = [],
  evolutionIntents,
} = {}) {
  let next = applyCareEvents(pet, buttonEvents);
  let evolutionAnimation = null;
  let choiceEvolved = false;

  for (const intent of drainEvolutionIntents(evolutionIntents)) {
    if (intent?.type === "stone" && isEvolutionStone(intent.stone)) {
      next = { ...next, stone: intent.stone };
    } else if (intent?.type === "choose" && typeof intent.to === "string") {
      const choice = resolveEvolution(next.species, evolutionContext({ pet: next, weather, room, now }))
        .candidates
        .find((candidate) => candidate.to === intent.to);
      if (choice) {
        const fromSpecies = next.species;
        next = evolvePet(next, choice.to);
        evolutionAnimation = { fromSpecies, toSpecies: choice.to };
        choiceEvolved = true;
        break;
      }
    }
  }

  // Table-driven: resolve once against the evolution tables, recompute readiness
  // every tick (can fall back to false), and reuse the same resolution for KEY.
  const evolution = choiceEvolved
    ? { auto: null, candidates: [] }
    : resolveEvolution(next.species, evolutionContext({ pet: next, weather, room, now }));
  const readyToEvolve = Boolean(evolution.auto || evolution.candidates.length > 0);
  next = { ...next, readyToEvolve };

  if (!choiceEvolved && readyToEvolve && hasKeyPress(buttonEvents)) {
    if (evolution.auto) {
      const fromSpecies = next.species;
      const toSpecies = evolution.auto;
      next = evolvePet(next, toSpecies);
      evolutionAnimation = { fromSpecies, toSpecies };
    } else if (evolution.candidates.length > 0) {
      next = { ...next, pendingCandidates: evolution.candidates };
    }
  }

  return { pet: next, evolutionAnimation };
}

export function applyCareEvents(pet, events = []) {
  if (!events.some((event) => event?.key === "KEY" && event?.kind === "long")) return pet;
  return { ...pet, careCount: Math.max(0, Number(pet.careCount ?? 0)) + 1 };
}

export function evolutionContext({ pet, weather, room, now }) {
  const hour = now.getHours();
  const daytime = hour >= 6 && hour < 18;
  const careCount = Math.max(0, Number(pet.careCount ?? 0));

  return {
    bond: pet.bond,
    level: pet.level,
    daytime,
    night: !daytime,
    care: careCount > 0,
    careCount,
    roomTemp: room?.t,
    roomHumidity: room?.h,
    weather: weather?.cond,
    temp: weather?.temp,
    humidity: weather?.humidity,
    warmHumid: isWarmHumid(weather?.temp, weather?.humidity) || isWarmHumid(room?.t, room?.h),
    cold: isCold(weather?.temp) || isCold(room?.t),
    stone: pet.stone,
  };
}

export function evolvePet(pet, species) {
  const { pendingCandidates, stone, ...rest } = pet;
  return { ...rest, species, readyToEvolve: false };
}

export function drainEvolutionIntents(evolutionIntents) {
  if (Array.isArray(evolutionIntents)) return evolutionIntents;
  if (!evolutionIntents || typeof evolutionIntents.drain !== "function") return [];
  const drained = evolutionIntents.drain();
  return Array.isArray(drained) ? drained : [];
}

function hasPersonality(pet) {
  return Boolean(
    typeof pet.nature === "string" &&
      pet.nature.length > 0 &&
      Array.isArray(pet.iv) &&
      pet.iv.length === 6 &&
      pet.iv.every((value) => Number.isInteger(value) && value >= 0 && value <= 31) &&
      typeof pet.characteristic === "string" &&
      pet.characteristic.length > 0,
  );
}

function hasKeyPress(events) {
  return events.some((event) => event?.key === "KEY" && event?.kind === "short");
}

function isEvolutionStone(stone) {
  return stone === "water" || stone === "thunder" || stone === "fire";
}

function isWarmHumid(temp, humidity) {
  return typeof temp === "number" && typeof humidity === "number" && temp >= 20 && humidity >= 60;
}

function isCold(temp) {
  return typeof temp === "number" && temp <= 4;
}
