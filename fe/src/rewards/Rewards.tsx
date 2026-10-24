// Fase 4 · lofi 04: Rewards & Redeem. Data is a local mock (see ./store) until the
// casual-mode backend and claim registry exist; every mock spot is labelled on the page.

import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { assetUrl } from "../game/assets";
import { useSite } from "../site/context";
import { ANCHOR_EVENT, consumeAnchor, peekAnchor } from "../site/router";
import { short, useWalletStatus } from "../site/wallet";
import { DEMO_CODE, EARN, VOUCHERS, type Voucher } from "./data";
import LeaderRewards from "./LeaderRewards";
import "./rewards.css";
import SkinShop from "./SkinShop";
import { claimVoucher, markUsed, redeemCode, stockLeft, useRewards, type Claim } from "./store";

const TABS = [
  { id: "voucher", label: "Tukar voucher" },
  { id: "skin", label: "Skin shop" },
  { id: "leaderboard", label: "Hadiah leaderboard" },
  { id: "redeem", label: "Redeem kode" },
  { id: "history", label: "Riwayat klaim" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const SORTS = {
  low: { label: "Poin terendah", fn: (a: Voucher, b: Voucher) => a.cost - b.cost },
  high: { label: "Poin tertinggi", fn: (a: Voucher, b: Voucher) => b.cost - a.cost },
  ending: { label: "Segera berakhir", fn: (a: Voucher, b: Voucher) => a.until.localeCompare(b.until) },
} as const;
type Sort = keyof typeof SORTS;

const fmtDate = (d: string | number) =>
  new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

const panel = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
} as const;

export default function Rewards() {
  const { address, isConnected } = useWalletStatus();
  const wallet = useRewards(address);
  const site = useSite();
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === peekAnchor()) ? (peekAnchor() as Tab) : "voucher"));
  const [modal, setModal] = useState<null | { voucher?: Voucher; claim?: Claim }>(null);

  useEffect(() => { consumeAnchor(); }, []);
  // Navbar links into a tab while this page is already open (no remount).
  useEffect(() => {
    const onAnchor = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (TABS.some((t) => t.id === id)) setTab(id as Tab);
    };
    window.addEventListener(ANCHOR_EVENT, onAnchor);
    return () => window.removeEventListener(ANCHOR_EVENT, onAnchor);
  }, []);

  const needWallet = () => {
    site.toast("Connect wallet dulu untuk menukar poin.");
    site.openWallet(false);
  };

  return (
    <div className="rw">
      <div className="rw-notice">
        <div className="lp-wrap">
          <span className="lp-tag soon">Segera · Fase 1</span>
          Halaman ini untuk mode kasual gratis. Saat hackathon, poin, voucher, dan riwayat di bawah masih <b>data contoh</b> yang tersimpan di browser ini.
        </div>
      </div>

      <div className="lp-wrap rw-body">
        <div className="rw-top">
          <section className="rw-balance">
            <span className="lp-dim">Saldo Raider Points</span>
            <motion.b key={wallet.rp} initial={{ scale: 1.08, color: "#ffe9a0" }} animate={{ scale: 1, color: "#ecebf6" }} transition={{ duration: 0.5 }}>
              {isConnected ? wallet.rp.toLocaleString("id-ID") : "—"} <small>RP</small>
            </motion.b>
            {isConnected ? (
              <p className="lp-dim">Terikat ke {short(address)}. Tidak bisa dijual atau dipindah ke wallet lain.</p>
            ) : (
              <>
                <p className="lp-dim">Connect wallet untuk melihat dan menukar poinmu.</p>
                <button className="lp-btn primary sm" onClick={() => site.openWallet(false)}>Connect Wallet</button>
              </>
            )}
          </section>
          <section className="rw-earn">
            <h3>Cara dapat poin</h3>
            <div className="rw-earn-grid">
              {EARN.map((e) => (
                <div key={e.title}>
                  <img src={assetUrl(e.icon)} alt="" />
                  <span>{e.title}</span>
                  <b>+{e.rp} RP</b>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="rw-tabs" role="tablist" aria-label="Rewards">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "history" && wallet.claims.length > 0 && <em>{wallet.claims.length}</em>}
              {tab === t.id && <motion.span className="rw-tab-bar" layoutId="rw-tab-bar" />}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.section key={tab} id={tab} role="tabpanel" aria-labelledby={`tab-${tab}`} {...panel}>
            {tab === "voucher" && (
              <VoucherGrid
                rp={isConnected ? wallet.rp : null}
                stock={(v) => stockLeft(v, wallet)}
                onPick={(v) => (isConnected ? setModal({ voucher: v }) : needWallet())}
              />
            )}
            {tab === "skin" && <SkinShop />}
            {tab === "leaderboard" && <LeaderRewards address={address} onNeedWallet={needWallet} />}
            {tab === "redeem" && <RedeemForm address={address} onNeedWallet={needWallet} />}
            {tab === "history" && <History claims={wallet.claims} onOpen={(c) => setModal({ claim: c })} onPlay={site.play} />}
          </motion.section>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {modal && address && (
          <ClaimModal
            key="claim"
            address={address}
            rp={wallet.rp}
            voucher={modal.voucher}
            existing={modal.claim}
            onClose={() => setModal(null)}
            onDone={() => setTab("history")}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ vouchers

function VoucherGrid({ rp, stock, onPick }: { rp: number | null; stock: (v: Voucher) => number; onPick: (v: Voucher) => void }) {
  const [sort, setSort] = useState<Sort>("low");
  const [kind, setKind] = useState<"all" | Voucher["kind"]>("all");
  const list = useMemo(
    () => VOUCHERS.filter((v) => kind === "all" || v.kind === kind).sort(SORTS[sort].fn),
    [sort, kind],
  );

  return (
    <>
      <div className="lp-head-row rw-head">
        <h2>Voucher sponsor</h2>
        <div className="rw-controls">
          <div className="rw-chips" role="group" aria-label="Jenis">
            {(["all", "sponsor", "skin"] as const).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "Semua" : k === "sponsor" ? "Sponsor" : "Skin"}
              </button>
            ))}
          </div>
          <label className="rw-sort">
            <span>Urutkan</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      <motion.div className="rw-grid" layout>
        <AnimatePresence>
          {list.map((v) => (
            <motion.div key={v.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
              <VoucherCard v={v} rp={rp} left={stock(v)} onPick={() => onPick(v)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

function VoucherCard({ v, rp, left, onPick }: { v: Voucher; rp: number | null; left: number; onPick: () => void }) {
  const soldOut = left <= 0;
  const lacking = rp !== null && rp < v.cost;
  return (
    <article className={`rw-card${soldOut || lacking ? " dim" : ""}`}>
      <div className={`rw-card-art ${v.kind}`}><img src={assetUrl(v.art)} alt="" /></div>
      <span className="rw-sponsor">[{v.sponsor}]</span>
      <h3>{v.title}</h3>
      <p className="lp-dim">
        {soldOut ? "Stok habis" : lacking ? `Poin kurang ${v.cost - rp!} RP` : `Sisa ${left} · berlaku s/d ${fmtDate(v.until)}`}
      </p>
      <button className="lp-btn primary block" disabled={soldOut || lacking} onClick={onPick}>
        {soldOut ? "Habis" : lacking ? `Butuh ${v.cost} RP` : `Tukar · ${v.cost} RP`}
      </button>
    </article>
  );
}

// ------------------------------------------------------------------ redeem

function RedeemForm({ address, onNeedWallet }: { address?: string; onNeedWallet: () => void }) {
  const site = useSite();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!address) return onNeedWallet();
    const r = redeemCode(address, code);
    if (!r.ok) {
      setError(r.error);
      setOk(null);
      return;
    }
    setError(null);
    setOk(`+${r.claim.points} RP dari ${r.claim.title.toLowerCase()}`);
    site.toast(`+${r.claim.points} RP ditambahkan`);
    setCode("");
  };

  return (
    <div className="rw-redeem">
      <form className="lp-card" onSubmit={submit} noValidate>
        <h2>Redeem kode</h2>
        <p className="lp-dim">Kode dari event, turnamen kampus, atau sponsor.</p>
        <label htmlFor="rw-code">Kode</label>
        <div className="lp-inline">
          <input
            id="rw-code"
            className={`mono${error ? " invalid" : ""}`}
            placeholder="ZR-XXXX-XXXX"
            value={code}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby="rw-code-msg"
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
          />
          <button className="lp-btn primary" disabled={!code.trim()}>Redeem</button>
        </div>
        <div id="rw-code-msg" aria-live="polite">
          {error && <p className="lp-error">{error}</p>}
          {ok && <p className="rw-ok">✓ {ok}</p>}
        </div>
        <p className="lp-note">
          Mode demo: coba <button type="button" className="lp-textlink" onClick={() => { setCode(DEMO_CODE); setError(null); }}>{DEMO_CODE}</button>
        </p>
      </form>
      <div className="rw-redeem-side">
        <img src={assetUrl("vfx/chest_burst.webp")} alt="" />
        <p>Setiap kode hanya bisa dipakai sekali per wallet. Klaim dicatat on-chain sehingga tidak bisa dipakai dua kali.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ history

function History({ claims, onOpen, onPlay }: { claims: Claim[]; onOpen: (c: Claim) => void; onPlay: () => void }) {
  if (!claims.length)
    return (
      <div className="rw-empty">
        <img src={assetUrl("world/chests/chest_wood.webp")} alt="" />
        <h3>Belum ada klaim</h3>
        <p className="lp-dim">Main match pertamamu untuk dapat poin.</p>
        <button className="lp-btn primary" onClick={onPlay}>Main Sekarang</button>
      </div>
    );
  return (
    <>
      <h2>Riwayat klaim</h2>
      <div className="lp-table-wrap">
        <table className="lp-table">
          <thead><tr><th>Tanggal</th><th>Voucher</th><th>Poin</th><th>Status</th><th>Tx</th><th /></tr></thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td>{fmtDate(c.at)}</td>
                <td>{c.title}</td>
                <td className={c.points < 0 ? "rw-minus" : "rw-plus"}>{c.points > 0 ? "+" : "−"}{Math.abs(c.points)}</td>
                <td><span className={`rw-status ${c.status}`}>{c.status[0].toUpperCase() + c.status.slice(1)}</span></td>
                <td className="mono" title="Contoh, belum on-chain">{short(c.tx)}</td>
                <td className="right">{c.code && c.status === "aktif" && <button className="lp-btn sm" onClick={() => onOpen(c)}>Lihat kode</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-note">Hash tx masih contoh; akan menjadi link explorer saat registry klaim di-deploy.</p>
    </>
  );
}

// ------------------------------------------------------------------ claim modal

function ClaimModal({
  address, rp, voucher, existing, onClose, onDone,
}: { address: string; rp: number; voucher?: Voucher; existing?: Claim; onClose: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<"confirm" | "processing" | "done">(existing ? "done" : "confirm");
  const [claim, setClaim] = useState<Claim | undefined>(existing);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "processing") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  useEffect(() => {
    if (!claim?.code) return;
    let live = true;
    QRCode.toDataURL(claim.code, { margin: 1, width: 220, color: { dark: "#0b0b16", light: "#ffffff" } }).then((u) => live && setQr(u));
    return () => { live = false; };
  }, [claim?.code]);

  const confirm = () => {
    if (!voucher) return;
    setPhase("processing");
    // Stand-in for the claim transaction round-trip.
    setTimeout(() => {
      const r = claimVoucher(address, voucher.id);
      if (!r.ok) {
        setError(r.error);
        setPhase("confirm");
        return;
      }
      setClaim(r.claim);
      setPhase("done");
      onDone();
    }, 1100);
  };

  return (
    <motion.div className="lp-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => phase !== "processing" && e.target === e.currentTarget && onClose()}>
      <motion.div className="lp-modal rw-modal" role="dialog" aria-modal="true" aria-labelledby="rw-modal-title" layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
        {phase !== "processing" && <button className="lp-modal-x" onClick={onClose} aria-label="Tutup">×</button>}
        <AnimatePresence mode="wait" initial={false}>
          {phase === "confirm" && voucher && (
            <motion.div key="confirm" {...panel}>
              <div className={`rw-card-art ${voucher.kind}`}><img src={assetUrl(voucher.art)} alt="" /></div>
              <h3 id="rw-modal-title">Tukar {voucher.title}?</h3>
              <div className="lp-kv"><span>Harga</span><b>{voucher.cost} RP</b></div>
              <div className="lp-kv"><span>Saldo setelah tukar</span><b>{rp - voucher.cost} RP</b></div>
              <div className="lp-kv"><span>Berlaku s/d</span><b>{fmtDate(voucher.until)}</b></div>
              {error && <p className="lp-error">{error}</p>}
              <button className="lp-btn primary block" onClick={confirm}>Tukar · {voucher.cost} RP</button>
              <button className="lp-btn block" onClick={onClose}>Batal</button>
            </motion.div>
          )}
          {phase === "processing" && (
            <motion.div key="processing" className="rw-processing" {...panel}>
              <span className="ob-spinner big" aria-hidden />
              <h3 id="rw-modal-title">Mencatat klaim…</h3>
              <p className="lp-dim">Klaim dicatat supaya voucher tidak bisa dipakai dua kali.</p>
            </motion.div>
          )}
          {phase === "done" && claim && (
            <motion.div key="done" {...panel}>
              <span className="rw-badge">✓ Klaim berhasil</span>
              <h3 id="rw-modal-title">{claim.title}</h3>
              <div className="rw-qr">{qr ? <img src={qr} alt={`QR kode voucher ${claim.code}`} /> : <span className="ob-spinner" aria-hidden />}</div>
              <p className="rw-code mono">{claim.code}</p>
              <p className="lp-dim">Tunjukkan ke kasir. Klaim tercatat sehingga tidak bisa dipakai dua kali.</p>
              <p className="lp-note">Tx klaim <span className="mono">{short(claim.tx)}</span> (contoh, belum on-chain)</p>
              <button className="lp-btn primary block" onClick={onClose}>Selesai</button>
              {claim.status === "aktif" && (
                <button className="lp-textlink rw-used" onClick={() => { markUsed(address, claim.id); onClose(); }}>
                  Tandai sudah dipakai (simulasi kasir)
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
