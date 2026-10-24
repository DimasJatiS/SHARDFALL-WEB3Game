// Data contract between client and server. Freeze this before parallel work.
// All game logic is 2D on the X-Z plane (tile units). Rendering adds the 3D.

export type Rarity = 0 | 1 | 2;
export type ItemKind = "armor" | "sword" | "staff" | "bow" | "heal" | "speed" | "maxhp" | "invuln";
export type ChestTier = "wood" | "iron" | "boss";
export type EnemyKind = "minion" | "elite" | "boss";
export type ObstacleKind = "spike" | "pool" | "barrel" | "tree";

export interface Item {
  id: string;
  kind: ItemKind;
  rarity: Rarity;
}

// ---------- Map (generated identically on client and server from the seed) ----------

export interface Camp {
  id: number;
  tier: ChestTier;
  x: number;
  z: number;
  guards: { kind: EnemyKind; x: number; z: number }[];
  /** Item kinds assigned to this chest. Rarity is rolled when it opens. */
  kinds: ItemKind[];
}

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  r: number;
}

export interface ZoneCircle {
  cx: number;
  cz: number;
  r: number;
}

export interface MapData {
  seed: number;
  size: number;
  /** Block height 0–3 per tile, index = z * size + x. */
  height: number[];
  /** Tile type per tile (see TILE in generateMap). */
  type: number[];
  spawns: { x: number; z: number }[];
  camps: Camp[];
  obstacles: Obstacle[];
  /** Zone circle at the end of each phase (index 0 = loot phase). */
  zones: ZoneCircle[];
}

// ---------- Realtime state (server → client every tick) ----------

export type PlayerAction = "idle" | "walk" | "attack" | "cast" | "defend" | "parry" | "stun" | "dead";

export interface PlayerState {
  id: string;
  name: string;
  address?: string;
  skin: number;
  bot?: boolean;
  x: number;
  z: number;
  /** Facing angle in radians, atan2(dz, dx). */
  face: number;
  hp: number;
  maxHp: number;
  stamina: number;
  weapon: Item | null;
  armor: Item | null;
  bag: (Item | null)[];
  coins: number;
  alive: boolean;
  action: PlayerAction;
  /** Server time when the current action started (for animation). */
  actionAt: number;
  invuln: boolean;
  speedBuff: boolean;
  parryBonus: boolean;
  openingChest: number | null;
  openProgress: number;
  kills: number;
  rank: number | null;
}

export type EnemyAI = "idle" | "chase" | "windup" | "recover" | "return" | "stun";

export interface EnemyState {
  id: string;
  kind: EnemyKind;
  campId: number;
  x: number;
  z: number;
  face: number;
  hp: number;
  maxHp: number;
  ai: EnemyAI;
  /** Seconds of windup left (boss slam telegraph etc). */
  windup: number;
}

export interface ChestState {
  id: number;
  tier: ChestTier;
  x: number;
  z: number;
  locked: boolean;
  opened: boolean;
  guardsLeft: number;
}

export interface LootPile {
  id: string;
  x: number;
  z: number;
  items: Item[];
  bag: boolean;
}

export interface Projectile {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface ZoneState {
  phase: number;
  cx: number;
  cz: number;
  r: number;
  next: ZoneCircle;
  phaseEndsAt: number;
  shrinking: boolean;
  dps: number;
  /** Quota checked at the end of the current phase (already scaled). 0 = none. */
  quota: number;
}

export type GameEvent =
  | { type: "hit"; x: number; z: number; amount: number; target: string; source?: string }
  | { type: "blocked"; x: number; z: number; target: string }
  | { type: "immune"; x: number; z: number; target: string }
  | { type: "parry"; x: number; z: number; target: string; attacker?: string }
  | { type: "swing"; id: string; face: number; weapon: ItemKind | "fist" }
  | { type: "cast"; id: string; x: number; z: number }
  | { type: "blast"; x: number; z: number; r: number; color: string }
  | { type: "explode"; x: number; z: number; r: number; id: number }
  | { type: "slam"; x: number; z: number; r: number }
  | { type: "guardBreak"; id: string }
  | { type: "chestOpened"; id: number; by: string }
  | { type: "pickup"; id: string; items: Item[] }
  | { type: "useItem"; id: string; kind: ItemKind }
  | { type: "kill"; killer?: string; victim: string; reason: "player" | "enemy" | "zone" | "quota" | "trap" }
  | { type: "enemyDown"; id: string; x: number; z: number; kind: string }
  | { type: "phase"; phase: number }
  | { type: "quota"; quota: number; eliminated: string[] };

export interface Snapshot {
  t: number;
  tick: number;
  status: "playing" | "ended";
  duration: number;
  players: PlayerState[];
  enemies: EnemyState[];
  chests: ChestState[];
  loot: LootPile[];
  projectiles: Projectile[];
  brokenBarrels: number[];
  zone: ZoneState;
  alive: number;
  events: GameEvent[];
}

// ---------- Input (client → server, every tick) ----------

export interface InputMsg {
  seq: number;
  /** World-space move direction (already rotated for the iso camera). */
  mx: number;
  mz: number;
  /** World-space aim point. */
  ax: number;
  az: number;
  attack: boolean;
  defend: boolean;
  /** Edge-triggered: true once per press. */
  parry: boolean;
  interact: boolean;
  pickup: boolean;
  /** Bag slot 0–5 to use/equip, or -1. */
  use: number;
}

// ---------- Lobby + results ----------

export interface LobbyPlayer {
  id: string;
  name: string;
  address: string;
  skin: number;
  paid: boolean;
}

export interface LobbyState {
  matchId: `0x${string}`;
  entryFeeWei: string;
  hostId: string;
  players: LobbyPlayer[];
  status: "waiting" | "starting" | "playing" | "cancelled";
  /** ms epoch when the lobby auto-cancels / auto-starts. */
  deadline: number;
}

export interface Standing {
  id: string;
  name: string;
  address?: string;
  rank: number;
  coins: number;
  kills: number;
  bot?: boolean;
}

export interface MatchResult {
  matchId?: `0x${string}`;
  seed: number;
  standings: Standing[];
  /** Prize per top-3 rank, in wei (string). */
  prizesWei: [string, string, string];
  poolWei: string;
  settleTx?: `0x${string}`;
  practice: boolean;
}
