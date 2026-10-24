import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ESCROW, EXPLORER, FAUCET, explorerAddress } from "../config";
import { assetUrl } from "../game/assets";
import { SiteContext, type SiteApi } from "./context";
import { AccountMenu, MatchOnboarding } from "./MatchOnboarding";
import { navigate, type Route } from "./router";
import "./site.css";
import { useWalletStatus } from "./wallet";

interface Props {
  route: Route;
  /** Enter the lobby (wallet, ranked, practice). */
  onPlay: () => void;
  children: ReactNode;
}

const NAV: { label: string; route: Route; anchor?: string }[] = [
  { label: "Beranda", route: "home" },
  { label: "Cara Main", route: "home", anchor: "cara-main" },
  { label: "Fair Play", route: "home", anchor: "fair-play" },
  { label: "Leaderboard", route: "home", anchor: "leaderboard" },
  { label: "Skin Shop", route: "rewards", anchor: "skin" },
  { label: "Rewards", route: "rewards" },
  { label: "FAQ", route: "home", anchor: "faq" },
];

/** Shared shell for the marketing pages (home, rewards): navbar, footer, wallet modal, toasts. */
export default function SiteLayout({ route, onPlay, children }: Props) {
  const { onChain, enough } = useWalletStatus();
  const [modal, setModal] = useState<null | { forPlay: boolean }>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const api = useMemo<SiteApi>(
    () => ({
      openWallet: (forPlay) => setModal({ forPlay }),
      join: () => (onChain && enough ? onPlay() : setModal({ forPlay: true })),
      play: onPlay,
      toast: setToast,
    }),
    [onChain, enough, onPlay],
  );

  return (
    <SiteContext.Provider value={api}>
      <div className="lp">
        <Navbar route={route} onConnect={() => setModal({ forPlay: false })} onToast={setToast} />
        <AnimatePresence mode="wait">
          <motion.main
            key={route}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {children}
          </motion.main>
        </AnimatePresence>
        <Footer />
        <AnimatePresence>
          {modal && (
            <MatchOnboarding
              key="onboarding"
              forPlay={modal.forPlay}
              onClose={() => setModal(null)}
              onPlay={() => { setModal(null); onPlay(); }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {toast && (
            <motion.div
              className="lp-toast"
              role="status"
              initial={{ opacity: 0, y: 12, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: 12, x: "-50%" }}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SiteContext.Provider>
  );
}

function Navbar({ route, onConnect, onToast }: { route: Route; onConnect: () => void; onToast: (m: string) => void }) {
  const { isConnected } = useWalletStatus();
  const [scrolled, setScrolled] = useState(() => window.scrollY > 24);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const href = (r: Route, anchor?: string) => (r === "home" ? "#/" : `#/${r}`) + (anchor ? `?${anchor}` : "");

  return (
    <header className={`lp-nav${scrolled ? " scrolled" : ""}${open ? " open" : ""}`}>
      <div className="lp-wrap">
        <a className="lp-brand" href="#/" onClick={(e) => { e.preventDefault(); setOpen(false); navigate("home"); }}>
          <img src={assetUrl("ui/logo.webp")} alt="SHARDFALL" />
        </a>
        <nav className="lp-links">
          {NAV.map((n) => {
            const active = n.route === route && !n.anchor && route !== "home";
            return (
              <a
                key={n.label}
                href={href(n.route, n.anchor)}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={(e) => { e.preventDefault(); setOpen(false); navigate(n.route, n.anchor); }}
              >
                {n.label}
              </a>
            );
          })}
        </nav>
        <div className="lp-nav-right">
          <span className="lp-chain"><i />Monad Testnet</span>
          {isConnected ? <AccountMenu onToast={onToast} /> : <button className="lp-btn primary sm" onClick={onConnect}>Connect Wallet</button>}
          <button className="lp-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><span /><span /><span /></button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div>
          <img className="lp-footer-logo" src={assetUrl("ui/logo.webp")} alt="SHARDFALL" />
          <p>Monad Blitz Jogja Vol. 2</p>
          <p className="lp-dim">Testnet: tanpa nilai uang nyata.</p>
        </div>
        <nav>
          <a href="https://github.com/DimasJatiS/SHARDFALL-WEB3Game" target="_blank" rel="noreferrer">GitHub</a>
          <a href="#/rewards" onClick={(e) => { e.preventDefault(); navigate("rewards"); }}>Rewards</a>
          <a href={FAUCET} target="_blank" rel="noreferrer">Faucet</a>
          <a href={ESCROW ? explorerAddress(ESCROW) : EXPLORER} target="_blank" rel="noreferrer">Contract</a>
          <a href="#/" onClick={(e) => { e.preventDefault(); navigate("home", "faq"); }}>FAQ</a>
        </nav>
      </div>
    </footer>
  );
}
