// Enemies generated from math (PRD 9.4): ellipsoid body + head, mirrored for symmetry,
// varied by seed. Meshed into one BufferGeometry with hidden faces culled.

import * as THREE from "three";
import { mulberry32 } from "../shared/rng";
import type { EnemyKind } from "../shared/types";

interface Voxel { x: number; y: number; z: number; c: string }

const PALETTES: Record<EnemyKind, { body: string[]; belly: string; dark: string; eye: string; horn: string }> = {
  minion: { body: ["#6fbf4a", "#4fa3a0", "#9a6bd1", "#d17a4a"], belly: "#e7e0b0", dark: "#2f3d2a", eye: "#ffffff", horn: "#e8e2d0" },
  elite: { body: ["#b8322c", "#7d3cb8", "#2c6fb8"], belly: "#f0c8a0", dark: "#2a1418", eye: "#ffe14a", horn: "#f2efe6" },
  boss: { body: ["#4a2a6b", "#6b1f2a"], belly: "#c9a0ff", dark: "#140c1f", eye: "#ff3b3b", horn: "#e8c547" },
};

export const VOXEL_SIZE: Record<EnemyKind, number> = { minion: 0.1, elite: 0.14, boss: 0.27 };

export function voxelCreature(kind: EnemyKind, seed: number): Voxel[] {
  const r = mulberry32(seed);
  const pal = PALETTES[kind];
  const bodyCol = pal.body[Math.floor(r() * pal.body.length)];
  const out = new Map<string, Voxel>();
  const put = (x: number, y: number, z: number, c: string, mirror = true) => {
    out.set(`${x},${y},${z}`, { x, y, z, c });
    if (mirror) out.set(`${-x},${y},${z}`, { x: -x, y, z, c });
  };

  const body = { a: 2.2 + r() * 1.4, b: 2 + r() * 1.6, c: 2 + r() * 1.4 };
  const legs = r() < 0.5 ? 2 : 4;
  const legH = 1 + Math.floor(r() * 2);
  const cy = legH + body.b;

  // Body ellipsoid: (x/a)² + (y/b)² + (z/c)² ≤ 1, left half then mirror.
  for (let x = 0; x <= Math.ceil(body.a); x++)
    for (let y = -Math.ceil(body.b); y <= Math.ceil(body.b); y++)
      for (let z = -Math.ceil(body.c); z <= Math.ceil(body.c); z++)
        if ((x / body.a) ** 2 + (y / body.b) ** 2 + (z / body.c) ** 2 <= 1) {
          const belly = z > body.c * 0.4 && y < body.b * 0.3;
          put(x, Math.round(y + cy), z, belly ? pal.belly : r() < 0.07 ? pal.dark : bodyCol);
        }

  // Head.
  const head = { a: 1.4 + r() * 0.9, b: 1.2 + r() * 0.8, c: 1.3 + r() * 0.8 };
  const hy = Math.round(cy + body.b * 0.75 + head.b * 0.5);
  const hz = Math.round(body.c * 0.45);
  for (let x = 0; x <= Math.ceil(head.a); x++)
    for (let y = -Math.ceil(head.b); y <= Math.ceil(head.b); y++)
      for (let z = -Math.ceil(head.c); z <= Math.ceil(head.c); z++)
        if ((x / head.a) ** 2 + (y / head.b) ** 2 + (z / head.c) ** 2 <= 1) put(x, hy + y, hz + z, bodyCol);

  // Eyes on the front of the head.
  const ex = Math.max(1, Math.round(head.a * 0.5));
  const ez = hz + Math.round(head.c);
  put(ex, hy, ez + 1, pal.eye);
  put(ex, hy + 1, ez + 1, pal.eye);
  if (kind !== "minion") put(ex, hy, ez + 2, pal.dark);

  // Legs.
  const lx = Math.max(1, Math.round(body.a * 0.5));
  const lzs = legs === 2 ? [0] : [-Math.round(body.c * 0.5), Math.round(body.c * 0.5)];
  for (const lz of lzs) for (let y = 0; y < legH + 1; y++) put(lx, y, lz, pal.dark);

  // Arms / claws on the sides.
  const ay = Math.round(cy);
  const ax = Math.ceil(body.a) + 1;
  put(ax, ay, 1, bodyCol); put(ax, ay - 1, 1, bodyCol); put(ax, ay - 2, 2, pal.dark);

  // Horns for elite and boss.
  if (kind !== "minion") {
    const top = hy + Math.ceil(head.b);
    const hx = Math.max(1, Math.round(head.a * 0.7));
    const len = kind === "boss" ? 4 : 2 + Math.floor(r() * 2);
    for (let i = 0; i < len; i++) put(hx + Math.floor(i / 2), top + i, hz - Math.floor(i / 3), pal.horn);
  }
  // Crown for the mini boss.
  if (kind === "boss") {
    const top = hy + Math.ceil(head.b) + 1;
    for (let a = 0; a < 12; a++) {
      const x = Math.round(Math.cos((a / 12) * Math.PI * 2) * 1.8);
      const z = hz + Math.round(Math.sin((a / 12) * Math.PI * 2) * 1.8);
      put(x, top, z, "#e8c547", false);
      if (a % 3 === 0) put(x, top + 1, z, a % 2 ? "#ff3b3b" : "#e8c547", false);
    }
  }
  return [...out.values()];
}

const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

/** Face-culled voxel mesh, centered on X/Z with feet at y = 0. */
export function meshVoxels(voxels: Voxel[], size: number): THREE.BufferGeometry {
  const set = new Set(voxels.map((v) => `${v.x},${v.y},${v.z}`));
  const minY = Math.min(...voxels.map((v) => v.y));
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (const v of voxels) {
    c.set(v.c).convertSRGBToLinear();
    for (const f of FACES) {
      if (set.has(`${v.x + f.n[0]},${v.y + f.n[1]},${v.z + f.n[2]}`)) continue;
      const base = pos.length / 3;
      const shade = f.n[1] === 1 ? 1 : f.n[1] === -1 ? 0.6 : 0.85;
      for (const p of f.v) {
        pos.push((v.x + p[0] - 0.5) * size, (v.y - minY + p[1]) * size, (v.z + p[2] - 0.5) * size);
        nor.push(f.n[0], f.n[1], f.n[2]);
        col.push(c.r * shade, c.g * shade, c.b * shade);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export function creatureGeometry(kind: EnemyKind, seed: number) {
  const key = `${kind}:${seed}`;
  let g = geoCache.get(key);
  if (!g) { g = meshVoxels(voxelCreature(kind, seed), VOXEL_SIZE[kind]); geoCache.set(key, g); }
  return g;
}

export function disposeCreatureCache() {
  geoCache.forEach((g) => g.dispose());
  geoCache.clear();
}
