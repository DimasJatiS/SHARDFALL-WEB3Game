// Procedural 32×32 pixel sprites with a 1px dark outline (PRD 9.3).
// Skins are palette swaps of the same sprite, which keeps every asset consistent.

import type { ItemKind } from "../shared/types";

export const FRAME = 32;
export const FRAMES = { idle: [0, 1], walk: [2, 3, 4, 5], attack: [6, 7, 8], cast: [9, 10], defend: [11], stun: [12], dead: [13] };
export const FRAME_COUNT = 14;
const OUTLINE = "#1a1420";

export interface Palette {
  name: string;
  helm: string; helmShade: string;
  tunic: string; tunicShade: string;
  cape: string; plume: string;
  legs: string; skin: string;
}

export const SKINS: Palette[] = [
  { name: "Knight", helm: "#c9d1d9", helmShade: "#8b96a3", tunic: "#3d6fd1", tunicShade: "#284b94", cape: "#c43c3c", plume: "#e8c547", legs: "#4b3a2e", skin: "#f2c79b" },
  { name: "Ember", helm: "#e0763a", helmShade: "#a84d22", tunic: "#b8322c", tunicShade: "#7d1f1b", cape: "#2b2b2b", plume: "#ffd04a", legs: "#3a2a22", skin: "#e8b48a" },
  { name: "Verdant", helm: "#7fb04a", helmShade: "#4f7a2a", tunic: "#3e7d46", tunicShade: "#28552e", cape: "#d9b04a", plume: "#f0f0f0", legs: "#4a3b28", skin: "#f2c79b" },
  { name: "Void", helm: "#5a4a80", helmShade: "#3a2e57", tunic: "#2a2240", tunicShade: "#181328", cape: "#9b59ff", plume: "#ff6be0", legs: "#1e1a2a", skin: "#d8b8e8" },
];

type WeaponArt = "none" | "sword" | "staff" | "bow";
type Pose = { bob: number; legL: number; legR: number; weapon: "rest" | "raise" | "swing" | "follow" | "cast" | "cast2" | "block"; hit?: boolean; dead?: boolean };

const POSES: Pose[] = [
  { bob: 0, legL: 0, legR: 0, weapon: "rest" },
  { bob: 1, legL: 0, legR: 0, weapon: "rest" },
  { bob: 0, legL: -1, legR: 1, weapon: "rest" },
  { bob: 1, legL: 0, legR: 0, weapon: "rest" },
  { bob: 0, legL: 1, legR: -1, weapon: "rest" },
  { bob: 1, legL: 0, legR: 0, weapon: "rest" },
  { bob: 0, legL: 0, legR: 0, weapon: "raise" },
  { bob: 0, legL: 1, legR: -1, weapon: "swing" },
  { bob: 1, legL: 1, legR: -1, weapon: "follow" },
  { bob: 0, legL: 0, legR: 0, weapon: "cast" },
  { bob: 1, legL: 0, legR: 0, weapon: "cast2" },
  { bob: 1, legL: 0, legR: 0, weapon: "block" },
  { bob: 1, legL: 0, legR: 0, weapon: "rest", hit: true },
  { bob: 0, legL: 0, legR: 0, weapon: "rest", dead: true },
];

const sheetCache = new Map<string, HTMLCanvasElement>();

export function playerSheet(skin: number, weapon: WeaponArt): HTMLCanvasElement {
  const key = `${skin}:${weapon}`;
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = FRAME * FRAME_COUNT;
  c.height = FRAME;
  const ctx = c.getContext("2d")!;
  const pal = SKINS[skin % SKINS.length];
  POSES.forEach((pose, i) => drawCharacter(ctx, i * FRAME, pal, pose, weapon));
  outline(ctx, c.width, c.height);
  sheetCache.set(key, c);
  return c;
}

function drawCharacter(ctx: CanvasRenderingContext2D, ox: number, pal: Palette, pose: Pose, weapon: WeaponArt) {
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(ox + x, y, w, h);
  };
  if (pose.dead) {
    // Lying on the ground.
    px(6, 25, 6, 4, pal.helm); px(6, 25, 6, 1, pal.helmShade);
    px(12, 25, 9, 4, pal.tunic); px(12, 28, 9, 1, pal.tunicShade);
    px(21, 26, 6, 3, pal.legs);
    px(11, 29, 12, 1, pal.cape);
    return;
  }
  const b = pose.bob;
  // Cape (behind).
  px(10, 15 + b, 3, 10, pal.cape);
  px(10, 24 + b, 2, 1, pal.cape);
  // Legs.
  px(13, 24 + pose.legL, 3, 5 - pose.legL, pal.legs);
  px(17, 24 + pose.legR, 3, 5 - pose.legR, pal.legs);
  px(13, 29, 3, 1, OUTLINE);
  px(17, 29, 3, 1, OUTLINE);
  // Body.
  px(12, 15 + b, 9, 9, pal.tunic);
  px(12, 21 + b, 9, 1, pal.tunicShade);
  px(12, 15 + b, 2, 9, pal.tunicShade);
  px(16, 21 + b, 1, 1, "#e8c547");
  // Head / helmet.
  px(12, 6 + b, 8, 9, pal.helm);
  px(12, 6 + b, 8, 1, pal.helmShade);
  px(12, 6 + b, 1, 9, pal.helmShade);
  px(16, 10 + b, 4, 3, pal.skin);
  px(18, 11 + b, 1, 1, OUTLINE);
  px(14, 3 + b, 3, 3, pal.plume);
  px(13, 4 + b, 1, 2, pal.plume);
  if (pose.hit) px(12, 6 + b, 8, 18, "rgba(255,255,255,0.55)");

  const hand = { x: 21, y: 19 + b };
  const steel = "#dfe6ee", steelShade = "#8b96a3", wood = "#8a5a2b", gold = "#e8c547";
  const line = (x0: number, y0: number, x1: number, y1: number, col: string) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, col);
  };

  if (pose.weapon === "block") {
    px(20, 13 + b, 3, 7, pal.tunicShade);
    if (weapon === "sword") { line(19, 12 + b, 27, 12 + b, steel); px(22, 11 + b, 1, 3, gold); }
    else if (weapon !== "none") line(20, 8 + b, 27, 16 + b, wood);
    return;
  }
  // Arm.
  const armUp = pose.weapon === "raise" || pose.weapon === "cast";
  if (armUp) px(20, 12 + b, 2, 5, pal.tunicShade);
  else px(20, 16 + b, 2, 4, pal.tunicShade);
  const hx = armUp ? 21 : hand.x, hy = armUp ? 12 + b : hand.y;
  px(hx, hy, 2, 2, pal.skin);

  if (weapon === "sword") {
    switch (pose.weapon) {
      case "rest": line(22, 8 + b, 22, 18 + b, steel); line(23, 9 + b, 23, 17 + b, steelShade); px(21, 18 + b, 3, 1, gold); break;
      case "raise": line(21, 11 + b, 14, 2 + b, steel); px(20, 11 + b, 3, 1, gold); break;
      case "swing": line(23, 18 + b, 31, 17 + b, steel); line(23, 19 + b, 30, 18 + b, steelShade); px(22, 17 + b, 1, 3, gold); break;
      case "follow": line(22, 20 + b, 29, 28, steel); px(21, 20 + b, 3, 1, gold); break;
      default: line(22, 8 + b, 22, 18 + b, steel); break;
    }
  } else if (weapon === "staff") {
    const orb = pose.weapon === "cast" || pose.weapon === "cast2" ? "#ff9bff" : "#b06bff";
    if (pose.weapon === "cast" || pose.weapon === "cast2" || pose.weapon === "raise" || pose.weapon === "swing") {
      line(22, 2 + b, 22, 18 + b, wood);
      px(21, 0 + b, 3, 3, orb);
      if (pose.weapon === "cast2") { px(19, 0, 1, 1, "#ffd6ff"); px(25, 1, 1, 1, "#ffd6ff"); px(24, 4, 1, 1, "#ffd6ff"); }
    } else {
      line(23, 5 + b, 23, 28, wood);
      px(22, 3 + b, 3, 3, orb);
    }
  } else if (weapon === "bow") {
    const drawn = pose.weapon === "raise" || pose.weapon === "swing";
    const bx = drawn ? 25 : 24;
    line(bx, 11 + b, bx + 2, 14 + b, wood); line(bx + 2, 14 + b, bx + 2, 21 + b, wood); line(bx + 2, 21 + b, bx, 24 + b, wood);
    line(drawn ? 21 : bx, 12 + b, drawn ? 21 : bx, 23 + b, "#e8e2d0");
    if (drawn) line(21, 18 + b, 29, 18 + b, steelShade);
  } else if (pose.weapon === "swing" || pose.weapon === "follow") {
    px(23, 18 + b, 2, 2, pal.skin);
  }
}

function outline(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0 && !(d[(y * w + x) * 4] === 26 && d[(y * w + x) * 4 + 1] === 20);
  const mark: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) continue;
      if ((x % FRAME !== 0 && solid(x - 1, y)) || ((x + 1) % FRAME !== 0 && solid(x + 1, y)) || solid(x, y - 1) || solid(x, y + 1)) mark.push(y * w + x);
    }
  for (const i of mark) { d[i * 4] = 26; d[i * 4 + 1] = 20; d[i * 4 + 2] = 32; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------ item icons

const iconCache = new Map<string, string>();

export function itemIcon(kind: ItemKind): string {
  const hit = iconCache.get(kind);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const ctx = c.getContext("2d")!;
  const px = (x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  const line = (x0: number, y0: number, x1: number, y1: number, col: string) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, col);
  };
  switch (kind) {
    case "sword":
      line(5, 10, 13, 2, "#e6edf3"); line(6, 10, 13, 3, "#9aa6b2"); line(3, 9, 7, 13, "#e8c547"); line(2, 13, 4, 11, "#7a4a22"); break;
    case "staff":
      line(3, 14, 10, 6, "#8a5a2b"); line(4, 14, 11, 6, "#5e3a1a"); px(10, 2, 4, 4, "#b06bff"); px(11, 3, 2, 2, "#ffd6ff"); break;
    case "bow":
      line(4, 2, 8, 4, "#8a5a2b"); line(8, 4, 10, 8, "#8a5a2b"); line(10, 8, 8, 12, "#8a5a2b"); line(8, 12, 4, 14, "#8a5a2b");
      line(4, 2, 4, 14, "#e8e2d0"); line(2, 8, 13, 8, "#9aa6b2"); px(13, 7, 2, 3, "#c9d1d9"); break;
    case "armor":
      px(3, 3, 10, 10, "#9aa6b2"); px(3, 3, 3, 3, "#c9d1d9"); px(10, 3, 3, 3, "#c9d1d9"); px(6, 3, 4, 2, "rgba(0,0,0,0)");
      ctx.clearRect(6, 3, 4, 2); px(5, 6, 6, 6, "#c9d1d9"); px(7, 6, 2, 6, "#e8c547"); px(4, 12, 8, 2, "#6b7580"); break;
    case "heal":
      px(6, 2, 4, 2, "#c9a27a"); px(7, 4, 2, 2, "#d9e6f2"); px(4, 6, 8, 8, "#e04848"); px(5, 7, 2, 2, "#ff9a9a"); px(4, 13, 8, 1, "#9a2a2a"); break;
    case "speed":
      line(10, 1, 5, 8, "#ffd04a"); line(5, 8, 10, 8, "#ffd04a"); line(10, 8, 6, 15, "#ffd04a"); line(11, 1, 6, 8, "#fff2a8"); break;
    case "maxhp":
      px(3, 4, 4, 4, "#ff5577"); px(9, 4, 4, 4, "#ff5577"); px(3, 6, 10, 3, "#ff5577"); px(4, 9, 8, 2, "#ff5577"); px(6, 11, 4, 2, "#ff5577"); px(7, 13, 2, 1, "#ff5577");
      px(4, 5, 2, 2, "#ffc0cc"); break;
    case "invuln":
      px(3, 2, 10, 8, "#e8c547"); px(4, 10, 8, 2, "#e8c547"); px(6, 12, 4, 2, "#e8c547"); px(7, 3, 2, 10, "#fff2a8"); px(4, 5, 8, 2, "#fff2a8"); break;
  }
  outline16(ctx);
  const url = c.toDataURL();
  iconCache.set(kind, url);
  return url;
}

function outline16(ctx: CanvasRenderingContext2D) {
  const img = ctx.getImageData(0, 0, 16, 16);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 200;
  const mark: number[] = [];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) mark.push(y * 16 + x);
  for (const i of mark) { d[i * 4] = 26; d[i * 4 + 1] = 20; d[i * 4 + 2] = 32; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
}

/** Small portrait (idle frame) as a data URL, for lobby and skin picker. */
export function portrait(skin: number, weapon: WeaponArt = "sword"): string {
  const sheet = playerSheet(skin, weapon);
  const c = document.createElement("canvas");
  c.width = c.height = FRAME;
  c.getContext("2d")!.drawImage(sheet, 0, 0, FRAME, FRAME, 0, 0, FRAME, FRAME);
  return c.toDataURL();
}
