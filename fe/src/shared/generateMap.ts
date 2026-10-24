// Pure, deterministic map generation (PRD 9.1). Server and every client run this
// with the same seed and get the same island, camps, obstacles and zone plan.

import { GAME } from "./config";
import { mulberry32, shuffle, valueNoise2D } from "./rng";
import type { Camp, ChestTier, ItemKind, MapData, Obstacle, ObstacleKind, ZoneCircle } from "./types";

export const TILE = { GRASS: 0, DIRT: 1, STONE: 2, WATER: 3, SAND: 4 } as const;

export function isWalkable(map: MapData, x: number, z: number): boolean {
  const tx = Math.floor(x), tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= map.size || tz >= map.size) return false;
  return map.type[tz * map.size + tx] !== TILE.WATER;
}

export function tileHeight(map: MapData, x: number, z: number): number {
  const tx = Math.floor(x), tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= map.size || tz >= map.size) return -1;
  const i = tz * map.size + tx;
  return map.type[i] === TILE.WATER ? -1 : map.height[i];
}

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export function generateMap(seed: number): MapData {
  const S = GAME.map.size;
  const C = S / 2;
  const rand = mulberry32(seed);
  const nHeight = valueNoise2D(rand);
  const nType = valueNoise2D(rand);
  const nEdge = valueNoise2D(rand);

  const height = new Array<number>(S * S).fill(0);
  const type = new Array<number>(S * S).fill(TILE.WATER);

  // Steps 1–3: heightmap (2 octaves), tile types, island falloff mask.
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const i = z * S + x;
      const d = Math.hypot(x + 0.5 - C, z + 0.5 - C) / GAME.map.islandRadius;
      const edge = d + (nEdge(x / 5, z / 5) - 0.5) * 0.12;
      if (edge > 0.97) continue; // water
      const e = nHeight(x / 13, z / 13) * 0.7 + nHeight(x / 5 + 31, z / 5 + 17) * 0.3;
      // Flatten the center and the shoreline so fights happen on readable ground.
      const flat = smooth(0.12, 0.3, d) * (1 - smooth(0.78, 0.95, d));
      let h = Math.floor(Math.min(0.999, Math.max(0, (e - 0.25) * 1.7)) * 4 * flat);
      h = Math.min(3, h);
      height[i] = h;
      const t = nType(x / 9 + 50, z / 9);
      if (edge > 0.88) type[i] = TILE.SAND;
      else if (h >= 3) type[i] = TILE.STONE;
      else if (t > 0.63) type[i] = TILE.DIRT;
      else type[i] = TILE.GRASS;
    }
  }

  // Step 4: connectivity. Flood fill from center; unreachable land becomes water.
  const seen = new Uint8Array(S * S);
  const stack = [Math.floor(C) * S + Math.floor(C)];
  type[stack[0]] = TILE.GRASS;
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || type[i] === TILE.WATER) continue;
    seen[i] = 1;
    const x = i % S, z = (i / S) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < S - 1) stack.push(i + 1);
    if (z > 0) stack.push(i - S);
    if (z < S - 1) stack.push(i + S);
  }
  for (let i = 0; i < S * S; i++) if (!seen[i]) type[i] = TILE.WATER;

  const map: MapData = { seed, size: S, height, type, spawns: [], camps: [], obstacles: [], zones: [] };
  const walk = (x: number, z: number) => isWalkable(map, x, z);
  const nearestWalkable = (x: number, z: number) => {
    for (let r = 0; r < 12; r += 0.5) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (walk(px, pz)) return { x: Math.floor(px) + 0.5, z: Math.floor(pz) + 0.5 };
      }
    }
    return { x: C, z: C };
  };

  // Step 5: spawns on a ring, 36° apart, jittered, snapped to land.
  for (let i = 0; i < GAME.players.max; i++) {
    const a = (i / GAME.players.max) * Math.PI * 2 + (rand() - 0.5) * 0.15;
    const r = GAME.map.spawnRadius - rand() * 1.5;
    map.spawns.push(nearestWalkable(C + Math.cos(a) * r, C + Math.sin(a) * r));
  }

  // Step 6: camps. Tier by distance: boss center, iron inner ring, wood outer ring.
  const camps: { tier: ChestTier; x: number; z: number }[] = [{ tier: "boss", x: C, z: C }];
  const placeRing = (tier: ChestTier, count: number, rMin: number, rMax: number, spacing: number) => {
    let placed = 0, tries = 0, minD = spacing;
    while (placed < count && tries < 5000) {
      tries++;
      if (tries % 400 === 0) minD = Math.max(4, minD - 0.5);
      const a = rand() * Math.PI * 2;
      const r = rMin + rand() * (rMax - rMin);
      const x = Math.floor(C + Math.cos(a) * r) + 0.5;
      const z = Math.floor(C + Math.sin(a) * r) + 0.5;
      if (!walk(x, z)) continue;
      if (camps.some((c) => Math.hypot(c.x - x, c.z - z) < minD)) continue;
      if (map.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < GAME.map.campRadius + 3)) continue;
      camps.push({ tier, x, z });
      placed++;
    }
  };
  placeRing("iron", GAME.chests.iron.count, 8, 13, 8);
  placeRing("wood", GAME.chests.wood.count, 14, 23.5, 8);

  // Distribute the fixed 36-item pool over the chests.
  const pool: ItemKind[] = [];
  for (const [kind, n] of Object.entries(GAME.pool) as [ItemKind, number][]) for (let i = 0; i < n; i++) pool.push(kind);
  shuffle(pool, rand);
  // Higher tiers first so the boss chest always gets its 4 items even if a ring under-filled.
  const order = [...camps].sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
  map.camps = order.map((c, id): Camp => {
    const def = GAME.chests[c.tier];
    const guards = def.guards.map((kind, gi) => {
      const a = (gi / def.guards.length) * Math.PI * 2 + rand();
      const r = kind === "boss" ? 0 : 2.4;
      const p = r === 0 ? { x: c.x + 2, z: c.z } : { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
      return { kind, ...(walk(p.x, p.z) ? p : nearestWalkable(p.x, p.z)) };
    });
    return { id, tier: c.tier, x: c.x, z: c.z, guards, kinds: pool.splice(0, def.items) };
  });

  // Step 7: obstacles and decoration, away from spawns and camps.
  const obstacles: Obstacle[] = [];
  const scatter = (kind: ObstacleKind, count: number, r: number, minGap: number) => {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 60) {
      tries++;
      const x = Math.floor(rand() * S) + 0.5, z = Math.floor(rand() * S) + 0.5;
      if (!walk(x, z)) continue;
      if (Math.hypot(x - C, z - C) > GAME.map.islandRadius - 2) continue;
      if (map.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
      if (map.camps.some((c) => Math.hypot(c.x - x, c.z - z) < GAME.map.campRadius + 1.5)) continue;
      if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < minGap + o.r)) continue;
      obstacles.push({ id: obstacles.length, kind, x, z, r });
      placed++;
    }
  };
  scatter("pool", 5, 1.3, 3);
  scatter("spike", 10, GAME.obstacles.spike.radius, 2);
  scatter("barrel", 10, 0.4, 2);
  scatter("tree", 46, 0.35, 1.5);
  map.obstacles = obstacles;

  // Level the ground under camps and pools so chests and lava sit flat.
  const flatten = (cx: number, cz: number, r: number) => {
    const h = height[Math.floor(cz) * S + Math.floor(cx)];
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || z < 0 || x >= S || z >= S) continue;
        const i = z * S + x;
        if (type[i] !== TILE.WATER && Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= r) height[i] = h;
      }
  };
  for (const c of map.camps) flatten(c.x, c.z, c.tier === "boss" ? 4.5 : 3);
  for (const o of obstacles) if (o.kind === "pool") flatten(o.x, o.z, o.r + 0.8);

  // Step 8: zone plan. Each new center lies inside the previous circle.
  const zones: ZoneCircle[] = [{ cx: C, cz: C, r: GAME.zone[0].r1 }];
  for (let i = 1; i < GAME.zone.length; i++) {
    const prev = zones[i - 1];
    const r = GAME.zone[i].r1;
    const maxOff = Math.max(0, prev.r - r) * 0.8;
    const a = rand() * Math.PI * 2;
    const off = Math.sqrt(rand()) * maxOff;
    let cx = prev.cx + Math.cos(a) * off, cz = prev.cz + Math.sin(a) * off;
    if (!walk(cx, cz)) ({ x: cx, z: cz } = nearestWalkable(cx, cz));
    zones.push({ cx, cz, r });
  }
  map.zones = zones;
  return map;
}

function tierRank(t: ChestTier) {
  return t === "boss" ? 2 : t === "iron" ? 1 : 0;
}

/** Zone circle at time t (shared so server and HUD agree). */
export function zoneAt(map: MapData, t: number) {
  const phases = GAME.zone;
  let idx = phases.findIndex((p) => t < p.end);
  if (idx === -1) idx = phases.length - 1;
  const p = phases[idx];
  const from = map.zones[Math.max(0, idx - 1)];
  const to = map.zones[idx];
  const k = idx === 0 ? 0 : Math.min(1, Math.max(0, (t - p.start) / (p.end - p.start)));
  return {
    phase: idx,
    cx: from.cx + (to.cx - from.cx) * k,
    cz: from.cz + (to.cz - from.cz) * k,
    r: p.r0 + (p.r1 - p.r0) * k,
    next: idx === 0 ? map.zones[1] : to,
    phaseEndsAt: p.end,
    shrinking: idx > 0,
    dps: p.dps,
    baseQuota: p.quota,
  };
}
