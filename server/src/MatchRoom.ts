// One Colyseus room = one on-chain match.
// Lifecycle: create (commit seed hash on-chain) → lobby (players pay joinMatch) → playing (20 Hz sim)
// → ended (settleMatch reveals the seed and pays the top 3).
// Protocol is documented at the top of fe/src/game/net.ts.

import { Room, type Client } from "colyseus";
import { getAddress, isAddress, isHex, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { randomBytes } from "node:crypto";
import { MatchSim } from "../../fe/src/game/sim";
import { GAME } from "../../fe/src/shared/config";
import { generateMap } from "../../fe/src/shared/generateMap";
import type { InputMsg, LobbyPlayer, LobbyState, MatchResult } from "../../fe/src/shared/types";
import { computePrizes } from "./prizes";
import { chainEnabled, createMatch, settleMatch, verifyJoin } from "./chain";

const LOBBY_SECONDS = Number(process.env.LOBBY_SECONDS || 120); // matches MatchEscrow.LOBBY_TIMEOUT
const ENTRY_FEE = parseEther(process.env.ENTRY_FEE_MON || GAME.economy.ticketMon);

interface Seat extends LobbyPlayer {
  simId?: string;
  verifying?: boolean;
}

export class MatchRoom extends Room {
  maxClients = GAME.players.max;
  private matchId!: Hex;
  private seed!: Hex;
  private seedNum = 0;
  private createTx?: Hex;
  private seats = new Map<string, Seat>();
  private hostId = "";
  private status: LobbyState["status"] = "waiting";
  private deadline = 0;
  private sim?: MatchSim;
  private bySession = new Map<string, string>();
  private ended = false;

  async onCreate() {
    this.matchId = toHex(randomBytes(32));
    this.seed = toHex(randomBytes(32));
    // PRD v2: the map PRNG seed is the first 4 bytes of the committed bytes32 seed.
    this.seedNum = parseInt(this.seed.slice(2, 10), 16);
    const seedHash = keccak256(this.seed);
    console.log(`[room ${this.roomId}] match ${this.matchId} seed ${this.seed} (map ${this.seedNum})`);
    this.createTx = await createMatch(this.matchId, ENTRY_FEE, GAME.players.max, seedHash);
    this.deadline = Date.now() + LOBBY_SECONDS * 1000;
    this.clock.setTimeout(() => this.onLobbyDeadline(), LOBBY_SECONDS * 1000);

    this.onMessage("paid", (client, msg: { txHash?: string }) => void this.onPaid(client, msg?.txHash));
    this.onMessage("start", (client) => {
      if (client.sessionId !== this.hostId) return client.send("error", { message: "Only the host can start" });
      if (this.paidSeats().length < GAME.players.min) return client.send("error", { message: `Need ${GAME.players.min} paid players` });
      this.startMatch();
    });
    this.onMessage("input", (client, msg: InputMsg) => {
      const id = this.bySession.get(client.sessionId);
      if (!this.sim || !id || !msg) return;
      this.sim.setInput(id, sanitize(msg));
    });
  }

  onJoin(client: Client, options: { address?: string; name?: string; skin?: number }) {
    if (this.status !== "waiting") throw new Error("Match already started");
    if (!options?.address || !isAddress(options.address)) throw new Error("A wallet address is required");
    const address = getAddress(options.address);
    if ([...this.seats.values()].some((s) => s.address === address)) throw new Error("This wallet is already in the lobby");
    const name = String(options.name ?? "Raider").slice(0, 14) || "Raider";
    const skin = Math.max(0, Math.min(3, Number(options.skin) || 0));
    this.seats.set(client.sessionId, { id: client.sessionId, name, address, skin, paid: false });
    if (!this.hostId) this.hostId = client.sessionId;
    this.pushLobby();
  }

  onLeave(client: Client) {
    const seat = this.seats.get(client.sessionId);
    // Paid players keep their seat (their ticket is in the escrow); unpaid ones are removed.
    if (seat && !seat.paid && this.status === "waiting") this.seats.delete(client.sessionId);
    if (this.hostId === client.sessionId) this.hostId = [...this.seats.keys()][0] ?? "";
    this.pushLobby();
  }

  // ---------------------------------------------------------------- lobby

  private paidSeats() {
    return [...this.seats.values()].filter((s) => s.paid);
  }

  private lobbyState(): LobbyState {
    return {
      matchId: this.matchId,
      entryFeeWei: ENTRY_FEE.toString(),
      hostId: this.hostId,
      players: [...this.seats.values()].map(({ id, name, address, skin, paid }) => ({ id, name, address, skin, paid })),
      status: this.status,
      deadline: this.deadline,
      createTx: this.createTx,
    };
  }

  private pushLobby() {
    if (this.status === "playing") return;
    this.broadcast("lobby", this.lobbyState());
  }

  private async onPaid(client: Client, txHash?: string) {
    const seat = this.seats.get(client.sessionId);
    if (!seat || seat.paid || seat.verifying || this.status !== "waiting") return;
    if (chainEnabled && (!txHash || !isHex(txHash))) return client.send("error", { message: "Missing join transaction hash" });
    seat.verifying = true;
    try {
      const ok = await verifyJoin(this.matchId, seat.address as Address, txHash as Hex);
      if (!ok) return client.send("error", { message: "Ticket not found in MatchEscrow for this wallet" });
      seat.paid = true;
      console.log(`[room ${this.roomId}] ${seat.name} (${seat.address}) paid ${txHash ?? "(off-chain)"}`);
      this.pushLobby();
      if (this.paidSeats().length >= GAME.players.max) this.startMatch();
    } catch (e) {
      client.send("error", { message: `Could not verify ticket: ${(e as Error).message.split("\n")[0]}` });
    } finally {
      seat.verifying = false;
    }
  }

  private onLobbyDeadline() {
    if (this.status !== "waiting") return;
    if (this.paidSeats().length >= GAME.players.min) return this.startMatch();
    this.status = "cancelled";
    this.pushLobby();
    console.log(`[room ${this.roomId}] cancelled: not enough paid players. Players can call refund(${this.matchId}).`);
  }

  // ---------------------------------------------------------------- match

  private startMatch() {
    if (this.status !== "waiting") return;
    this.status = "playing";
    void this.lock();
    const paid = this.paidSeats();
    // Unpaid players can't play a ticketed match.
    for (const c of this.clients) {
      if (!this.seats.get(c.sessionId)?.paid) { c.send("error", { message: "Match started without your ticket" }); c.leave(4000); }
    }
    paid.forEach((s, i) => { s.simId = `p${i}`; this.bySession.set(s.id, s.simId); });
    this.sim = new MatchSim(generateMap(this.seedNum), paid.map((s) => ({ id: s.simId!, name: s.name, skin: s.skin, address: s.address })));
    for (const c of this.clients) {
      const seat = this.seats.get(c.sessionId);
      if (seat?.simId) c.send("start", { seed: this.seedNum, selfId: seat.simId });
    }
    console.log(`[room ${this.roomId}] started with ${paid.length} players`);
    this.setSimulationInterval(() => this.tick(), 1000 / GAME.tickHz);
  }

  private tick() {
    if (!this.sim || this.ended) return;
    const snap = this.sim.step();
    this.broadcast("state", snap);
    if (snap.status === "ended") void this.finish();
  }

  private async finish() {
    this.ended = true;
    this.setSimulationInterval(undefined);
    const sim = this.sim!;
    const standings = sim.standings();
    const { pool, prizes } = computePrizes(sim.players.length, ENTRY_FEE);
    const result: MatchResult = {
      matchId: this.matchId,
      seed: this.seedNum,
      seedHex: this.seed,
      seedHash: keccak256(this.seed),
      createTx: this.createTx,
      standings,
      prizesWei: prizes,
      poolWei: pool,
      practice: false,
    };
    this.broadcast("result", result);
    const top3 = standings.slice(0, 3).map((s) => s.address as Address) as [Address, Address, Address];
    console.log(`[room ${this.roomId}] ended. top3 ${top3.join(", ")}`);
    try {
      const settleTx = await settleMatch(this.matchId, top3, this.seed);
      if (settleTx) this.broadcast("settled", { settleTx });
    } catch (e) {
      console.error(`[room ${this.roomId}] settleMatch failed:`, e);
      this.broadcast("error", { message: "Settlement failed. Tickets become refundable 15 minutes after the match was created." });
    }
  }
}

function sanitize(m: InputMsg): InputMsg {
  const num = (v: unknown, lim = 1e4) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
  const mx = num(m.mx, 1), mz = num(m.mz, 1);
  const use = Number.isInteger(m.use) && m.use >= 0 && m.use < 6 ? m.use : -1;
  return {
    seq: num(m.seq, Number.MAX_SAFE_INTEGER), mx, mz, ax: num(m.ax), az: num(m.az),
    attack: !!m.attack, defend: !!m.defend, parry: !!m.parry, interact: !!m.interact, pickup: !!m.pickup, use,
  };
}
