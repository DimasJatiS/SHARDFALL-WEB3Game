// All tuning numbers from the PRD (sections 4 and 5) live here.
// Keep this file importable from Node too (the game server shares it).

import type { ItemKind, Rarity } from "./types";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
/** Client reads VITE_DEMO, the server reads DEMO. They must match. */
export const DEMO = env?.VITE_DEMO === "true" || nodeEnv?.DEMO === "true";

/** DEMO mode: faster zones and lower quotas so a pitch match ends in ~90 s. */
const T = DEMO ? 0.3 : 1;
const Q = DEMO ? 0.5 : 1;

export const GAME = {
  tickHz: 20,
  map: { size: 124, islandRadius: 52, spawnRadius: 35, campRadius: 5 },
  players: { min: 4, max: 10 },
  lobbySeconds: 60,

  player: {
    hp: 100,
    stamina: 100,
    staminaRegen: 15,
    speed: 5,
    radius: 0.4,
    spawnInvuln: 3,
    interactRange: 1.8,
    openSeconds: 1.5,
  },

  combat: {
    attackCooldown: 0.4,
    defendReduction: 0.7,
    defendSlow: 0.5,
    defendDrain: 20,
    guardBreakStun: 1,
    parryWindow: 0.2,
    parryMissCooldown: 1.5,
    parryHitCooldown: 0.3,
    parryStun: 1,
    parryBonus: 2,
    parryBonusSeconds: 3,
  },

  rarity: [
    { name: "Common", color: "#9aa3ad", value: 10, mult: 1.0 },
    { name: "Rare", color: "#4aa3ff", value: 25, mult: 1.25 },
    { name: "Epic", color: "#b06bff", value: 60, mult: 1.5 },
  ] as const,

  weapons: {
    fist: { damage: 12, range: 1.2, arc: 90 },
    sword: { damage: 20, range: 1.5, arc: 90 },
    staff: { damage: 15, aoe: 1.5, range: 6, cast: 0.6 },
    bow: { damage: 12, range: 8, projectileSpeed: 14 },
  },

  armor: { hp: 20, reduction: 0.1 },

  skills: {
    heal: 40,
    speed: { mult: 0.5, seconds: 5 },
    maxhp: 25,
    invuln: 3,
  },

  /** Fixed per-match item pool (36 items). Only positions and rarity vary. */
  pool: {
    armor: 5, sword: 7, staff: 4, bow: 4,
    heal: 6, speed: 4, maxhp: 3, invuln: 3,
  } satisfies Record<ItemKind, number>,

  chests: {
    wood: { count: 8, items: 2, rarity: [0.75, 0.25, 0], guards: ["minion", "minion", "minion"] },
    iron: { count: 2, items: 2, rarity: [0, 0.6, 0.4], guards: ["minion", "minion", "minion", "minion", "elite"] },
    boss: { count: 1, items: 4, rarity: [0, 0, 1], guards: ["boss"] },
  } as const,

  enemies: {
    minion: { hp: 30, damage: 5, speed: 3.4, range: 1.1, windup: 0.5, cooldown: 1.5, radius: 0.4 },
    elite: { hp: 120, damage: 12, speed: 3.0, range: 1.3, windup: 0.6, cooldown: 1.8, radius: 0.6 },
    boss: { hp: 600, damage: 25, speed: 2.2, range: 2.6, windup: 0.8, cooldown: 3.0, radius: 1.2, slamRadius: 3 },
    aggroRadius: 6,
    leashRadius: 10,
  },

  obstacles: {
    spike: { damage: 10, period: 2, activeFor: 0.4, radius: 0.55 },
    pool: { dps: 5 },
    barrel: { damage: 30, radius: 2 },
  },

  /** Bluezone phases. Quota is checked at the END of each phase (scaled by player count). */
  zone: [
    { start: 0, end: 90 * T, r0: 39, r1: 39, dps: 0, quota: 0 },
    { start: 90 * T, end: 150 * T, r0: 39, r1: 27, dps: 2, quota: 30 * Q },
    { start: 150 * T, end: 210 * T, r0: 27, r1: 12, dps: 5, quota: 70 * Q },
    { start: 210 * T, end: 255 * T, r0: 12, r1: 5, dps: 10, quota: 130 * Q },
    { start: 255 * T, end: 300 * T, r0: 5, r1: 0, dps: 20, quota: 0 },
  ],
  matchSeconds: 300 * T,
  quotaWarningSeconds: 10,

  economy: {
    ticketMon: "0.1",
    feeBps: 500,
    prizeBps: [6000, 2500, 1500],
    skinPriceMon: "0.05",
  },
} as const;

/** "Kuota fase × 10 ÷ jumlah pemain" (PRD 4.6). */
export function scaledQuota(base: number, playerCount: number): number {
  return Math.round((base * 10) / Math.max(1, playerCount));
}

export function itemValue(rarity: Rarity): number {
  return GAME.rarity[rarity].value;
}

export function rarityMult(rarity: Rarity): number {
  return GAME.rarity[rarity].mult;
}

export const WEAPON_KINDS: ItemKind[] = ["sword", "staff", "bow"];
export const SKILL_KINDS: ItemKind[] = ["heal", "speed", "maxhp", "invuln"];

export const ITEM_NAMES: Record<ItemKind, string> = {
  armor: "Armor Set",
  sword: "Sword",
  staff: "Magic Staff",
  bow: "Bow",
  heal: "Heal Potion",
  speed: "Swift Tonic",
  maxhp: "Heart Crystal",
  invuln: "Aegis Charm",
};

export const ITEM_DESC: Record<ItemKind, string> = {
  armor: "+20 max HP, −10% damage taken",
  sword: "20 dmg, 90° arc, 1.5 tiles",
  staff: "15 dmg area, 6 tiles, 0.6 s cast",
  bow: "12 dmg projectile, 8 tiles",
  heal: "Restore 40 HP",
  speed: "+50% move speed for 5 s",
  maxhp: "+25 max HP until match ends",
  invuln: "Immune to all damage for 3 s",
};
