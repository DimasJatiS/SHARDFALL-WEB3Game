import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { FAUCET, explorerAddress, monadTestnet } from "../config";
import { computePrizes } from "../game/net";
import { portrait } from "../game/sprites";
import { useRewards } from "../rewards/store";
import { GAME } from "../shared/config";
import { navigate } from "./router";
import { NEED_WEI, mon, short, useWalletStatus } from "./wallet";

interface Props {
  /** Opened from a Join button: walk all the way to the match details, then the lobby. */
  forPlay: boolean;
  onClose: () => void;
  onPlay: () => void;
}

type Step = "pick" | "network" | "funds" | "ready";
const STEPS: { id: Step; label: string }[] = [
  { id: "pick", label: "Wallet" },
  { id: "network", label: "Jaringan" },
  { id: "funds", label: "Saldo" },
  { id: "ready", label: "Lobby" },
];

const swap = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.22, ease: [0.2, 0.7, 0.2, 1] },
} as const;

/**
 * Lofi 02 + 03 in one modal: pick wallet → switch to Monad Testnet → top up → match details.
 * The step is derived from live wallet state, so it advances by itself as the user acts.
 */
export function MatchOnboarding({ forPlay, onClose, onPlay }: Props) {
  const { address, isConnected, onChain, bal, enough, refetch } = useWalletStatus();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const { mutate: disconnect } = useDisconnect();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // A plain "Connect Wallet" is done once the wallet is on the right chain.
  useEffect(() => {
    if (!forPlay && onChain) onClose();
  }, [forPlay, onChain, onClose]);

  // EIP-6963 wallets come first; the generic "Injected" entry only if nothing was discovered.
  const named = connectors.filter((c) => c.id !== "injected");
  const list = named.length ? named : connectors;

  let step: Step = "ready";
  if (!isConnected) step = "pick";
  else if (!onChain) step = "network";
  else if (bal !== undefined && !enough) step = "funds";
  const steps = forPlay ? STEPS : STEPS.slice(0, 2);
  const at = steps.findIndex((s) => s.id === step);

  const { prizes } = computePrizes(GAME.players.max);

  return (
    <motion.div
      className="lp-modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="lp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-title"
        layout
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <button className="lp-modal-x" onClick={onClose} aria-label="Tutup">×</button>

        <ol className="ob-steps" aria-label="Langkah">
          {steps.map((s, i) => (
            <li key={s.id} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>
              <span>{i < at ? "✓" : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        <AnimatePresence mode="wait" initial={false}>
          {step === "pick" && (
            <motion.div key="pick" {...swap}>
              <h3 id="ob-title">Connect Wallet</h3>
              <div className="lp-wallets">
                {list.map((c) => (
                  <button key={c.uid} className="lp-wallet" disabled={connect.isPending} onClick={() => connect.mutate({ connector: c, chainId: monadTestnet.id })}>
                    {c.icon ? <img src={c.icon} alt="" /> : <span className="lp-wallet-ph" />}
                    <span>{c.id === "injected" ? "Wallet browser (MetaMask, Rabby…)" : c.name}</span>
                  </button>
                ))}
                <button className="lp-wallet" disabled>
                  <span className="lp-wallet-ph">QR</span>
                  <span>WalletConnect (QR)</span>
                  <em>segera</em>
                </button>
              </div>
              {connect.isPending && <Waiting text="Setujui koneksi di jendela wallet-mu…" />}
              {connect.error && <p className="lp-error">{connect.error.message.split("\n")[0]}</p>}
              <div className="lp-modal-foot">
                <p>Belum punya wallet? <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Pasang MetaMask ↗</a></p>
                <p className="lp-dim">Login Google + wallet otomatis: segera.</p>
              </div>
            </motion.div>
          )}

          {step === "network" && (
            <motion.div key="network" {...swap}>
              <div className="lp-modal-art"><img src="/assetv2/vfx/zone_wall.webp" alt="" /></div>
              <h3 id="ob-title">Pindah ke Monad Testnet</h3>
              <p className="lp-dim">Wallet-mu di jaringan lain. SHARDFALL berjalan di Monad Testnet (chain ID {monadTestnet.id}).</p>
              <motion.button
                className="lp-btn primary block"
                disabled={switchChain.isPending}
                onClick={() => switchChain.mutate({ chainId: monadTestnet.id })}
                animate={switchChain.isPending ? {} : { boxShadow: ["0 0 0 0 rgba(242,201,76,0.5)", "0 0 0 10px rgba(242,201,76,0)"] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              >
                {switchChain.isPending ? "Setujui di wallet…" : "Switch ke Monad Testnet"}
              </motion.button>
              <button className="lp-btn block" onClick={() => disconnect()}>Disconnect</button>
              {switchChain.error && <p className="lp-error">{switchChain.error.message.split("\n")[0]}</p>}
            </motion.div>
          )}

          {step === "funds" && (
            <motion.div key="funds" {...swap}>
              <div className="lp-kv"><span>Saldo</span><b>{mon(bal ?? 0n)} MON</b></div>
              <div className="lp-kv"><span>Tiket + gas</span><b>± {mon(NEED_WEI)} MON</b></div>
              <h3 id="ob-title">Butuh MON testnet</h3>
              <p className="lp-dim">Gratis dari faucet. Setelah masuk, kembali ke sini; langkah ini lanjut sendiri saat saldo cukup.</p>
              <a className="lp-btn primary block" href={FAUCET} target="_blank" rel="noreferrer">Buka {FAUCET.replace("https://", "")} ↗</a>
              <button className="lp-btn block" onClick={() => refetch()}>Cek saldo lagi</button>
            </motion.div>
          )}

          {step === "ready" && (
            <motion.div key="ready" {...swap}>
              <h3 id="ob-title">Siap masuk zona</h3>
              <div className="ob-match">
                <div className="lp-kv"><span>Wallet</span><b className="mono">{short(address)}</b></div>
                <div className="lp-kv"><span>Saldo</span><b>{bal !== undefined ? `${mon(bal)} MON` : "…"}</b></div>
                <div className="lp-kv"><span>Tiket</span><b>{GAME.economy.ticketMon.replace(".", ",")} MON</b></div>
                <div className="lp-kv"><span>Hadiah juara 1 ({GAME.players.max} pemain)</span><b className="ob-gold">± {mon(BigInt(prizes[0]), 4)} MON</b></div>
              </div>
              <p className="lp-note">Seed map dikunci on-chain sebelum kamu join. Tiket dibayar di lobby lewat <code>joinMatch()</code>.</p>
              <button className="lp-btn primary block" onClick={onPlay}>Masuk Lobby</button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="ob-wait" role="status">
      <span className="ob-spinner" aria-hidden />
      {text}
    </p>
  );
}

/** Lofi 02 · D: connected pill + account dropdown in the navbar. */
export function AccountMenu({ onToast }: { onToast: (msg: string) => void }) {
  const { address, bal } = useWalletStatus();
  const { rp } = useRewards(address);
  const { mutate: disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  const go = (fn: () => void) => () => { setOpen(false); fn(); };
  const copy = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ }
  };
  const skin = (() => { try { return Number(localStorage.getItem("sf.skin") ?? 0); } catch { return 0; } })();

  return (
    <div className="lp-account" ref={ref}>
      <button className="lp-btn outline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {short(address)} · {bal !== undefined ? mon(bal, 2) : "…"} MON <span className="lp-caret">▾</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="lp-menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            <div className="lp-menu-head">
              <img src={portrait(skin)} alt="" />
              <div>
                <b>{short(address)}</b>
                <span>{bal !== undefined ? mon(bal, 2) : "…"} MON · {rp} RP</span>
              </div>
            </div>
            <button onClick={go(() => navigate("home", "leaderboard"))}>Statistik & leaderboard</button>
            <button onClick={go(() => navigate("rewards"))}>Rewards & Redeem</button>
            <button onClick={go(() => navigate("play"))}>Skin saya</button>
            <button onClick={go(() => onToast("Refund tiket muncul di room lobby saat match batal."))}>Refund tiket (match batal)</button>
            <button onClick={copy}>{copied ? "Alamat tersalin ✓" : "Salin alamat"}</button>
            {address && <a href={explorerAddress(address)} target="_blank" rel="noreferrer">Lihat di Explorer ↗</a>}
            <button className="lp-menu-strong" onClick={go(() => disconnect())}>Disconnect</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
