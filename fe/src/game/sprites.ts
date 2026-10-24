// UI-side sprite lookups (lobby, HUD, results). In-world art is loaded by ./assets.

import type { ItemKind } from "../shared/types";
import { SKIN_IDS, assetUrl } from "./assets";

export const SKINS = SKIN_IDS.map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) }));

/** 128×128 portrait for lobby cards, skin picker and results. */
export function portrait(skin: number): string {
  return assetUrl(`ui/portraits/${SKIN_IDS[skin % SKIN_IDS.length]}.webp`);
}

/** 64×64 (@2x) item icon; draw it at 32–40 px with image-rendering: pixelated. */
export function itemIcon(kind: ItemKind | "coin"): string {
  return assetUrl(`icons/items/${kind}@2x.webp`);
}

export type BuffIcon = "immune" | "swift" | "double_hit" | "stunned";
export function buffIcon(kind: BuffIcon): string {
  return assetUrl(`icons/buffs/${kind}@2x.webp`);
}

export type StepIcon = "loot" | "quota" | "fight" | "paid";
export function stepIcon(kind: StepIcon): string {
  return assetUrl(`icons/steps/${kind}@2x.webp`);
}
