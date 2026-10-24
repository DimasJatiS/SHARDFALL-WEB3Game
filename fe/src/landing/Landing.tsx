import { Suspense, lazy, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ESCROW, EXPLORER, FAUCET, explorerAddress, explorerTx } from "../config";
import { computePrizes } from "../game/net";
import { GAME, ITEM_DESC, ITEM_NAMES } from "../shared/config";
import type { ItemKind } from "../shared/types";
import { useSite } from "../site/context";
import { consumeAnchor, navigate, scrollToAnchor as scrollTo } from "../site/router";
import { mon, useWalletStatus } from "../site/wallet";
import Leaderboard from "./Leaderboard";
import { CONTROLS, FAQ, OPEN_MATCHES, PORTRAITS, ROADMAP, SPONSORS, STEPS, asset, portraitUrl } from "./data";

// three.js + r3f only load when the hero mounts; the falling CSS shards show meanwhile.
const HeroCrystals = lazy(() => import("./HeroCrystals"));

const TICKET = GAME.economy.ticketMon.replace(".", ",");
/** "5 menit" / "90 detik" (DEMO mode shortens matches). */
const duration = (s: number) => (s % 60 === 0 ? `${s / 60} menit` : `${s} detik`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default function Landing() {
  const { isConnected } = useWalletStatus();
  const site = useSite();

  // Arrived from another page's "Cara Main" / "FAQ" link: jump to that section.
  useEffect(() => { consumeAnchor(); }, []);

  // Reveal sections as they scroll into view.
  useEffect(() => {
    const els = document.querySelectorAll(".lp .reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const join = site.join;

  return (
    <>
      <Hero onJoin={join} onPractice={site.play} />

      <section className="lp-band alt">
        <div className="lp-wrap">
          <Casual />
          <OpenMatches onJoin={join} />
        </div>
      </section>

      <section id="cara-main" className="lp-band">
        <div className="lp-wrap reveal">
          <Eyebrow>Tutorial</Eyebrow>
          <h2>Cara main dalam 5 langkah</h2>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <div className="lp-step-art"><img src={asset(s.icon)} alt="" /></div>
                <b>{i + 1}. {s.title}</b>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="kontrol" className="lp-band alt">
        <div className="lp-wrap lp-split reveal">
          <div>
            <Eyebrow>Kontrol</Eyebrow>
            <h2>Keyboard + mouse</h2>
            <div className="lp-keys">
              {CONTROLS.map((c) => (
                <div key={c.label} className="lp-key">
                  <span className="lp-kbds">
                    {c.keys.map((k, i) => (
                      <span key={k}>{i > 0 && "–"}<kbd>{k}</kbd></span>
                    ))}
                  </span>
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
          <ParryDemo />
        </div>
      </section>

      <section id="zona" className="lp-band">
        <div className="lp-wrap lp-split zone reveal">
          <ZoneDiagram />
          <div>
            <Eyebrow>Zona</Eyebrow>
            <h2>{duration(GAME.matchSeconds)}, 4 fase, zona terus menyusut</h2>
            <ZoneTable />
            <p className="lp-note">Kuota menyesuaikan jumlah pemain. HUD menyala merah 10 detik sebelum fase habis jika coin di bawah kuota.</p>
          </div>
        </div>
      </section>

      <section id="loot" className="lp-band alt">
        <div className="lp-wrap reveal">
          <Eyebrow>Loot</Eyebrow>
          <h2>Item, rarity, dan nilai coin</h2>
          <Loot />
        </div>
      </section>

      <section id="fair-play" className="lp-band">
        <div className="lp-wrap reveal">
          <Eyebrow>Fair play</Eyebrow>
          <h2>Tidak perlu percaya siapa pun. Cek sendiri.</h2>
          <p className="lp-lead">Blockchain hanya mengerjakan 3 hal: memegang tiket, mengunci seed map, dan membayar top 3.</p>
          <FairPlay />
        </div>
      </section>

      <section id="leaderboard" className="lp-band alt">
        <div className="lp-wrap reveal">
          <div className="lp-head-row">
            <div>
              <Eyebrow>Leaderboard</Eyebrow>
              <h2>Raider teratas</h2>
            </div>
            <span className="lp-dim">Diurutkan berdasarkan total hadiah MON</span>
          </div>
          <Leaderboard />
        </div>
      </section>

      <section id="skin" className="lp-band">
        <div className="lp-wrap reveal">
          <div className="lp-head-row">
            <div>
              <Eyebrow>Skin shop</Eyebrow>
              <h2>Kosmetik saja, tidak mengubah stat</h2>
            </div>
            <span className="lp-dim">ERC-1155 · {GAME.economy.skinPriceMon.replace(".", ",")} MON per skin</span>
          </div>
          <div className="lp-skins">
            {PORTRAITS.map((p, i) => (
              <div key={p} className={`lp-skin s-${p}`}>
                <div className="lp-skin-art"><img src={portraitUrl(i)} alt="" /></div>
                <b>{p[0].toUpperCase() + p.slice(1)}</b>
                {i === 0 ? (
                  <span className="lp-dim">Default · dimiliki</span>
                ) : (
                  <button className="lp-btn block" onClick={() => navigate("rewards", "skin")}>Beli {GAME.economy.skinPriceMon.replace(".", ",")} MON</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band alt">
        <div className="lp-wrap reveal">
          <Eyebrow>Roadmap</Eyebrow>
          <h2>Dari testnet ke platform Fair Match</h2>
          <ol className="lp-roadmap">
            {ROADMAP.map((r, i) => (
              <li key={r.title} className={i === 0 ? "now" : ""}>
                <span className="lp-tag">{r.tag}</span>
                <b>{r.title}</b>
                <p>{r.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="faq" className="lp-band">
        <div className="lp-wrap narrow reveal">
          <h2>FAQ</h2>
          <div className="lp-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cta">
        <div className="lp-wrap">
          <h2>Siap masuk zona?</h2>
          <div className="lp-actions">
            {!isConnected && <button className="lp-btn outline" onClick={() => site.openWallet(false)}>Connect Wallet</button>}
            <button className="lp-btn primary" onClick={join}>Main Sekarang</button>
          </div>
        </div>
      </section>

    </>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="lp-eyebrow">{children}</span>;
}

function Hero({ onJoin, onPractice }: { onJoin: () => void; onPractice: () => void }) {
  return (
    <section className="lp-hero">
      <div className="lp-hero-bg" style={{ backgroundImage: `url(${asset("ui/lobby_bg.webp")})` }} />
      <Suspense fallback={<FallingShards />}>
        <HeroCrystals />
      </Suspense>
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <span className="lp-mono">Battle royale {duration(GAME.matchSeconds)} · {GAME.players.min}–{GAME.players.max} raider · langsung di browser</span>
          <h1>Kaya, atau <span>tereliminasi.</span></h1>
          <p>Rampas loot, kejar kuota tiap zona, dan bertahan sampai lingkaran terakhir. Tiketmu dikunci smart contract, Top 3 dibayar MON tanpa perantara.</p>
          <div className="lp-actions">
            <button className="lp-btn primary lg" onClick={onJoin}>Masuk Arena · {TICKET} MON</button>
            <button className="lp-btn lg" onClick={() => scrollTo("cara-main")}>Cara Main</button>
          </div>
          <ul className="lp-checks">
            <li>Tiket di escrow on-chain</li>
            <li>Seed map dikunci sebelum join</li>
            <li>Top 3 dibayar otomatis</li>
          </ul>
          <button className="lp-textlink" onClick={onPractice}>Atau coba mode latihan gratis tanpa wallet →</button>
        </div>
        <div className="lp-hero-art">
          <div className="lp-frame">
            <img src={asset("ui/key_art.webp")} alt="Raider SHARDFALL menghadapi Titan di pulau yang dikelilingi zona" />
            <span className="lp-frame-tag">Isometric voxel · zona menyusut · loot & parry</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function FallingShards() {
  return (
    <div className="lp-shards" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => <i key={i} />)}
    </div>
  );
}

function Casual() {
  const toRewards = (tab?: string) => navigate("rewards", tab);
  return (
    <div className="lp-casual reveal">
      <div>
        <span className="lp-tag soon">Segera · Mode Kasual</span>
        <h2>Main gratis, kumpulkan Raider Points, tukar voucher sponsor</h2>
        <p className="lp-dim">Poin tidak bisa dijual atau dipindah. Klaim voucher dicatat on-chain, jadi tidak bisa dipakai dua kali.</p>
        <div className="lp-actions">
          <button className="lp-btn primary" onClick={() => toRewards()}>Buka Rewards & Redeem</button>
          <button className="lp-btn" onClick={() => toRewards("redeem")}>Punya kode? Redeem</button>
        </div>
      </div>
      <div className="lp-vouchers">
        {SPONSORS.map((s) => (
          <div key={s.tag} className="lp-voucher">
            <div className="lp-voucher-art"><img src={asset(s.img)} alt="" /></div>
            <span className="lp-dim">[Sponsor] {s.tag}</span>
            <b>{s.title}</b>
            <span className="lp-rp">{s.rp} RP</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpenMatches({ onJoin }: { onJoin: () => void }) {
  const prize = (n: number) => mon(BigInt(computePrizes(n).pool), 2);
  return (
    <div className="lp-matches reveal">
      <div className="lp-head-row">
        <div>
          <h2>Match terbuka</h2>
          <p className="lp-dim">Mulai otomatis saat {GAME.players.max} slot penuh, atau host menekan Start saat ≥ {GAME.players.min} pemain.</p>
        </div>
        <a className="lp-textlink" href={FAUCET} target="_blank" rel="noreferrer">Belum punya MON testnet? Ambil di faucet →</a>
      </div>
      <div className="lp-table-wrap">
        <table className="lp-table">
          <thead>
            <tr><th>Match ID</th><th>Pemain</th><th>Tiket</th><th>Prize pool</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {OPEN_MATCHES.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.id}</td>
                <td>
                  <div className="lp-fill"><i style={{ width: `${(m.players / m.max) * 100}%` }} /></div>
                  {m.players} / {m.max}
                </td>
                <td>{TICKET} MON</td>
                <td>{prize(m.players)} MON</td>
                <td>
                  <span className={`lp-status ${m.status}`}>
                    {m.status === "lobby" && "Lobby · siap mulai"}
                    {m.status === "countdown" && `Lobby · batal dalam ${clock(m.clock ?? 0)}`}
                    {m.status === "playing" && `Sedang main · ${clock(m.clock ?? 0)}`}
                  </span>
                </td>
                <td className="right">
                  {m.status === "playing"
                    ? <a className="lp-btn sm" href={EXPLORER} target="_blank" rel="noreferrer">Lihat tx</a>
                    : <button className="lp-btn primary sm" onClick={onJoin}>Join</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-note">Daftar ini contoh; lobby asli tampil setelah kamu masuk.</p>
    </div>
  );
}

const DEMO_FRAMES = [
  "idle_01", "idle_02", "idle_01", "attack_01", "attack_02", "attack_03", "idle_01", "defend_01", "defend_01", "defend_01", "attack_02", "attack_03",
];

/** Loop of real sprite frames: attack → defend → parry flash → counter. */
function ParryDemo() {
  const [f, setF] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setF((x) => (x + 1) % DEMO_FRAMES.length), 180);
    return () => clearInterval(t);
  }, []);
  const parry = f === 9;
  return (
    <div className="lp-demo">
      <div className="lp-demo-stage">
        <img className="lp-demo-enemy" src={asset(parry ? "sprites/enemies/enforcer/stun_01.webp" : f >= 7 && f <= 8 ? "sprites/enemies/enforcer/attack_01.webp" : "sprites/enemies/enforcer/idle_01.webp")} alt="" />
        <img className="lp-demo-raider" src={asset(`sprites/raider/sword/${DEMO_FRAMES[f]}.webp`)} alt="" />
        {parry && <img className="lp-demo-fx" src={asset("vfx/parry.webp")} alt="" />}
        {(f === 4 || f === 11) && <img className="lp-demo-fx hit" src={asset("vfx/slash.webp")} alt="" />}
      </div>
      <b>Defend → parry → serangan balik ×{GAME.combat.parryBonus}</b>
      <span className="lp-dim">Tekan Spasi tepat saat musuh menyerang: lawan stun {GAME.combat.parryStun} dtk.</span>
    </div>
  );
}

function ZoneDiagram() {
  return (
    <div className="lp-zone" aria-hidden>
      <div className="ring r1" />
      <div className="ring r2" />
      <div className="ring r3" />
      <div className="ring live" />
      <img src={asset("world/chests/chest_boss.webp")} alt="" />
    </div>
  );
}

function ZoneTable() {
  const names = ["Loot", "Fase 1", "Fase 2", "Fase 3", "Final"];
  return (
    <div className="lp-table-wrap">
      <table className="lp-table compact">
        <thead><tr><th>Fase</th><th>Waktu</th><th>Damage luar zona</th><th>Kuota coin ({GAME.players.max} pemain)</th></tr></thead>
        <tbody>
          {GAME.zone.map((z, i) => (
            <tr key={i}>
              <td>{names[i]}</td>
              <td className="mono">{clock(z.start)}–{clock(z.end)}</td>
              <td>{z.dps ? `${z.dps} HP/dtk` : "0"}</td>
              <td>{z.quota ? Math.round(z.quota) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ITEMS: ItemKind[] = ["sword", "staff", "bow", "armor", "heal", "speed", "maxhp", "invuln"];

function Loot() {
  return (
    <>
      <div className="lp-rarity">
        {GAME.rarity.map((r) => (
          <div key={r.name} className="lp-rar" style={{ "--rar": r.color } as CSSProperties}>
            <b>{r.name}</b>
            <span><img src={asset("icons/items/coin.webp")} alt="" />{r.value} coin · stat ×{r.mult.toLocaleString("id-ID")}</span>
          </div>
        ))}
      </div>
      <div className="lp-items">
        {ITEMS.map((k) => (
          <div key={k} className="lp-item">
            <img src={asset(`icons/items/${k}@2x.webp`)} alt="" />
            <b>{ITEM_NAMES[k]}</b>
            <span>{ITEM_DESC[k]}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function FairPlay() {
  const players = GAME.players.max;
  const { pool, prizes } = computePrizes(players);
  const poolWei = BigInt(pool);
  const fee = (poolWei * BigInt(GAME.economy.feeBps)) / 10000n;
  const pct = (bps: number) => `${bps / 100}%`;
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const copy = async () => {
    if (!ESCROW) return;
    try { await navigator.clipboard.writeText(ESCROW); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ }
  };
  const check = () => {
    const q = query.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(q)) { setErr(null); window.open(explorerTx(q), "_blank", "noreferrer"); }
    else setErr("Masukkan tx hash (0x + 64 karakter hex).");
  };

  return (
    <>
      <div className="lp-fns">
        <div><code>createMatch()</code><b>Seed map dikunci</b><p>Hash seed dicatat sebelum ada yang join. Posisi loot dan arah zona tidak bisa diatur.</p></div>
        <div><code>joinMatch()</code><b>Tiket ke escrow</b><p>{TICKET} MON masuk ke smart contract. Server tidak pernah memegang uang.</p></div>
        <div><code>settleMatch()</code><b>Seed dibuka, hadiah cair</b><p>Contract cek seed cocok dengan hash, lalu bayar top 3 dalam satu transaksi.</p></div>
      </div>
      <div className="lp-fair-grid">
        <div className="lp-card">
          <h3>Pembagian hadiah ({players} pemain)</h3>
          <div className="lp-kv"><span>Total pool</span><b>{mon(poolWei)} MON</b></div>
          <div className="lp-kv"><span>Fee platform {pct(GAME.economy.feeBps)}</span><b>{mon(fee)} MON</b></div>
          {prizes.map((p, i) => (
            <div key={i} className={`lp-kv place p${i + 1}`}><span>Juara {i + 1} · {pct(GAME.economy.prizeBps[i])}</span><b>{mon(BigInt(p))} MON</b></div>
          ))}
        </div>
        <div className="lp-card">
          <h3>Contract MatchEscrow</h3>
          <div className="lp-inline">
            <input readOnly value={ESCROW ?? "Belum di-deploy (isi VITE_ESCROW_ADDRESS)"} className="mono" />
            <button className="lp-btn sm" disabled={!ESCROW} onClick={copy}>{copied ? "Tersalin" : "Salin"}</button>
            <a className={`lp-btn sm${ESCROW ? "" : " disabled"}`} href={ESCROW ? explorerAddress(ESCROW) : undefined} target="_blank" rel="noreferrer">Explorer ↗</a>
          </div>
          <h3>Verifikasi match</h3>
          <div className="lp-inline">
            <input placeholder="Tempel tx hash join / settle" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && check()} />
            <button className="lp-btn primary sm" onClick={check}>Cek</button>
          </div>
          {err ? <p className="lp-error">{err}</p> : <p className="lp-note">Cocokkan: seed hash ✓ · seed dibuka ✓ · 3 payout ✓ → badge "Terverifikasi".</p>}
        </div>
      </div>
    </>
  );
}
