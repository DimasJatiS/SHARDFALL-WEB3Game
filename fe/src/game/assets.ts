// Loads assetv2 (see assetv2/README.md) once and keeps it for every match.
// Paths, frame sizes, pivots and fps all come from manifest.json, so re-slicing the
// sheets in Figma never needs a code change here.

import * as THREE from "three";
import type { EnemyKind, ItemKind } from "../shared/types";

export const ASSET_BASE = "/assetv2/";
export const assetUrl = (path: string) => ASSET_BASE + path;

export type WeaponArt = "unarmed" | "sword" | "staff" | "bow";
export const SKIN_IDS = ["knight", "ember", "verdant", "void"] as const;

const ENEMY_SPRITE: Record<EnemyKind, string> = { minion: "crawler", elite: "enforcer", boss: "titan" };
const TILE_NAMES = ["grass", "dirt", "stone", "sand", "water", "side_soil", "side_metal", "side_concrete"] as const;
const VFX_NAMES = [
  "slash", "hit", "cast_ring", "staff_impact", "parry", "stun", "slam",
  "chest_burst", "explosion", "zone_wall", "loot_beam", "immune_bubble",
] as const;
type TileName = (typeof TILE_NAMES)[number];
export type VfxName = (typeof VFX_NAMES)[number];

// ------------------------------------------------------------------ manifest

interface AnimDef { frames: string[]; fps: number; loop: boolean }
interface SpriteDef { dir: string; frameWidth: number; frameHeight: number; pivot: [number, number]; anims: Record<string, AnimDef> }
interface ImageDef { file: string; hd?: string; width: number; height: number; pivot?: [number, number] }
interface Manifest {
  sprites: Record<string, SpriteDef>;
  images: {
    sprites: { skins: Record<string, ImageDef> };
    icons: Record<"items" | "buffs" | "steps", Record<string, ImageDef>>;
    world: Record<"chests" | "traps" | "props" | "tiles", Record<string, ImageDef>>;
    vfx: Record<string, ImageDef>;
  };
}

// ------------------------------------------------------------------ public types

/** Every frame of one character packed left to right in a single canvas. */
export interface SpriteSheet {
  canvas: HTMLCanvasElement;
  frameW: number;
  frameH: number;
  pivot: [number, number];
  count: number;
  anims: Record<string, { frames: number[]; fps: number; loop: boolean }>;
}

/** A single image as a texture, plus its pixel size and pivot (bottom-centre by default). */
export interface Img {
  tex: THREE.Texture;
  w: number;
  h: number;
  pivot: [number, number];
}

export interface GameAssets {
  enemies: Record<EnemyKind, SpriteSheet>;
  /** Raider sheet in a given skin; skins are palette swaps of the Knight frames. */
  playerSheet(skin: number, weapon: WeaponArt): HTMLCanvasElement;
  raider: Record<WeaponArt, SpriteSheet>;
  tiles: Record<TileName, THREE.Texture>;
  chests: Record<string, Img>;
  props: Record<string, Img>;
  traps: Record<string, Img>;
  items: Record<ItemKind | "coin", Img>;
  vfx: Record<VfxName, Img>;
}

// ------------------------------------------------------------------ helpers

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(
    () => img,
    () => { throw new Error(`Asset gagal dimuat: ${url}`); },
  );
}

function pixelTexture(source: TexImageSource, repeat = false) {
  const t = new THREE.Texture(source as HTMLImageElement);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function packSheet(def: SpriteDef, images: Map<string, HTMLImageElement>): SpriteSheet {
  const anims: SpriteSheet["anims"] = {};
  const order: string[] = [];
  for (const [name, a] of Object.entries(def.anims)) {
    anims[name] = { frames: a.frames.map((f) => order.push(f) - 1), fps: a.fps, loop: a.loop };
  }
  const canvas = document.createElement("canvas");
  canvas.width = def.frameWidth * order.length;
  canvas.height = def.frameHeight;
  const ctx = canvas.getContext("2d")!;
  order.forEach((f, i) => ctx.drawImage(images.get(f)!, i * def.frameWidth, 0, def.frameWidth, def.frameHeight));
  return { canvas, frameW: def.frameWidth, frameH: def.frameHeight, pivot: def.pivot, count: order.length, anims };
}

// ------------------------------------------------------------------ palette swap

/**
 * Skins are palette swaps of the Knight frames (assetv2/README.md). The skin reference
 * sprites share the Knight's pose and pivot pixel for pixel, so every Knight colour —
 * shading included — is mapped to whatever colour the same pixels have in the other skin.
 */
interface Swap {
  from: number[][];
  to: number[][];
}
/** Max RGB distance between a frame colour and a learned Knight colour to recolour it. */
const SWAP_TOLERANCE = 76;

const pixels = (img: HTMLImageElement) => {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
};

function deriveSwap(knight: HTMLImageElement, skin: HTMLImageElement): Swap {
  const a = pixels(knight), b = pixels(skin);
  // knight colour → (skin colour → count)
  const votes = new Map<number, Map<number, number>>();
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    if (a[i + 3] < 200 || b[i + 3] < 200) continue;
    const from = (a[i] << 16) | (a[i + 1] << 8) | a[i + 2];
    const to = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    const v = votes.get(from) ?? new Map<number, number>();
    v.set(to, (v.get(to) ?? 0) + 1);
    votes.set(from, v);
  }
  const rgb = (c: number) => [c >> 16, (c >> 8) & 255, c & 255];
  const swap: Swap = { from: [], to: [] };
  for (const [from, v] of votes) {
    const [to] = [...v].sort((x, y) => y[1] - x[1])[0];
    swap.from.push(rgb(from));
    swap.to.push(rgb(to));
  }
  return swap;
}

function applySwap(src: HTMLCanvasElement, swap: Swap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const memo = new Map<number, number[] | null>();
  const lookup = (r: number, g: number, b: number) => {
    const key = (r << 16) | (g << 8) | b;
    let hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = -1, bestD = SWAP_TOLERANCE * SWAP_TOLERANCE;
    swap.from.forEach(([fr, fg, fb], i) => {
      const dist = (r - fr) ** 2 + (g - fg) ** 2 + (b - fb) ** 2;
      if (dist < bestD) { bestD = dist; best = i; }
    });
    hit = best < 0 ? null : swap.to[best];
    memo.set(key, hit);
    return hit;
  };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const t = lookup(d[i], d[i + 1], d[i + 2]);
    if (!t) continue;
    d[i] = t[0];
    d[i + 1] = t[1];
    d[i + 2] = t[2];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ loader

let pending: Promise<GameAssets> | null = null;

/** Starts (or joins) the one-time asset load. Safe to call early, e.g. from the lobby. */
export function loadGameAssets(onProgress?: (done: number, total: number) => void): Promise<GameAssets> {
  pending ??= load(onProgress).catch((e) => {
    pending = null; // allow a retry
    throw e;
  });
  return pending;
}

async function load(onProgress?: (done: number, total: number) => void): Promise<GameAssets> {
  const manifest: Manifest = await fetch(assetUrl("manifest.json")).then((r) => {
    if (!r.ok) throw new Error(`manifest.json tidak ditemukan (${r.status}). Jalankan npm run sync-assets.`);
    return r.json();
  });
  const { images: im } = manifest;

  // Fail early with a readable list if a re-sliced manifest dropped something the game draws.
  const required: [string, unknown][] = [
    ...(["raider_unarmed", "raider_sword", "raider_staff", "raider_bow", ...Object.values(ENEMY_SPRITE)].map((k) => [`sprites.${k}`, manifest.sprites[k]]) as [string, unknown][]),
    ...SKIN_IDS.map((k) => [`skins.${k}`, im.sprites.skins[k]] as [string, unknown]),
    ...TILE_NAMES.map((k) => [`tiles.${k}`, im.world.tiles[k]] as [string, unknown]),
    ...VFX_NAMES.map((k) => [`vfx.${k}`, im.vfx[k]] as [string, unknown]),
    ...["chest_wood", "chest_iron", "chest_boss", "chest_wood_open", "chest_iron_open", "chest_boss_open"].map((k) => [`chests.${k}`, im.world.chests[k]] as [string, unknown]),
    ...["spike_off", "spike_on", "lava_pool"].map((k) => [`traps.${k}`, im.world.traps[k]] as [string, unknown]),
    ...["barrel", "tree_a", "tree_b"].map((k) => [`props.${k}`, im.world.props[k]] as [string, unknown]),
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Aset hilang di manifest.json: ${missing.join(", ")}`);

  const paths = new Set<string>();
  for (const s of Object.values(manifest.sprites)) for (const a of Object.values(s.anims)) a.frames.forEach((f) => paths.add(f));
  const groups = [im.sprites.skins, im.icons.items, im.world.chests, im.world.traps, im.world.props, im.vfx];
  for (const g of groups) for (const d of Object.values(g)) paths.add(d.file);
  for (const t of TILE_NAMES) paths.add(im.world.tiles[t].hd ?? im.world.tiles[t].file);

  let done = 0;
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...paths].map(async (p) => {
      images.set(p, await loadImage(assetUrl(p)));
      onProgress?.(++done, paths.size);
    }),
  );

  const imgs = (group: Record<string, ImageDef>) =>
    Object.fromEntries(
      Object.entries(group).map(([k, d]) => [k, { tex: pixelTexture(images.get(d.file)!), w: d.width, h: d.height, pivot: d.pivot ?? [d.width / 2, d.height] }]),
    );

  const raider = Object.fromEntries(
    (["unarmed", "sword", "staff", "bow"] as const).map((w) => [w, packSheet(manifest.sprites[`raider_${w}`], images)]),
  ) as Record<WeaponArt, SpriteSheet>;

  const knightRef = images.get(im.sprites.skins.knight.file)!;
  const swaps = SKIN_IDS.map((id, i) => (i === 0 ? null : deriveSwap(knightRef, images.get(im.sprites.skins[id].file)!)));
  const sheets = new Map<string, HTMLCanvasElement>();

  return {
    raider,
    playerSheet(skin, weapon) {
      const i = ((skin % SKIN_IDS.length) + SKIN_IDS.length) % SKIN_IDS.length;
      const key = `${i}:${weapon}`;
      let c = sheets.get(key);
      if (!c) {
        const swap = swaps[i];
        c = swap ? applySwap(raider[weapon].canvas, swap) : raider[weapon].canvas;
        sheets.set(key, c);
      }
      return c;
    },
    enemies: {
      minion: packSheet(manifest.sprites[ENEMY_SPRITE.minion], images),
      elite: packSheet(manifest.sprites[ENEMY_SPRITE.elite], images),
      boss: packSheet(manifest.sprites[ENEMY_SPRITE.boss], images),
    },
    tiles: Object.fromEntries(
      TILE_NAMES.map((t) => [t, pixelTexture(images.get(im.world.tiles[t].hd ?? im.world.tiles[t].file)!, true)]),
    ) as Record<TileName, THREE.Texture>,
    chests: imgs(im.world.chests),
    props: imgs(im.world.props),
    traps: imgs(im.world.traps),
    items: imgs(im.icons.items) as Record<ItemKind | "coin", Img>,
    vfx: imgs(im.vfx) as Record<VfxName, Img>,
  };
}
