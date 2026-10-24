import { useState } from "react";
import { GAME, ITEM_DESC, ITEM_NAMES, itemValue } from "../shared/config";
import type { Item, MapData, PlayerState, Snapshot } from "../shared/types";
import { buffIcon, itemIcon } from "../game/sprites";
import Minimap from "./Minimap";

export interface FeedEntry {
  id: number;
  text: string;
  at: number;
  self?: boolean;
  kind: string;
  banner?: number;
}

interface Props {
  snap: Snapshot;
  feed: FeedEntry[];
  map: MapData;
  selfId: string;
  practice: boolean;
  now: number;
  onUse: (slot: number) => void;
  onLeave: () => void;
}

const fmt = (s: number) => {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};

export default function Hud({ snap, feed, map, selfId, practice, now, onUse, onLeave }: Props) {
  const [help, setHelp] = useState(true);
  const me = snap.players.find((p) => p.id === selfId);
  if (!me) return null;
  const z = snap.zone;
  const left = z.phaseEndsAt - snap.t;
  const outside = me.alive && Math.hypot(me.x - z.cx, me.z - z.cz) > z.r && z.dps > 0;
  const quotaDanger = z.quota > 0 && me.alive && me.coins < z.quota;
  const quotaWarn = quotaDanger && left <= GAME.quotaWarningSeconds;
  const phaseName = z.phase === 0 ? "Loot phase" : z.phase === GAME.zone.length - 1 ? "Final circle" : `Zone ${z.phase}`;
  const banner = [...feed].reverse().find((f) => f.banner !== undefined && now - f.at < 3000);
  const nextQuotaPhase = GAME.zone.findIndex((p, i) => i >= z.phase && p.quota > 0);

  return (
    <div className="hud" onContextMenu={(e) => e.preventDefault()}>
      {outside && <div className="zone-vignette" />}
      {quotaWarn && <div className="quota-vignette" />}

      {/* Top center: phase + timer */}
      <div className="hud-top">
        <div className={`phase-pill ${z.shrinking ? "shrinking" : ""}`}>
          <span className="phase-name">{phaseName}</span>
          <span className="phase-time">{fmt(left)}</span>
          <span className="phase-sub">{z.phase === 0 ? "zone starts shrinking" : z.phase === GAME.zone.length - 1 ? "sudden death" : "zone shrinking"}</span>
        </div>
        <div className="top-stats">
          <span><b>{snap.alive}</b> alive</span>
          <span className="dot" />
          <span>match {fmt(snap.duration - snap.t)}</span>
          {practice && <><span className="dot" /><span className="tag-practice">practice</span></>}
        </div>
      </div>

      {/* Coins vs quota */}
      <div className={`quota ${quotaDanger ? "danger" : "ok"} ${quotaWarn ? "warn" : ""}`}>
        <div className="coins"><CoinIcon /> {me.coins}</div>
        {z.quota > 0 ? (
          <div className="quota-line">
            quota <b>{z.quota}</b> in {fmt(left)} {quotaDanger ? <span className="need">need {z.quota - me.coins} more</span> : <span className="safe">safe</span>}
          </div>
        ) : nextQuotaPhase > 0 ? (
          <div className="quota-line muted">first quota at end of Zone {nextQuotaPhase}</div>
        ) : (
          <div className="quota-line muted">no quota — survive</div>
        )}
      </div>
      {/* Leave Game Logic */}
      <div className="leave-game">
        <button className="btn btn-secondary" onClick={onLeave}>Leave Game</button>
        {/* Unmounting #/play leaves the match (see PlayArea cleanup in App.tsx). Set the hash
            directly: navigate("home") is a no-op when the match was opened via /?practice (no hash). */}
        <button className="btn ghost" onClick={() => { if (confirm("Keluar dari match dan kembali ke beranda?")) location.hash = "#/"; }}>← Beranda</button>
      </div>

      {/* Bottom left: vitals */}
      <div className="vitals">
        <div className="vital-name">{me.name}</div>
        <Bar value={me.hp} max={me.maxHp} cls="hp" label={`${Math.ceil(Math.max(0, me.hp))} / ${me.maxHp}`} />
        <Bar value={me.stamina} max={GAME.player.stamina} cls="st" label="stamina" />
        <div className="buffs">
          {me.invuln && <span className="buff gold"><img src={buffIcon("immune")} alt="" />Immune</span>}
          {me.speedBuff && <span className="buff cyan"><img src={buffIcon("swift")} alt="" />Swift</span>}
          {me.parryBonus && <span className="buff yellow"><img src={buffIcon("double_hit")} alt="" />Next hit ×2</span>}
          {me.action === "stun" && <span className="buff blue"><img src={buffIcon("stunned")} alt="" />Stunned</span>}
        </div>
      </div>

      {/* Bottom center: inventory */}
      <Inventory me={me} onUse={onUse} />

      <Prompt snap={snap} me={me} />

      {/* Right column */}
      <div className="hud-right">
        <Minimap map={map} snap={snap} selfId={selfId} />
        <div className="feed">
          {feed.filter((f) => f.kind !== "phase").map((f) => (
            <div key={f.id} className={`feed-item ${f.self ? "self" : ""} ${f.kind}`}>{f.text}</div>
          ))}
        </div>
      </div>

      {banner && (
        <div className="banner" key={banner.id}>
          <div className="banner-title">{banner.banner === GAME.zone.length - 1 ? "Final circle" : `Zone ${banner.banner}`}</div>
          <div className="banner-sub">
            {GAME.zone[banner.banner!].quota > 0
              ? `Hold ${z.quota} coins by the end of this phase or be eliminated`
              : "The zone closes to nothing. Last raider standing wins."}
          </div>
        </div>
      )}

      {!me.alive && snap.status === "playing" && (
        <div className="dead-card">
          <div className="dead-title">Eliminated</div>
          <div className="dead-rank">#{me.rank ?? "?"}</div>
          <div className="dead-sub">Spectating the leader…</div>
        </div>
      )}
      {snap.status === "ended" && (
        <div className="dead-card win">
          <div className="dead-title">{me.rank === 1 ? "Victory" : "Match over"}</div>
          <div className="dead-rank">#{me.rank ?? "?"}</div>
          <div className="dead-sub">Settling results…</div>
        </div>
      )}

      <div className={`help ${help ? "" : "collapsed"}`} onClick={() => setHelp(!help)}>
        {help ? (
          <>
            <div><kbd>WASD</kbd> move</div>
            <div><kbd>LMB</kbd> attack · <kbd>RMB</kbd> defend</div>
            <div><kbd>Space</kbd> parry</div>
            <div><kbd>F</kbd> hold: open chest / tap: loot</div>
            <div><kbd>1–6</kbd> use / equip bag slot</div>
            <div className="muted">click to hide</div>
          </>
        ) : <div>? controls</div>}
      </div>
    </div>
  );
}

function Bar({ value, max, cls, label }: { value: number; max: number; cls: string; label: string }) {
  return (
    <div className={`bar ${cls}`}>
      <div className="fill" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      <span>{label}</span>
    </div>
  );
}

function Slot({ item, label, keyHint, onClick }: { item: Item | null; label?: string; keyHint?: string; onClick?: () => void }) {
  const r = item ? GAME.rarity[item.rarity] : null;
  return (
    <div
      className={`slot ${item ? "filled" : ""} ${onClick && item ? "clickable" : ""}`}
      style={r ? { borderColor: r.color, boxShadow: `inset 0 0 14px ${r.color}55` } : undefined}
      onMouseDown={(e) => { e.stopPropagation(); if (item) onClick?.(); }}
    >
      {keyHint && <span className="key">{keyHint}</span>}
      {item ? (
        <>
          <img src={itemIcon(item.kind)} alt={item.kind} />
          <span className="val">{itemValue(item.rarity)}</span>
          <div className="tip">
            <b style={{ color: r!.color }}>{r!.name} {ITEM_NAMES[item.kind]}</b>
            <span>{ITEM_DESC[item.kind]}{item.rarity > 0 ? ` (×${r!.mult})` : ""}</span>
            <span className="muted">Worth {itemValue(item.rarity)} coins</span>
          </div>
        </>
      ) : (
        <span className="empty">{label}</span>
      )}
    </div>
  );
}

function Inventory({ me, onUse }: { me: PlayerState; onUse: (i: number) => void }) {
  return (
    <div className="inventory">
      <div className="inv-group active">
        <Slot item={me.weapon} label="weapon" />
        <Slot item={me.armor} label="armor" />
      </div>
      <div className="inv-sep" />
      <div className="inv-group">
        {me.bag.map((it, i) => <Slot key={i} item={it} keyHint={`${i + 1}`} label="" onClick={() => onUse(i)} />)}
      </div>
    </div>
  );
}

function Prompt({ snap, me }: { snap: Snapshot; me: PlayerState }) {
  if (!me.alive) return null;
  const range = GAME.player.interactRange;
  const chest = snap.chests.find((c) => !c.opened && Math.hypot(c.x - me.x, c.z - me.z) < range);
  const pile = snap.loot.find((l) => Math.hypot(l.x - me.x, l.z - me.z) < range);
  if (chest) {
    if (chest.locked) return <div className="prompt locked">Defeat {chest.guardsLeft} guard{chest.guardsLeft === 1 ? "" : "s"} to unlock</div>;
    return (
      <div className="prompt">
        Hold <kbd>F</kbd> to open {chest.tier} chest
        {me.openingChest === chest.id && <div className="progress"><div style={{ width: `${me.openProgress * 100}%` }} /></div>}
      </div>
    );
  }
  if (pile) {
    const value = pile.items.reduce((s, i) => s + itemValue(i.rarity), 0);
    return (
      <div className="prompt">
        Press <kbd>F</kbd> to loot {pile.bag ? "bag" : ""} · {pile.items.length} item{pile.items.length === 1 ? "" : "s"} · {value} coins
        <div className="pile-icons">
          {pile.items.map((it) => <img key={it.id} src={itemIcon(it.kind)} style={{ borderColor: GAME.rarity[it.rarity].color }} alt="" />)}
        </div>
      </div>
    );
  }
  return null;
}

export function CoinIcon() {
  return (
    <img className="coin-icon" src={itemIcon("coin")} width="18" height="18" alt="" />
  );
}
