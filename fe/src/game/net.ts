// Game data sources. The renderer and HUD only see `GameSource`, so practice
// (local sim) and ranked (Colyseus server) look identical to them.
//
// ---- Server protocol (Colyseus room name: "match") ----
// join options:        { address, name, skin }
// server → client:
//   "lobby"   LobbyState                     whenever the lobby changes
//   "start"   { seed: number, selfId: string } match begins (map = generateMap(seed))
//   "state"   Snapshot                       every tick (20 Hz), events = events of that tick
//   "result"  MatchResult                    match over (settleTx may be missing)
//   "settled" { settleTx: `0x${string}` }    once settleMatch is mined
//   "error"   { message: string }
// client → server:
//   "paid"    { txHash }                     after joinMatch receipt; server checks PlayerJoined
//   "start"   {}                             host only, needs >= 3 paid players
//   "input"   InputMsg                       every tick while playing

import { Client, type Room } from "colyseus.js";
import { formatEther, parseEther } from "viem";
import { GAME } from "../shared/config";
import { generateMap } from "../shared/generateMap";
import type { GameEvent, InputMsg, LobbyState, MapData, MatchResult, Snapshot } from "../shared/types";
import { MatchSim, type SimPlayerInit } from "./sim";

export interface GameSource {
  readonly map: MapData;
  readonly selfId: string;
  readonly practice: boolean;
  latest(): Snapshot | null;
  /** Events since the last call (renderer drains once per frame). */
  drainEvents(): GameEvent[];
  sendInput(input: InputMsg): void;
  onEnd(cb: (r: MatchResult) => void): () => void;
  onSettled?(cb: (tx: `0x${string}`) => void): () => void;
  leave(): void;
  dispose(): void;
}

export function computePrizes(players: number, ticketWei = parseEther(GAME.economy.ticketMon)) {
  const pool = ticketWei * BigInt(players);
  const net = pool - (pool * BigInt(GAME.economy.feeBps)) / 10000n;
  const prizes = GAME.economy.prizeBps.map((bps) => ((net * BigInt(bps)) / 10000n).toString()) as [string, string, string];
  return { pool: pool.toString(), prizes };
}

export const fmtMon = (wei: string | bigint) => {
  const n = Number(formatEther(BigInt(wei)));
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

// ------------------------------------------------------------------ practice

const BOT_NAMES = ["Rusty", "Mira", "Kael", "Juno", "Bram", "Sela", "Tobi", "Nyx", "Odo", "Vex"];

export class LocalSource implements GameSource {
  readonly map: MapData;
  readonly selfId = "p0";
  readonly practice = true;
  private sim: MatchSim;
  private snap: Snapshot | null = null;
  private events: GameEvent[] = [];
  private timer: ReturnType<typeof setInterval>;
  private endCbs = new Set<(r: MatchResult) => void>();
  private ended = false;

  constructor(opts: { name: string; skin: number; bots: number; address?: string; seed?: number }) {
    const seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
    this.map = generateMap(seed);
    const players: SimPlayerInit[] = [{ id: "p0", name: opts.name, skin: opts.skin, address: opts.address }];
    for (let i = 0; i < opts.bots; i++) players.push({ id: `p${i + 1}`, name: BOT_NAMES[i % BOT_NAMES.length], skin: (i + 1) % 4, bot: true });
    this.sim = new MatchSim(this.map, players);
    this.snap = this.sim.snapshot();
    this.timer = setInterval(() => this.tick(), 1000 / GAME.tickHz);
  }

  private tick() {
    const s = this.sim.step();
    this.snap = s;
    this.events.push(...s.events);
    if (s.status === "ended" && !this.ended) {
      this.ended = true;
      clearInterval(this.timer);
      const { pool, prizes } = computePrizes(this.sim.players.length);
      const result: MatchResult = { seed: this.map.seed, standings: this.sim.standings(), prizesWei: prizes, poolWei: pool, practice: true };
      setTimeout(() => this.endCbs.forEach((cb) => cb(result)), 1500);
    }
  }

  latest() { return this.snap; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  sendInput(input: InputMsg) { this.sim.setInput(this.selfId, input); }
  onEnd(cb: (r: MatchResult) => void) { this.endCbs.add(cb); return () => this.endCbs.delete(cb); }
  leave() { clearInterval(this.timer); this.endCbs.clear(); }
  dispose() { clearInterval(this.timer); this.endCbs.clear(); }
}

// ------------------------------------------------------------------ ranked (Colyseus)

export class MatchConnection {
  readonly room: Room;
  lobby: LobbyState | null = null;
  private lobbyCbs = new Set<(l: LobbyState) => void>();
  private startCbs = new Set<(s: { seed: number; selfId: string }) => void>();
  private errorCbs = new Set<(m: string) => void>();
  private started: { seed: number; selfId: string } | null = null;

  private constructor(room: Room) {
    this.room = room;
    room.onMessage("lobby", (l: LobbyState) => { this.lobby = l; this.lobbyCbs.forEach((cb) => cb(l)); });
    room.onMessage("start", (s: { seed: number; selfId: string }) => { this.started = s; this.startCbs.forEach((cb) => cb(s)); });
    room.onMessage("error", (e: { message: string }) => this.errorCbs.forEach((cb) => cb(e.message)));
    room.onLeave((code) => { if (code > 1000) this.errorCbs.forEach((cb) => cb(`Disconnected from server (${code})`)); });
  }

  static async join(url: string, opts: { address: string; name: string; skin: number }) {
    const client = new Client(url);
    const room = await client.joinOrCreate("match", opts);
    return new MatchConnection(room);
  }

  get sessionId() { return this.room.sessionId; }
  onLobby(cb: (l: LobbyState) => void) { this.lobbyCbs.add(cb); if (this.lobby) cb(this.lobby); return () => { this.lobbyCbs.delete(cb); }; }
  onStart(cb: (s: { seed: number; selfId: string }) => void) { this.startCbs.add(cb); if (this.started) cb(this.started); return () => { this.startCbs.delete(cb); }; }
  onError(cb: (m: string) => void) { this.errorCbs.add(cb); return () => { this.errorCbs.delete(cb); }; }
  sendPaid(txHash: string) { this.room.send("paid", { txHash }); }
  requestStart() { this.room.send("start", {}); }
  leave() { void this.room.leave(); }
}

export class RemoteSource implements GameSource {
  readonly map: MapData;
  readonly selfId: string;
  readonly practice = false;
  private snap: Snapshot | null = null;
  private events: GameEvent[] = [];
  private endCbs = new Set<(r: MatchResult) => void>();
  private settledCbs = new Set<(tx: `0x${string}`) => void>();
  private conn: MatchConnection;

  constructor(conn: MatchConnection, seed: number, selfId: string) {
    this.conn = conn;
    this.map = generateMap(seed);
    this.selfId = selfId;
    conn.room.onMessage("state", (s: Snapshot) => { this.snap = s; this.events.push(...s.events); });
    conn.room.onMessage("result", (r: MatchResult) => this.endCbs.forEach((cb) => cb(r)));
    conn.room.onMessage("settled", (m: { settleTx: `0x${string}` }) => this.settledCbs.forEach((cb) => cb(m.settleTx)));
  }

  latest() { return this.snap; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  sendInput(input: InputMsg) { this.conn.room.send("input", input); }
  onEnd(cb: (r: MatchResult) => void) { this.endCbs.add(cb); return () => this.endCbs.delete(cb); }
  onSettled(cb: (tx: `0x${string}`) => void) { this.settledCbs.add(cb); return () => this.settledCbs.delete(cb); }
  leave() { void this.conn.leave(); this.dispose(); }
  dispose() { this.endCbs.clear(); this.settledCbs.clear(); }
}
