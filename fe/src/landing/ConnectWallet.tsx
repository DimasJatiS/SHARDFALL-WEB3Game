import { useEffect, useRef, useState } from "react";
import { useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { FAUCET, explorerAddress, monadTestnet } from "../config";
import { MOCK_RP } from "./data";
import { NEED_WEI, mon, short, useWalletStatus } from "./wallet";

interface ModalProps {
  /** true when opened from a Join button: show "go to lobby" once ready */
  forPlay: boolean;
  onClose: () => void;
  onPlay: () => void;
}

/** Lofi 02: pick wallet → wrong network → low balance → ready. The step is derived from wallet state. */
export function ConnectWalletModal({ forPlay, onClose, onPlay }: ModalProps) {
  const { address, isConnected, onChain, bal, enough, refetch } = useWalletStatus();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const { mutate: disconnect } = useDisconnect();

  // Close on Esc; close by itself after a plain "Connect Wallet" succeeds.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!forPlay && onChain) onClose();
  }, [forPlay, onChain, onClose]);

  // EIP-6963 wallets come first; the generic "Injected" entry only if nothing was discovered.
  const named = connectors.filter((c) => c.id !== "injected");
  const list = named.length ? named : connectors;

  let step: "pick" | "network" | "funds" | "ready" = "ready";
  if (!isConnected) step = "pick";
  else if (!onChain) step = "network";
  else if (bal !== undefined && !enough) step = "funds";

  return (
    <div className="lp-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lp-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title" key={step}>
        <button className="lp-modal-x" onClick={onClose} aria-label="Tutup">×</button>

        {step === "pick" && (
          <>
            <h3 id="wallet-title">Connect Wallet</h3>
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
            {connect.isPending && <p className="lp-note">Cek jendela wallet-mu…</p>}
            {connect.error && <p className="lp-error">{connect.error.message.split("\n")[0]}</p>}
            <div className="lp-modal-foot">
              <p>Belum punya wallet? <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Pasang MetaMask ↗</a></p>
              <p className="lp-dim">Login Google + wallet otomatis: segera.</p>
            </div>
          </>
        )}

        {step === "network" && (
          <>
            <div className="lp-modal-art"><img src="/assetv2/vfx/zone_wall.webp" alt="" /></div>
            <h3 id="wallet-title">Pindah ke Monad Testnet</h3>
            <p className="lp-dim">Wallet-mu di jaringan lain. SHARDFALL berjalan di Monad Testnet (chain ID {monadTestnet.id}).</p>
            <button className="lp-btn primary block" disabled={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: monadTestnet.id })}>
              {switchChain.isPending ? "Setujui di wallet…" : "Switch ke Monad Testnet"}
            </button>
            <button className="lp-btn block" onClick={() => disconnect()}>Disconnect</button>
            {switchChain.error && <p className="lp-error">{switchChain.error.message.split("\n")[0]}</p>}
          </>
        )}

        {step === "funds" && (
          <>
            <div className="lp-kv"><span>Saldo</span><b>{mon(bal ?? 0n)} MON</b></div>
            <div className="lp-kv"><span>Tiket + gas</span><b>± {mon(NEED_WEI)} MON</b></div>
            <h3 id="wallet-title">Butuh MON testnet</h3>
            <p className="lp-dim">Gratis dari faucet. Setelah masuk, kembali ke sini dan tekan Join.</p>
            <a className="lp-btn primary block" href={FAUCET} target="_blank" rel="noreferrer">Buka {FAUCET.replace("https://", "")} ↗</a>
            <button className="lp-btn block" onClick={() => refetch()}>Cek saldo lagi</button>
          </>
        )}

        {step === "ready" && (
          <>
            <div className="lp-modal-art"><img src="/assetv2/icons/steps/paid@2x.webp" alt="" /></div>
            <h3 id="wallet-title">Siap masuk zona</h3>
            <p className="lp-dim">{short(address)} · {bal !== undefined ? `${mon(bal)} MON` : "memuat saldo…"} di Monad Testnet.</p>
            <button className="lp-btn primary block" onClick={onPlay}>Lanjut ke lobby</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Lofi 02 · D: connected pill + account dropdown in the navbar. */
export function AccountMenu({ onNavigate, onToast }: { onNavigate: (id: string) => void; onToast: (msg: string) => void }) {
  const { address, bal } = useWalletStatus();
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

  return (
    <div className="lp-account" ref={ref}>
      <button className="lp-btn outline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {short(address)} · {bal !== undefined ? mon(bal, 2) : "…"} MON <span className="lp-caret">▾</span>
      </button>
      {open && (
        <div className="lp-menu">
          <div className="lp-menu-head">
            <img src="/assetv2/ui/portraits/knight.webp" alt="" />
            <div>
              <b>{short(address)}</b>
              <span>{bal !== undefined ? mon(bal, 2) : "…"} MON · {MOCK_RP} RP</span>
            </div>
          </div>
          <button onClick={go(() => onNavigate("leaderboard"))}>Statistik & leaderboard</button>
          <button onClick={go(() => onToast("Halaman Rewards & Redeem segera hadir (Fase 1)."))}>Rewards & Redeem</button>
          <button onClick={go(() => onNavigate("skin"))}>Skin saya</button>
          <button onClick={go(() => onToast("Refund tiket ada di room lobby saat match batal."))}>Refund tiket (match batal)</button>
          <button onClick={copy}>{copied ? "Alamat tersalin ✓" : "Salin alamat"}</button>
          {address && <a href={explorerAddress(address)} target="_blank" rel="noreferrer">Lihat di Explorer ↗</a>}
          <button className="lp-menu-strong" onClick={go(() => disconnect())}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
