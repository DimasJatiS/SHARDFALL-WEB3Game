// Authoritative match simulation implementing PRD section 4.
// Runs in the browser for offline practice; the Colyseus server can reuse it as-is.

import { GAME, itemValue, rarityMult, scaledQuota } from "../shared/config";
import { isWalkable, zoneAt } from "../shared/generateMap";
import { hash2, mulberry32, type Rand } from "../shared/rng";
import type {
  ChestState, EnemyState, GameEvent, InputMsg, Item, ItemKind, LootPile, MapData,
  PlayerState, Projectile, Rarity, Snapshot, Standing,
} from "../shared/types";

const DT = 1 / GAME.tickHz;
const C = GAME.combat;

interface PInt {
  input: InputMsg;
  atkCd: number;
  parryT: number;
  parryHit: boolean;
  parryCd: number;
  bonusT: number;
  stunT: number;
  castT: number;
  castX: number;
  castZ: number;
  invulnT: number;
  speedT: number;
  maxBonus: number;
  spikeCycle: Record<number, number>;
  defending: boolean;
  lastHitBy?: string;
  lastHitAt: number;
}

interface EInt {
  homeX: number;
  homeZ: number;
  target?: string;
  cd: number;
  stunT: number;
  wander: number;
  wx: number;
  wz: number;
}

interface Proj extends Projectile {
  owner: string;
  damage: number;
  left: number;
}

type Target =
  | { t: "player"; p: PlayerState }
  | { t: "enemy"; e: EnemyState }
  | { t: "barrel"; id: number; x: number; z: number };

export const emptyInput = (): InputMsg => ({
  seq: 0, mx: 0, mz: 0, ax: 0, az: 0, attack: false, defend: false, parry: false, interact: false, pickup: false, use: -1,
});

export interface SimPlayerInit {
  id: string;
  name: string;
  skin: number;
  address?: string;
  bot?: boolean;
}

export class MatchSim {
  readonly map: MapData;
  t = 0;
  tick = 0;
  status: "playing" | "ended" = "playing";
  players: PlayerState[] = [];
  enemies: EnemyState[] = [];
  chests: ChestState[] = [];
  loot: LootPile[] = [];
  projectiles: Proj[] = [];
  brokenBarrels = new Set<number>();
  private pi = new Map<string, PInt>();
  private ei = new Map<string, EInt>();
  private events: GameEvent[] = [];
  private eliminated: string[][] = [];
  private uid = 0;
  private lastPhase = 0;
  private rand: Rand;
  private bots = new Map<string, BotBrain>();

  constructor(map: MapData, players: SimPlayerInit[]) {
    this.map = map;
    this.rand = mulberry32(map.seed ^ 0xabcdef);
    players.forEach((init, i) => {
      const s = map.spawns[i % map.spawns.length];
      const p: PlayerState = {
        ...init,
        x: s.x, z: s.z,
        face: Math.atan2(map.size / 2 - s.z, map.size / 2 - s.x),
        hp: GAME.player.hp, maxHp: GAME.player.hp, stamina: GAME.player.stamina,
        weapon: null, armor: null, bag: [null, null, null, null, null, null],
        coins: 0, alive: true, action: "idle", actionAt: 0,
        invuln: true, speedBuff: false, parryBonus: false,
        openingChest: null, openProgress: 0, kills: 0, rank: null,
      };
      this.players.push(p);
      this.pi.set(p.id, {
        input: emptyInput(), atkCd: 0, parryT: 0, parryHit: false, parryCd: 0, bonusT: 0, stunT: 0,
        castT: 0, castX: 0, castZ: 0, invulnT: GAME.player.spawnInvuln, speedT: 0, maxBonus: 0,
        spikeCycle: {}, defending: false, lastHitAt: -99,
      });
      if (init.bot) this.bots.set(p.id, new BotBrain(p.id, mulberry32(hash2(map.seed, i))));
    });
    for (const camp of map.camps) {
      this.chests.push({ id: camp.id, tier: camp.tier, x: camp.x, z: camp.z, locked: true, opened: false, guardsLeft: camp.guards.length });
      camp.guards.forEach((g) => {
        const def = GAME.enemies[g.kind];
        const e: EnemyState = {
          id: `e${this.uid++}`, kind: g.kind, campId: camp.id, x: g.x, z: g.z, face: 0,
          hp: def.hp, maxHp: def.hp, ai: "idle", windup: 0,
        };
        this.enemies.push(e);
        this.ei.set(e.id, { homeX: g.x, homeZ: g.z, cd: 0, stunT: 0, wander: 0, wx: g.x, wz: g.z });
      });
    }
  }

  setInput(id: string, input: InputMsg) {
    const s = this.pi.get(id);
    if (!s) return;
    // Keep edge-triggered flags until the sim consumes them.
    const prev = s.input;
    s.input = {
      ...input,
      parry: input.parry || prev.parry,
      pickup: input.pickup || prev.pickup,
      use: input.use >= 0 ? input.use : prev.use,
    };
  }

  step(): Snapshot {
    if (this.status === "ended") return this.snapshot();
    this.t += DT;
    this.tick++;
    for (const [id, brain] of this.bots) {
      const p = this.player(id);
      if (p?.alive) this.setInput(id, brain.think(this, p));
    }
    for (const p of this.players) if (p.alive) this.stepPlayer(p);
    this.stepProjectiles();
    for (const e of this.enemies) if (e.hp > 0) this.stepEnemy(e);
    this.separate();
    this.stepHazards();
    this.stepZone();
    for (const p of this.players) p.coins = coinsOf(p);
    this.checkEnd();
    return this.snapshot();
  }

  player(id: string) {
    return this.players.find((p) => p.id === id);
  }

  /** Player who hit `id` in the last few seconds (used by practice bots). */
  recentAttacker(id: string, secs = 4) {
    const s = this.pi.get(id);
    return s && s.lastHitBy && this.t - s.lastHitAt < secs ? this.player(s.lastHitBy) : undefined;
  }

  // ---------------------------------------------------------------- players

  private stepPlayer(p: PlayerState) {
    const s = this.pi.get(p.id)!;
    const inp = s.input;
    s.atkCd -= DT; s.parryCd -= DT; s.bonusT -= DT; s.stunT -= DT; s.invulnT -= DT; s.speedT -= DT;
    if (s.parryT > 0) {
      s.parryT -= DT;
      if (s.parryT <= 0 && !s.parryHit) s.parryCd = C.parryMissCooldown;
    }
    p.invuln = s.invulnT > 0;
    p.speedBuff = s.speedT > 0;
    p.parryBonus = s.bonusT > 0;

    const setAction = (a: PlayerState["action"]) => {
      if (p.action !== a) { p.action = a; p.actionAt = this.t; }
    };

    if (s.stunT > 0) {
      s.defending = false;
      s.castT = 0;
      setAction("stun");
      this.consumeEdges(s);
      return;
    }

    // Face the aim point.
    const adx = inp.ax - p.x, adz = inp.az - p.z;
    if (adx * adx + adz * adz > 0.01) p.face = Math.atan2(adz, adx);

    // Defend (hold) drains stamina; empty stamina = guard break.
    s.defending = inp.defend && p.stamina > 0 && s.castT <= 0;
    if (s.defending) {
      p.stamina -= C.defendDrain * DT;
      if (p.stamina <= 0) {
        p.stamina = 0;
        s.defending = false;
        s.stunT = C.guardBreakStun;
        this.events.push({ type: "guardBreak", id: p.id });
      }
    } else {
      p.stamina = Math.min(GAME.player.stamina, p.stamina + GAME.player.staminaRegen * DT);
    }

    if (inp.parry && s.parryCd <= 0 && s.parryT <= 0 && !s.defending && s.castT <= 0) {
      s.parryT = C.parryWindow;
      s.parryHit = false;
      setAction("parry");
    }

    // Staff cast resolves after the cast time.
    if (s.castT > 0) {
      s.castT -= DT;
      if (s.castT <= 0) this.resolveStaff(p, s);
    } else if (inp.attack && s.atkCd <= 0 && !s.defending && s.parryT <= 0) {
      this.attack(p, s, inp);
    }

    if (inp.use >= 0) this.useSlot(p, s, inp.use);

    // Movement.
    let mx = inp.mx, mz = inp.mz;
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      mx /= len; mz /= len;
      let speed = GAME.player.speed;
      if (s.defending) speed *= 1 - C.defendSlow;
      if (s.speedT > 0) speed *= 1 + GAME.skills.speed.mult;
      if (s.castT > 0) speed *= 0.3;
      this.moveCircle(p, mx * speed * DT, mz * speed * DT, GAME.player.radius);
    }

    // Interact: hold F at an unlocked chest; press F at loot.
    if (inp.interact) this.tryOpenChest(p);
    else { p.openingChest = null; p.openProgress = 0; }
    if (inp.pickup) this.tryPickup(p);

    if (s.castT > 0) setAction("cast");
    else if (s.parryT > 0) setAction("parry");
    else if (s.defending) setAction("defend");
    else if (this.t - p.actionAt < 0.25 && p.action === "attack") { /* keep attack anim */ }
    else setAction(len > 0.01 ? "walk" : "idle");
    this.consumeEdges(s);
  }

  private consumeEdges(s: PInt) {
    s.input = { ...s.input, parry: false, pickup: false, use: -1 };
  }

  private moveCircle(o: { x: number; z: number }, dx: number, dz: number, r: number) {
    const ok = (x: number, z: number) =>
      isWalkable(this.map, x + r, z) && isWalkable(this.map, x - r, z) &&
      isWalkable(this.map, x, z + r) && isWalkable(this.map, x, z - r);
    if (ok(o.x + dx, o.z)) o.x += dx;
    if (ok(o.x, o.z + dz)) o.z += dz;
    for (const ob of this.map.obstacles) {
      if (ob.kind !== "tree" && !(ob.kind === "barrel" && !this.brokenBarrels.has(ob.id))) continue;
      const ddx = o.x - ob.x, ddz = o.z - ob.z;
      const d = Math.hypot(ddx, ddz), min = r + ob.r;
      if (d < min && d > 0.0001) {
        const nx = o.x + (ddx / d) * (min - d), nz = o.z + (ddz / d) * (min - d);
        if (ok(nx, nz)) { o.x = nx; o.z = nz; }
      }
    }
  }

  private attack(p: PlayerState, s: PInt, inp: InputMsg) {
    const w = p.weapon;
    const mult = w ? rarityMult(w.rarity) : 1;
    const bonus = s.bonusT > 0 ? C.parryBonus : 1;
    p.action = "attack";
    p.actionAt = this.t;
    s.atkCd = C.attackCooldown;
    if (!w || w.kind === "sword") {
      const def = w ? GAME.weapons.sword : GAME.weapons.fist;
      if (bonus > 1) s.bonusT = 0;
      this.events.push({ type: "swing", id: p.id, face: p.face, weapon: w ? "sword" : "fist" });
      for (const tg of this.targetsNear(p.x, p.z, def.range + 1.3, p.id)) {
        const { x, z, r } = targetPos(tg);
        const d = Math.hypot(x - p.x, z - p.z);
        if (d > def.range + r) continue;
        const ang = Math.abs(angleDiff(Math.atan2(z - p.z, x - p.x), p.face));
        if (ang > ((def.arc / 2) * Math.PI) / 180 && d > r) continue;
        this.damage(tg, def.damage * mult * bonus, p.id, p.x, p.z, "melee");
      }
    } else if (w.kind === "staff") {
      const def = GAME.weapons.staff;
      let dx = inp.ax - p.x, dz = inp.az - p.z;
      const d = Math.hypot(dx, dz);
      if (d > def.range) { dx = (dx / d) * def.range; dz = (dz / d) * def.range; }
      s.castT = def.cast;
      s.castX = p.x + dx;
      s.castZ = p.z + dz;
      this.events.push({ type: "cast", id: p.id, x: s.castX, z: s.castZ });
    } else if (w.kind === "bow") {
      const def = GAME.weapons.bow;
      if (bonus > 1) s.bonusT = 0;
      this.events.push({ type: "swing", id: p.id, face: p.face, weapon: "bow" });
      this.projectiles.push({
        id: `pr${this.uid++}`, owner: p.id,
        x: p.x + Math.cos(p.face) * 0.5, z: p.z + Math.sin(p.face) * 0.5,
        vx: Math.cos(p.face) * def.projectileSpeed, vz: Math.sin(p.face) * def.projectileSpeed,
        damage: def.damage * mult * bonus, left: def.range,
      });
    }
  }

  private resolveStaff(p: PlayerState, s: PInt) {
    const def = GAME.weapons.staff;
    const mult = p.weapon ? rarityMult(p.weapon.rarity) : 1;
    const bonus = s.bonusT > 0 ? C.parryBonus : 1;
    if (bonus > 1) s.bonusT = 0;
    s.atkCd = C.attackCooldown;
    this.events.push({ type: "blast", x: s.castX, z: s.castZ, r: def.aoe, color: "#b06bff" });
    for (const tg of this.targetsNear(s.castX, s.castZ, def.aoe + 1.3, p.id)) {
      const { x, z, r } = targetPos(tg);
      if (Math.hypot(x - s.castX, z - s.castZ) <= def.aoe + r) this.damage(tg, def.damage * mult * bonus, p.id, s.castX, s.castZ, "aoe");
    }
  }

  private useSlot(p: PlayerState, s: PInt, slot: number) {
    const it = p.bag[slot];
    if (!it) return;
    const mult = rarityMult(it.rarity);
    switch (it.kind) {
      case "sword": case "staff": case "bow":
        p.bag[slot] = p.weapon;
        p.weapon = it;
        s.castT = 0;
        break;
      case "armor":
        p.bag[slot] = p.armor;
        p.armor = it;
        this.recalcMaxHp(p, s);
        break;
      case "heal":
        p.hp = Math.min(p.maxHp, p.hp + GAME.skills.heal * mult);
        p.bag[slot] = null;
        break;
      case "speed":
        s.speedT = GAME.skills.speed.seconds * mult;
        p.bag[slot] = null;
        break;
      case "maxhp":
        s.maxBonus += GAME.skills.maxhp * mult;
        this.recalcMaxHp(p, s);
        p.hp += GAME.skills.maxhp * mult;
        p.bag[slot] = null;
        break;
      case "invuln":
        s.invulnT = GAME.skills.invuln * mult;
        p.bag[slot] = null;
        break;
    }
    this.events.push({ type: "useItem", id: p.id, kind: it.kind });
  }

  private recalcMaxHp(p: PlayerState, s: PInt) {
    const armorHp = p.armor ? GAME.armor.hp * rarityMult(p.armor.rarity) : 0;
    p.maxHp = Math.round(GAME.player.hp + armorHp + s.maxBonus);
    p.hp = Math.min(p.hp, p.maxHp);
  }

  private tryOpenChest(p: PlayerState) {
    const ch = this.chests.find((c) => !c.opened && Math.hypot(c.x - p.x, c.z - p.z) < GAME.player.interactRange);
    if (!ch || ch.locked) { p.openingChest = null; p.openProgress = 0; return; }
    if (p.openingChest !== ch.id) { p.openingChest = ch.id; p.openProgress = 0; }
    p.openProgress += DT / GAME.player.openSeconds;
    if (p.openProgress >= 1) {
      p.openingChest = null;
      p.openProgress = 0;
      this.openChest(ch.id, p.id);
    }
  }

  private openChest(id: number, by: string) {
    const ch = this.chests.find((c) => c.id === id)!;
    const camp = this.map.camps[id];
    ch.opened = true;
    const r = mulberry32(hash2(this.map.seed, id + 1));
    const odds = GAME.chests[ch.tier].rarity;
    const items: Item[] = camp.kinds.map((kind) => {
      const roll = r();
      const rarity: Rarity = roll < odds[0] ? 0 : roll < odds[0] + odds[1] ? 1 : 2;
      return { id: `i${this.uid++}`, kind, rarity };
    });
    this.loot.push({ id: `l${this.uid++}`, x: ch.x, z: ch.z + 0.9, items, bag: false });
    this.events.push({ type: "chestOpened", id, by });
  }

  private tryPickup(p: PlayerState) {
    const pile = this.loot
      .filter((l) => Math.hypot(l.x - p.x, l.z - p.z) < GAME.player.interactRange)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!pile) return;
    const taken: Item[] = [];
    const remaining: Item[] = [];
    // Best items first.
    const sorted = [...pile.items].sort((a, b) => b.rarity - a.rarity);
    for (const it of sorted) {
      const isWeapon = it.kind === "sword" || it.kind === "staff" || it.kind === "bow";
      if (isWeapon && !p.weapon) { p.weapon = it; taken.push(it); continue; }
      if (it.kind === "armor" && !p.armor) {
        p.armor = it; taken.push(it); this.recalcMaxHp(p, this.pi.get(p.id)!); continue;
      }
      const empty = p.bag.indexOf(null);
      if (empty >= 0) { p.bag[empty] = it; taken.push(it); continue; }
      // Bag full: swap with the least valuable bag item if the new one is worth more.
      let low = 0;
      p.bag.forEach((b, i) => { if (b && p.bag[low] && b.rarity < p.bag[low]!.rarity) low = i; });
      const old = p.bag[low]!;
      if (itemValue(it.rarity) > itemValue(old.rarity)) {
        p.bag[low] = it; taken.push(it); remaining.push(old);
      } else remaining.push(it);
    }
    pile.items = remaining;
    if (!remaining.length) this.loot = this.loot.filter((l) => l !== pile);
    if (taken.length) this.events.push({ type: "pickup", id: p.id, items: taken });
  }

  // ---------------------------------------------------------------- damage

  private targetsNear(x: number, z: number, r: number, exclude: string): Target[] {
    const out: Target[] = [];
    for (const p of this.players) if (p.alive && p.id !== exclude && Math.hypot(p.x - x, p.z - z) <= r) out.push({ t: "player", p });
    for (const e of this.enemies) if (e.hp > 0 && Math.hypot(e.x - x, e.z - z) <= r + GAME.enemies[e.kind].radius) out.push({ t: "enemy", e });
    for (const o of this.map.obstacles)
      if (o.kind === "barrel" && !this.brokenBarrels.has(o.id) && Math.hypot(o.x - x, o.z - z) <= r) out.push({ t: "barrel", id: o.id, x: o.x, z: o.z });
    return out;
  }

  private damage(tg: Target, amount: number, attacker: string | undefined, sx: number, sz: number, kind: "melee" | "proj" | "aoe" | "env") {
    if (tg.t === "barrel") { this.explodeBarrel(tg.id, attacker); return; }
    if (tg.t === "enemy") {
      const e = tg.e;
      e.hp -= amount;
      this.events.push({ type: "hit", x: e.x, z: e.z, amount: Math.round(amount), target: e.id, source: attacker });
      const ei = this.ei.get(e.id)!;
      if (attacker && this.player(attacker)) ei.target = attacker;
      if (e.hp <= 0) this.killEnemy(e);
      return;
    }
    const p = tg.p;
    const s = this.pi.get(p.id)!;
    if (!p.alive) return;
    if (kind !== "env") {
      if (s.invulnT > 0) { this.events.push({ type: "immune", x: p.x, z: p.z, target: p.id }); return; }
      if (s.parryT > 0) {
        s.parryT = 0;
        s.parryHit = true;
        s.parryCd = C.parryHitCooldown;
        s.bonusT = C.parryBonusSeconds;
        this.events.push({ type: "parry", x: p.x, z: p.z, target: p.id, attacker });
        if (kind === "melee" && attacker) this.stun(attacker, C.parryStun);
        return;
      }
      if (s.defending) {
        const toSrc = Math.atan2(sz - p.z, sx - p.x);
        if (Math.abs(angleDiff(toSrc, p.face)) < Math.PI / 2) {
          amount *= 1 - C.defendReduction;
          this.events.push({ type: "blocked", x: p.x, z: p.z, target: p.id });
        }
      }
      if (p.armor) amount *= 1 - GAME.armor.reduction * rarityMult(p.armor.rarity);
    }
    p.hp -= amount;
    p.openingChest = null;
    p.openProgress = 0;
    if (attacker) { s.lastHitBy = attacker; s.lastHitAt = this.t; }
    this.events.push({ type: "hit", x: p.x, z: p.z, amount: Math.round(amount), target: p.id, source: attacker });
    if (p.hp <= 0) {
      const killer = attacker && this.player(attacker) ? attacker : undefined;
      const reason = killer ? "player" : attacker?.startsWith("e") ? "enemy" : kind === "env" ? "trap" : "enemy";
      this.eliminate([p], reason, killer);
    }
  }

  private stun(id: string, secs: number) {
    const ps = this.pi.get(id);
    if (ps) { ps.stunT = secs; ps.castT = 0; return; }
    const es = this.ei.get(id);
    const e = this.enemies.find((x) => x.id === id);
    if (es && e) { es.stunT = secs; e.ai = "stun"; e.windup = 0; }
  }

  private killEnemy(e: EnemyState) {
    e.hp = 0;
    this.events.push({ type: "enemyDown", id: e.id, x: e.x, z: e.z, kind: e.kind });
    const ch = this.chests.find((c) => c.id === e.campId)!;
    ch.guardsLeft = this.enemies.filter((x) => x.campId === e.campId && x.hp > 0).length;
    ch.locked = ch.guardsLeft > 0;
  }

  private explodeBarrel(id: number, attacker?: string) {
    if (this.brokenBarrels.has(id)) return;
    this.brokenBarrels.add(id);
    const o = this.map.obstacles[id];
    const def = GAME.obstacles.barrel;
    this.events.push({ type: "explode", x: o.x, z: o.z, r: def.radius, id });
    for (const tg of this.targetsNear(o.x, o.z, def.radius, "")) {
      if (tg.t === "barrel" && tg.id === id) continue;
      this.damage(tg, def.damage, attacker, o.x, o.z, "aoe");
    }
  }

  private eliminate(list: PlayerState[], reason: "player" | "enemy" | "zone" | "quota" | "trap", killer?: string) {
    const group = [...list].sort((a, b) => a.coins - b.coins);
    for (const p of group) {
      p.alive = false;
      p.hp = 0;
      p.action = "dead";
      p.actionAt = this.t;
      const items = [p.weapon, p.armor, ...p.bag].filter((x): x is Item => !!x);
      if (items.length) this.loot.push({ id: `l${this.uid++}`, x: p.x, z: p.z, items, bag: true });
      p.weapon = null; p.armor = null; p.bag = [null, null, null, null, null, null];
      p.coins = 0;
      if (killer) { const k = this.player(killer); if (k) k.kills++; }
      this.events.push({ type: "kill", killer, victim: p.id, reason });
    }
    this.eliminated.push(group.map((p) => p.id));
    const remaining = this.players.filter((p) => p.alive).length;
    // Rank = reverse elimination order. Players dying in the same tick: more coins = better.
    group.forEach((p, i) => { p.rank = remaining + group.length - i; });
  }

  // ---------------------------------------------------------------- world

  private stepProjectiles() {
    for (const pr of this.projectiles) {
      const step = Math.hypot(pr.vx, pr.vz) * DT;
      pr.x += pr.vx * DT;
      pr.z += pr.vz * DT;
      pr.left -= step;
      if (!isWalkable(this.map, pr.x, pr.z)) pr.left = 0;
      if (pr.left <= 0) continue;
      const hit = this.targetsNear(pr.x, pr.z, 0.6, pr.owner)[0];
      if (hit) {
        this.damage(hit, pr.damage, pr.owner, pr.x - pr.vx * 0.05, pr.z - pr.vz * 0.05, "proj");
        pr.left = 0;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.left > 0);
  }

  private stepEnemy(e: EnemyState) {
    const s = this.ei.get(e.id)!;
    const def = GAME.enemies[e.kind];
    s.cd -= DT;
    if (s.stunT > 0) { s.stunT -= DT; e.ai = "stun"; return; }
    const homeD = Math.hypot(e.x - s.homeX, e.z - s.homeZ);

    let target = s.target ? this.player(s.target) : undefined;
    if (!target?.alive) target = undefined;
    if (!target) {
      let best: number = GAME.enemies.aggroRadius;
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < best) { best = d; target = p; }
      }
    }
    if (e.ai === "return" || homeD > GAME.enemies.leashRadius || (target && Math.hypot(target.x - s.homeX, target.z - s.homeZ) > GAME.enemies.leashRadius + 2)) {
      s.target = undefined;
      e.ai = "return";
      e.windup = 0;
      this.moveToward(e, s.homeX, s.homeZ, def.speed * 1.3, def.radius);
      if (homeD < 0.6) { e.ai = "idle"; e.hp = e.maxHp; }
      return;
    }

    if (e.ai === "windup") {
      e.windup -= DT;
      if (target) e.face = Math.atan2(target.z - e.z, target.x - e.x);
      if (e.windup <= 0) {
        e.windup = 0;
        e.ai = "recover";
        s.cd = def.cooldown;
        if (e.kind === "boss") {
          const r = GAME.enemies.boss.slamRadius;
          this.events.push({ type: "slam", x: e.x, z: e.z, r });
          for (const p of this.players)
            if (p.alive && Math.hypot(p.x - e.x, p.z - e.z) <= r + GAME.player.radius)
              this.damage({ t: "player", p }, def.damage, e.id, e.x, e.z, "melee");
        } else if (target) {
          const d = Math.hypot(target.x - e.x, target.z - e.z);
          this.events.push({ type: "swing", id: e.id, face: e.face, weapon: "fist" });
          if (d <= def.range + 0.6) this.damage({ t: "player", p: target }, def.damage, e.id, e.x, e.z, "melee");
        }
      }
      return;
    }

    if (target) {
      s.target = target.id;
      const d = Math.hypot(target.x - e.x, target.z - e.z);
      e.face = Math.atan2(target.z - e.z, target.x - e.x);
      if (d > def.range) {
        e.ai = "chase";
        this.moveToward(e, target.x, target.z, def.speed, def.radius);
      } else if (s.cd <= 0) {
        e.ai = "windup";
        e.windup = def.windup;
      } else e.ai = "recover";
    } else {
      e.ai = "idle";
      s.wander -= DT;
      if (s.wander <= 0) {
        s.wander = 2 + this.rand() * 3;
        s.wx = s.homeX + (this.rand() - 0.5) * 2;
        s.wz = s.homeZ + (this.rand() - 0.5) * 2;
      }
      if (Math.hypot(s.wx - e.x, s.wz - e.z) > 0.2) this.moveToward(e, s.wx, s.wz, def.speed * 0.3, def.radius);
    }
  }

  private moveToward(o: EnemyState, tx: number, tz: number, speed: number, r: number) {
    const dx = tx - o.x, dz = tz - o.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    o.face = Math.atan2(dz, dx);
    const step = Math.min(d, speed * DT);
    this.moveCircle(o, (dx / d) * step, (dz / d) * step, Math.min(r, 0.45));
  }

  private separate() {
    const ens = this.enemies.filter((e) => e.hp > 0);
    for (let i = 0; i < ens.length; i++) {
      for (let j = i + 1; j < ens.length; j++) {
        const a = ens[i], b = ens[j];
        const ra = GAME.enemies[a.kind].radius, rb = GAME.enemies[b.kind].radius;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d > 0 && d < ra + rb) {
          const push = (ra + rb - d) / 2;
          this.moveCircle(a, (-dx / d) * push, (-dz / d) * push, 0.3);
          this.moveCircle(b, (dx / d) * push, (dz / d) * push, 0.3);
        }
      }
    }
  }

  private stepHazards() {
    const sp = GAME.obstacles.spike;
    const cycle = Math.floor(this.t / sp.period);
    const active = this.t % sp.period < sp.activeFor;
    for (const p of this.players) {
      if (!p.alive) continue;
      const s = this.pi.get(p.id)!;
      for (const o of this.map.obstacles) {
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (o.kind === "spike" && active && d < o.r + 0.2 && s.spikeCycle[o.id] !== cycle) {
          s.spikeCycle[o.id] = cycle;
          if (s.invulnT <= 0) this.damage({ t: "player", p }, sp.damage, undefined, o.x, o.z, "env");
        } else if (o.kind === "pool" && d < o.r && s.invulnT <= 0) {
          this.damage({ t: "player", p }, GAME.obstacles.pool.dps * DT, undefined, o.x, o.z, "env");
        }
        if (!p.alive) break;
      }
    }
  }

  private zoneInfo() {
    const z = zoneAt(this.map, this.t);
    return { ...z, quota: z.baseQuota ? scaledQuota(z.baseQuota, this.players.length) : 0 };
  }

  private stepZone() {
    const z = this.zoneInfo();
    if (z.phase !== this.lastPhase) {
      // The phase that just ended may have a coin quota.
      const ended = GAME.zone[this.lastPhase];
      if (ended.quota > 0) {
        const quota = scaledQuota(ended.quota, this.players.length);
        const out = this.players.filter((p) => p.alive && coinsOf(p) < quota);
        // Never wipe everyone: if all would fail, the richest survive.
        const alive = this.players.filter((p) => p.alive);
        let cut = out;
        if (out.length === alive.length && alive.length > 0) {
          const best = Math.max(...alive.map(coinsOf));
          cut = out.filter((p) => coinsOf(p) < best);
        }
        if (cut.length) { cut.forEach((p) => (p.coins = coinsOf(p))); this.eliminate(cut, "quota"); }
        this.events.push({ type: "quota", quota, eliminated: cut.map((p) => p.id) });
      }
      this.lastPhase = z.phase;
      this.events.push({ type: "phase", phase: z.phase });
    }
    if (z.dps > 0) {
      for (const p of this.players) {
        if (p.alive && Math.hypot(p.x - z.cx, p.z - z.cz) > z.r) {
          p.hp -= z.dps * DT;
          if (p.hp <= 0) this.eliminate([p], "zone");
        }
      }
    }
  }

  private checkEnd() {
    const alive = this.players.filter((p) => p.alive);
    if ((alive.length <= 1 && this.players.length > 1) || this.t >= GAME.matchSeconds || alive.length === 0) {
      alive.sort((a, b) => b.coins - a.coins || b.hp - a.hp).forEach((p, i) => (p.rank = i + 1));
      this.status = "ended";
    }
  }

  standings(): Standing[] {
    return this.players
      .map((p) => ({ id: p.id, name: p.name, address: p.address, rank: p.rank ?? this.players.length, coins: p.coins, kills: p.kills, bot: p.bot }))
      .sort((a, b) => a.rank - b.rank);
  }

  snapshot(): Snapshot {
    const z = this.zoneInfo();
    const events = this.events;
    this.events = [];
    return {
      t: this.t,
      tick: this.tick,
      status: this.status,
      duration: GAME.matchSeconds,
      players: this.players,
      enemies: this.enemies.filter((e) => e.hp > 0),
      chests: this.chests,
      loot: this.loot,
      projectiles: this.projectiles,
      brokenBarrels: [...this.brokenBarrels],
      zone: { phase: z.phase, cx: z.cx, cz: z.cz, r: z.r, next: z.next, phaseEndsAt: z.phaseEndsAt, shrinking: z.shrinking, dps: z.dps, quota: z.quota },
      alive: this.players.filter((p) => p.alive).length,
      events,
    };
  }
}

// ------------------------------------------------------------------ helpers

export function coinsOf(p: PlayerState): number {
  let c = 0;
  for (const it of [p.weapon, p.armor, ...p.bag]) if (it) c += itemValue(it.rarity);
  return c;
}

function targetPos(tg: Target) {
  if (tg.t === "player") return { x: tg.p.x, z: tg.p.z, r: GAME.player.radius };
  if (tg.t === "enemy") return { x: tg.e.x, z: tg.e.z, r: GAME.enemies[tg.e.kind].radius };
  return { x: tg.x, z: tg.z, r: 0.4 };
}

export function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ------------------------------------------------------------------ practice bots
// Only used in offline practice. Real matches have no bots (PRD 4.1).

class BotBrain {
  private id: string;
  private rand: Rand;
  private goal: { x: number; z: number } | null = null;
  private targetId: string | null = null;
  private mode: "fight" | "loot" | "open" | "roam" = "roam";
  private rethink = 0;
  private flee = 0;
  private stuck = 0;
  private lastX = 0;
  private lastZ = 0;
  private jink = 0;
  private jx = 0;
  private jz = 0;
  private seq = 0;
  private aggression: number;

  constructor(id: string, rand: Rand) {
    this.id = id;
    this.rand = rand;
    this.aggression = 0.4 + rand() * 0.6;
  }

  think(sim: MatchSim, me: PlayerState): InputMsg {
    const inp = emptyInput();
    inp.seq = ++this.seq;
    const zone = zoneAt(sim.map, sim.t);
    this.rethink -= DT;

    // Use items smartly.
    const slot = (k: ItemKind) => me.bag.findIndex((b) => b?.kind === k);
    if (me.hp < me.maxHp * 0.45 && slot("heal") >= 0) inp.use = slot("heal");
    else if (me.hp < 25 && slot("invuln") >= 0) inp.use = slot("invuln");
    else if (slot("maxhp") >= 0 && sim.t > GAME.zone[3].start) inp.use = slot("maxhp");
    else {
      const better = me.bag.findIndex((b) => b && (b.kind === "sword" || b.kind === "staff" || b.kind === "bow") && (!me.weapon || b.rarity > me.weapon.rarity));
      const armor = me.bag.findIndex((b) => b?.kind === "armor" && (!me.armor || b.rarity > me.armor.rarity));
      if (better >= 0) inp.use = better;
      else if (armor >= 0) inp.use = armor;
    }

    this.flee -= DT;
    if (this.rethink <= 0 && this.flee <= 0) {
      this.rethink = 0.4 + this.rand() * 0.3;
      this.pick(sim, me, zone);
    }
    // Low HP and no potion: back off toward the zone center for a few seconds.
    if (this.flee <= 0 && this.mode === "fight" && me.hp < me.maxHp * 0.3 && slot("heal") < 0) {
      this.flee = 3 + this.rand() * 2;
      this.mode = "roam";
      this.targetId = null;
      const a = Math.atan2(zone.next.cz - me.z, zone.next.cx - me.x) + (this.rand() - 0.5);
      this.goal = { x: me.x + Math.cos(a) * 9, z: me.z + Math.sin(a) * 9 };
    }

    let tx = this.goal?.x ?? zone.cx, tz = this.goal?.z ?? zone.cz;
    // Zone pressure overrides everything.
    const outside = Math.hypot(me.x - zone.next.cx, me.z - zone.next.cz) > zone.next.r * 0.85;
    const soon = zone.phaseEndsAt - sim.t < 25 || zone.shrinking;
    if (outside && soon) { tx = zone.next.cx; tz = zone.next.cz; this.mode = "roam"; }

    let wantDist = 0.8;
    let attackRange = 1.4;
    const w = me.weapon?.kind;
    if (w === "bow") attackRange = 6.5;
    if (w === "staff") attackRange = 5;

    const tgt = this.targetId
      ? sim.players.find((p) => p.id === this.targetId && p.alive) ?? sim.enemies.find((e) => e.id === this.targetId && e.hp > 0)
      : undefined;
    if (this.mode === "fight" && !tgt) this.rethink = 0;
    if (this.mode === "fight" && tgt) {
      tx = tgt.x; tz = tgt.z;
      wantDist = attackRange * 0.8;
      inp.ax = tgt.x; inp.az = tgt.z;
      const d = Math.hypot(tgt.x - me.x, tgt.z - me.z);
      if (d <= attackRange) inp.attack = this.rand() < 0.85;
      const threat = "ai" in tgt ? tgt.ai === "windup" : tgt.action === "attack" && d < 2;
      if (threat && me.stamina > 30 && this.rand() < 0.5) { inp.defend = true; inp.attack = false; }
      else if (threat && this.rand() < 0.12) inp.parry = true;
    } else {
      inp.ax = tx; inp.az = tz;
    }
    if (this.mode === "open") { inp.interact = true; wantDist = 1.0; }
    if (this.mode === "loot") { inp.pickup = Math.hypot(tx - me.x, tz - me.z) < 1.5; wantDist = 0.5; }

    let dx = tx - me.x, dz = tz - me.z;
    const d = Math.hypot(dx, dz);
    if (d > wantDist) { dx /= d; dz /= d; } else { dx = 0; dz = 0; }

    // Stay out of the boss's reach unless deliberately fighting it.
    const boss = this.bossThreat(sim, me);
    if (boss && !(this.mode === "fight" && this.targetId === boss.id)) {
      const bd = Math.hypot(me.x - boss.x, me.z - boss.z);
      if (bd < 7.5) {
        const ax = (me.x - boss.x) / bd, az = (me.z - boss.z) / bd;
        const w = (7.5 - bd) / 2;
        dx = dx + ax * w; dz = dz + az * w;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        if (this.mode === "open") inp.interact = false;
      }
    }

    // Unstick.
    if (Math.hypot(me.x - this.lastX, me.z - this.lastZ) < 0.02 && (dx || dz)) this.stuck += DT; else this.stuck = 0;
    this.lastX = me.x; this.lastZ = me.z;
    if (this.stuck > 0.6) { this.jink = 0.8; const a = this.rand() * Math.PI * 2; this.jx = Math.cos(a); this.jz = Math.sin(a); this.stuck = 0; }
    if (this.jink > 0) { this.jink -= DT; dx = this.jx; dz = this.jz; }
    inp.mx = dx; inp.mz = dz;
    return inp;
  }

  private pick(sim: MatchSim, me: PlayerState, zone: ReturnType<typeof zoneAt>) {
    const dist = (o: { x: number; z: number }) => Math.hypot(o.x - me.x, o.z - me.z);
    const inZone = (o: { x: number; z: number }) => Math.hypot(o.x - zone.cx, o.z - zone.cz) < zone.r - 1;
    const boss = this.bossThreat(sim, me);
    const safe = (o: { x: number; z: number }) => !boss || Math.hypot(o.x - boss.x, o.z - boss.z) > 8;
    // Loot phase: only scrap with raiders who get in your face. Later: hunt wider.
    const foeRange = zone.phase === 0 ? 2 + this.aggression : 3 + this.aggression * (zone.phase + 1) * 1.5;
    const revenge = sim.recentAttacker(this.id);
    if (revenge?.alive && dist(revenge) < 7 && (zone.phase > 0 || me.hp > 50)) { this.mode = "fight"; this.targetId = revenge.id; return; }
    const foe = zone.phase === 0 ? undefined
      : sim.players.filter((p) => p.alive && p.id !== this.id && !p.invuln && dist(p) < foeRange).sort((a, b) => dist(a) - dist(b))[0];
    if (foe && (me.hp > 45 || dist(foe) < 1.8)) { this.mode = "fight"; this.targetId = foe.id; return; }
    const pile = sim.loot.filter((l) => inZone(l) && safe(l) && dist(l) < 18).sort((a, b) => dist(a) - dist(b))[0];
    if (pile && dist(pile) < 10) { this.mode = "loot"; this.goal = pile; this.targetId = null; return; }
    const chest = sim.chests
      .filter((c) => !c.opened && inZone(c) && (c.tier === "wood" || (c.tier === "iron" && me.weapon) || (c.tier === "boss" && me.weapon && me.armor && me.hp > 80)))
      .sort((a, b) => dist(a) - dist(b))[0];
    const healthy = me.hp > me.maxHp * 0.55 || me.bag.some((b) => b?.kind === "heal");
    if (chest && (healthy || !chest.locked)) {
      if (!chest.locked) { this.mode = "open"; this.goal = chest; this.targetId = null; return; }
      const guard = sim.enemies.filter((e) => e.campId === chest.id && e.hp > 0).sort((a, b) => dist(a) - dist(b))[0];
      if (guard) { this.mode = "fight"; this.targetId = guard.id; return; }
    }
    if (pile) { this.mode = "loot"; this.goal = pile; this.targetId = null; return; }
    const prey = sim.players.filter((p) => p.alive && p.id !== this.id).sort((a, b) => dist(a) - dist(b))[0];
    if (prey && me.hp > 50 && zone.phase >= 2) { this.mode = "fight"; this.targetId = prey.id; return; }
    this.mode = "roam";
    this.targetId = null;
    const g = { x: zone.next.cx + (this.rand() - 0.5) * zone.next.r, z: zone.next.cz + (this.rand() - 0.5) * zone.next.r };
    if (boss && !safe(g)) {
      const a = Math.atan2(g.z - boss.z, g.x - boss.x);
      g.x = boss.x + Math.cos(a) * 9; g.z = boss.z + Math.sin(a) * 9;
    }
    this.goal = g;
  }

  /** The mini boss, if alive and this bot is not geared to fight it. */
  private bossThreat(sim: MatchSim, me: PlayerState) {
    const boss = sim.enemies.find((e) => e.kind === "boss" && e.hp > 0);
    const ready = me.weapon && me.armor && me.hp > 80;
    return boss && !ready ? boss : undefined;
  }
}
