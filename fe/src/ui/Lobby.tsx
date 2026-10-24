import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { parseEther } from "viem";
import {
  useBalance, useConnection, useConnect, useConnectors, useDisconnect, useReadContracts,
  useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from "wagmi";
import { ESCROW, FAUCET, SERVER_URL, SKIN_SHOP, escrowAbi, explorerTx, monadTestnet, skinShopAbi } from "../config";
import { LocalSource, MatchConnection, RemoteSource, computePrizes, fmtMon, type GameSource } from "../game/net";
import { assetUrl, loadGameAssets } from "../game/assets";
import { SKINS, portrait, stepIcon } from "../game/sprites";
import { DEMO, GAME } from "../shared/config";
import type { LobbyState } from "../shared/types";

interface Props {
  onStart: (source: GameSource, joinTx?: `0x${string}`) => void;
}

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function Lobby({ onStart }: Props) {
  const { address, isConnected, chainId } = useConnection();
  const [name, setName] = useState(() => load("sf.name", "Raider"));
  const [skin, setSkin] = useState(() => Number(load("sf.skin", "0")));
  const [bots, setBots] = useState(5);
  const [conn, setConn] = useState<MatchConnection | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => save("sf.name", name), [name]);
  useEffect(() => save("sf.skin", String(skin)), [skin]);
  // Warm the in-game sprite cache while the player is still picking a mode.
  useEffect(() => { loadGameAssets().catch(() => { /* Game shows the error and a retry */ }); }, []);

  const onChain = isConnected && chainId === monadTestnet.id;
  const rankedReady = !!SERVER_URL && !!ESCROW;

  const findMatch = async () => {
    if (!address) return;
    setJoining(true);
    setError(null);
    try {
      setConn(await MatchConnection.join(SERVER_URL, { address, name: name.trim() || "Raider", skin }));
    } catch (e) {
      setError(`Could not reach game server at ${SERVER_URL}. ${e instanceof Error ? e.message : ""}`);
    } finally {
      setJoining(false);
    }
  };

  const practice = () => onStart(new LocalSource({ name: name.trim() || "Raider", skin, bots, address }));

  // Shortcut for demos and testing: /?practice jumps straight into a practice match.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has("practice")) return;
    history.replaceState(null, "", location.pathname);
    const seed = q.get("seed");
    onStart(new LocalSource({ name: load("sf.name", "Raider"), skin: Number(load("sf.skin", "0")), bots: Number(q.get("bots") ?? 5), seed: seed ? Number(seed) : undefined }));
  }, [onStart]);

  if (conn) {
    return (
      <div className="lobby-page">
        <Brand onHome={() => conn.leave()} />
        <RankedRoom conn={conn} onLeave={() => { conn.leave(); setConn(null); }} onStart={onStart} />
      </div>
    );
  }

  return (
    <div className="lobby-page">
      <Brand />
      <div className="lobby-grid">
        <section className="card raider">
          <h2>Your raider</h2>
          <div className="raider-row">
            <img className="portrait big" src={portrait(skin)} alt="" />
            <div className="raider-fields">
              <label className="field">
                <span>Name</span>
                <input value={name} maxLength={14} onChange={(e) => setName(e.target.value)} />
              </label>
              <SkinPicker skin={skin} setSkin={setSkin} />
            </div>
          </div>
        </section>

        <section className="card wallet">
          <h2>Wallet</h2>
          <WalletPanel />
        </section>

        <section className="card mode ranked">
          <div className="mode-head">
            <h2>Ranked match</h2>
            <span className="ticket">{GAME.economy.ticketMon} MON ticket</span>
          </div>
          <p className="muted">4–10 real players. Ticket goes into the <code>MatchEscrow</code> contract; the top 3 are paid automatically when the match settles.</p>
          <PrizeTable />
          <button className="btn primary big" disabled={!rankedReady || !onChain || joining} onClick={findMatch}>
            {joining ? "Connecting…" : "Find match"}
          </button>
          {!rankedReady && <p className="hint">Ranked needs <code>VITE_SERVER_URL</code> and <code>VITE_ESCROW_ADDRESS</code> in <code>.env</code>.</p>}
          {rankedReady && !onChain && <p className="hint">Connect a wallet on Monad Testnet to play ranked.</p>}
          {error && <p className="error">{error}</p>}
        </section>

        <section className="card mode practice">
          <div className="mode-head">
            <h2>Practice</h2>
            <span className="ticket free">free · offline</span>
          </div>
          <p className="muted">Same rules, played in your browser against bots. No wallet needed. Payouts are simulated.</p>
          <label className="field range">
            <span>Bots: <b>{bots}</b> ({bots + 1} players)</span>
            <input type="range" min={GAME.players.min - 1} max={GAME.players.max - 1} value={bots} onChange={(e) => setBots(Number(e.target.value))} />
          </label>
          <button className="btn big" onClick={practice}>Play practice</button>
        </section>
      </div>
      <HowToPlay />
    </div>
  );
}

function Brand({ onHome }: { onHome?: () => void }) {
  return (
    <header className="brand">
      <a className="back-home" href="#/" onClick={onHome}>← Beranda</a>
      <h1 className="logo"><img src={assetUrl("ui/logo.webp")} alt="SHARDFALL" /></h1>
      <div className="tagline">Isometric battle royale · loot is score · prizes paid on Monad{DEMO && <span className="demo">DEMO MODE</span>}</div>
    </header>
  );
}

function WalletPanel() {
  const { address, isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const switchChain = useSwitchChain();
  const { data: bal } = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address, refetchInterval: 8000 } });

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <div className="wallet-body">
        <p className="muted">Connect MetaMask (or any injected wallet) to buy skins and play ranked.</p>
        <button className="btn primary" disabled={!injected || connect.isPending} onClick={() => injected && connect.mutate({ connector: injected, chainId: monadTestnet.id })}>
          {connect.isPending ? "Check your wallet…" : "Connect wallet"}
        </button>
        {connect.error && <p className="error">{connect.error.message.split("\n")[0]}</p>}
      </div>
    );
  }
  return (
    <div className="wallet-body">
      <div className="addr-row">
        <span className="addr">{short(address)}</span>
        <button className="link" onClick={() => disconnect()}>disconnect</button>
      </div>
      {chainId !== monadTestnet.id ? (
        <button className="btn warn" disabled={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: monadTestnet.id })}>
          Switch to Monad Testnet
        </button>
      ) : (
        <>
          <div className="balance">{bal ? fmtMon(bal.value) : "…"} <span>MON</span></div>
          <div className="net-ok">Monad Testnet · chain {monadTestnet.id}</div>
          {bal && bal.value < parseEther(GAME.economy.ticketMon) && (
            <p className="hint">Low balance. Get test MON at <a href={FAUCET} target="_blank" rel="noreferrer">{FAUCET.replace("https://", "")}</a></p>
          )}
        </>
      )}
      {switchChain.error && <p className="error">{switchChain.error.message.split("\n")[0]}</p>}
    </div>
  );
}

function SkinPicker({ skin, setSkin }: { skin: number; setSkin: (s: number) => void }) {
  const { address } = useConnection();
  const ids = [1, 2, 3];
  const { data, refetch } = useReadContracts({
    contracts: ids.map((id) => ({ address: SKIN_SHOP!, abi: skinShopAbi, functionName: "balanceOf" as const, args: [address!, BigInt(id)] as const, chainId: monadTestnet.id })),
    query: { enabled: !!SKIN_SHOP && !!address },
  });
  const buy = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: buy.data, chainId: monadTestnet.id });
  useEffect(() => { if (receipt.isSuccess) void refetch(); }, [receipt.isSuccess, refetch]);

  // Without a SkinShop deployment every skin is available as a preview.
  const owned = (i: number) => i === 0 || !SKIN_SHOP || (data?.[i - 1]?.result ?? 0n) > 0n;

  return (
    <div className="skins">
      <span className="field-label">Skin {SKIN_SHOP ? "" : <em className="muted">(SkinShop not deployed: preview)</em>}</span>
      <div className="skin-row">
        {SKINS.map((s, i) => (
          <button key={s.name} className={`skin ${skin === i ? "sel" : ""} ${owned(i) ? "" : "locked"}`} onClick={() => owned(i) && setSkin(i)} title={s.name}>
            <img src={portrait(i)} alt="" />
            <span>{s.name}</span>
            {!owned(i) && (
              <em
                className="buy"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!address) return;
                  buy.mutate({ address: SKIN_SHOP!, abi: skinShopAbi, functionName: "buySkin", args: [BigInt(i)], value: parseEther(GAME.economy.skinPriceMon), chainId: monadTestnet.id });
                }}
              >
                {buy.isPending || receipt.isLoading ? "…" : `${GAME.economy.skinPriceMon} MON`}
              </em>
            )}
          </button>
        ))}
      </div>
      {buy.data && <a className="txlink" href={explorerTx(buy.data)} target="_blank" rel="noreferrer">skin tx {short(buy.data)}{receipt.isSuccess ? " ✓" : ""}</a>}
      {buy.error && <p className="error">{buy.error.message.split("\n")[0]}</p>}
    </div>
  );
}

function PrizeTable({ players = GAME.players.max }: { players?: number }) {
  const { pool, prizes } = computePrizes(players);
  return (
    <div className="prize-table">
      <div className="pt-head">Prize pool with {players} players: <b>{fmtMon(pool)} MON</b> <span className="muted">(5% fee)</span></div>
      <div className="pt-row">
        {prizes.map((p, i) => (
          <div key={i} className={`pt-cell r${i + 1}`}>
            <span className="place">#{i + 1}</span>
            <b>{fmtMon(p)}</b>
            <span className="pct">{GAME.economy.prizeBps[i] / 100}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankedRoom({ conn, onLeave, onStart }: { conn: MatchConnection; onLeave: () => void; onStart: Props["onStart"] }) {
  const { address } = useConnection();
  const [lobby, setLobby] = useState<LobbyState | null>(conn.lobby);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pay = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: pay.data, chainId: monadTestnet.id });

  useEffect(() => {
    const a = conn.onLobby(setLobby);
    const b = conn.onError(setErr);
    const c = conn.onStart(({ seed, selfId }) => onStart(new RemoteSource(conn, seed, selfId), pay.data));
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => { a(); b(); c(); clearInterval(t); };
  }, [conn, onStart, pay.data]);

  // Tell the server once the ticket transaction is mined.
  useEffect(() => {
    if (receipt.isSuccess && pay.data) conn.sendPaid(pay.data);
  }, [receipt.isSuccess, pay.data, conn]);

  if (!lobby) return <section className="card room"><p>Joining room…</p>{err && <p className="error">{err}</p>}<button className="btn" onClick={onLeave}>Cancel</button></section>;

  const me = lobby.players.find((p) => p.id === conn.sessionId);
  const paidCount = lobby.players.filter((p) => p.paid).length;
  const isHost = lobby.hostId === conn.sessionId;
  const secs = Math.max(0, Math.ceil((lobby.deadline - now) / 1000));
  const fee = BigInt(lobby.entryFeeWei);

  return (
    <section className="card room">
      <div className="room-head">
        <h2>Match lobby</h2>
        <span className="muted mono" title={lobby.matchId}>match {short(lobby.matchId)}</span>
        <span className={`room-timer ${secs < 15 ? "low" : ""}`}>{lobby.status === "cancelled" ? "cancelled" : `${secs}s`}</span>
      </div>
      <p className="muted">
        {paidCount}/{GAME.players.max} paid · needs {GAME.players.min} to start. {lobby.status === "waiting" && paidCount < GAME.players.min && `Lobby cancels in ${secs}s if fewer than ${GAME.players.min} pay (tickets refundable).`}
      </p>
      <div className="room-players">
        {Array.from({ length: GAME.players.max }, (_, i) => lobby.players[i]).map((p, i) => (
          <div key={p?.id ?? `empty${i}`} className={`room-slot ${p ? "taken" : ""} ${p?.paid ? "paid" : ""} ${p?.id === conn.sessionId ? "me" : ""}`}>
            {p ? (
              <>
                <img src={portrait(p.skin)} alt="" />
                <div>
                  <b>{p.name}{p.id === lobby.hostId && <em className="host">host</em>}</b>
                  <span className="mono">{short(p.address)}</span>
                </div>
                <span className="paid-tag">{p.paid ? "paid" : "unpaid"}</span>
              </>
            ) : <span className="muted">open slot</span>}
          </div>
        ))}
      </div>
      <PrizeTable players={Math.max(GAME.players.min, paidCount)} />
      <div className="room-actions">
        {me && !me.paid && (
          <button
            className="btn primary big"
            disabled={pay.isPending || receipt.isLoading || lobby.status !== "waiting" || !address}
            onClick={() => pay.mutate({ address: ESCROW!, abi: escrowAbi, functionName: "joinMatch", args: [lobby.matchId], value: fee, chainId: monadTestnet.id })}
          >
            {pay.isPending ? "Confirm in wallet…" : receipt.isLoading ? "Waiting for block…" : `Pay ticket · ${fmtMon(fee)} MON`}
          </button>
        )}
        {me?.paid && <div className="paid-ok">Ticket paid. Waiting for players…</div>}
        {isHost && (
          <button className="btn big" disabled={paidCount < GAME.players.min || lobby.status !== "waiting"} onClick={() => conn.requestStart()}>
            Start match ({paidCount}/{GAME.players.min}+)
          </button>
        )}
        <button className="btn ghost" onClick={onLeave}>Leave</button>
      </div>
      <AnimatePresence>
        {(pay.isPending || pay.data || pay.error) && (
          <JoinTxSteps
            pending={pay.isPending}
            hash={pay.data}
            mined={receipt.isSuccess}
            paid={!!me?.paid}
            error={(pay.error ?? receipt.error)?.message.split("\n")[0]}
            onRetry={() => pay.reset()}
          />
        )}
      </AnimatePresence>
      {err && <p className="error">{err}</p>}
      {lobby.createTx && <a className="txlink" href={explorerTx(lobby.createTx)} target="_blank" rel="noreferrer">seed hash committed on-chain {short(lobby.createTx)} ↗</a>}
      {lobby.status === "cancelled" && <p className="error">Lobby cancelled: fewer than {GAME.players.min} paid players.</p>}
      {lobby.status === "cancelled" && me?.paid && <RefundButton matchId={lobby.matchId} />}
    </section>
  );
}

/** Lofi 03 steps 2–3: the ticket transaction as three live steps (wallet → block → room). */
function JoinTxSteps({ pending, hash, mined, paid, error, onRetry }: {
  pending: boolean; hash?: `0x${string}`; mined: boolean; paid: boolean; error?: string; onRetry: () => void;
}) {
  const steps = [
    { label: "Confirm in wallet", done: !!hash, now: pending },
    { label: "Waiting for block", done: mined, now: !!hash && !mined },
    { label: "Entering room", done: paid, now: mined && !paid },
  ];
  const busy = !error && steps.some((s) => s.now);
  return (
    <motion.div className="tx-steps" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className={`tx-ring ${paid ? "ok" : error ? "bad" : busy ? "busy" : ""}`} aria-hidden>{paid ? "✓" : error ? "!" : ""}</div>
      <div>
        <b>{error ? "Ticket failed" : paid ? "Ticket confirmed" : "Paying ticket…"}</b>
        <ol>
          {steps.map((s) => (
            <li key={s.label} className={s.done ? "done" : s.now ? "now" : ""}>{s.label} <span>{s.done ? "✓" : s.now ? "●" : "○"}</span></li>
          ))}
        </ol>
        {hash && <a className="txlink" href={explorerTx(hash)} target="_blank" rel="noreferrer">tx {short(hash)} ↗</a>}
        {error && (
          <p className="error">
            {error} <button className="link" onClick={onRetry}>Try again</button>
          </p>
        )}
      </div>
    </motion.div>
  );
}

function HowToPlay() {
  return (
    <section className="howto">
      <div><img src={stepIcon("loot")} alt="" /><b>1 · Loot</b><span>Clear monster camps, hold F to open chests. Every item is worth coins: common 10, rare 25, epic 60.</span></div>
      <div><img src={stepIcon("quota")} alt="" /><b>2 · Make quota</b><span>At the end of each zone phase, anyone holding fewer coins than the quota is eliminated.</span></div>
      <div><img src={stepIcon("fight")} alt="" /><b>3 · Fight</b><span>Attack, defend, parry. Killed raiders drop all their loot — the fastest way to get rich.</span></div>
      <div><img src={stepIcon("paid")} alt="" /><b>4 · Get paid</b><span>Top 3 split the pool 60/25/15, paid by the smart contract the moment the match settles.</span></div>
    </section>
  );
}

/** Pull your ticket back from MatchEscrow once the contract allows it. */
function RefundButton({ matchId }: { matchId: `0x${string}` }) {
  const { address } = useConnection();
  const { data: available } = useReadContracts({
    contracts: [
      { address: ESCROW!, abi: escrowAbi, functionName: "refundAvailable", args: [matchId], chainId: monadTestnet.id },
      { address: ESCROW!, abi: escrowAbi, functionName: "refunded", args: [matchId, address!], chainId: monadTestnet.id },
    ],
    query: { enabled: !!ESCROW && !!address, refetchInterval: 4000 },
  });
  const refund = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: refund.data, chainId: monadTestnet.id });
  const canRefund = available?.[0]?.result === true;
  const done = available?.[1]?.result === true || receipt.isSuccess;
  return (
    <div className="refund">
      <button
        className="btn warn"
        disabled={!canRefund || done || refund.isPending || receipt.isLoading}
        onClick={() => refund.mutate({ address: ESCROW!, abi: escrowAbi, functionName: "refund", args: [matchId], chainId: monadTestnet.id })}
      >
        {done ? "Ticket refunded ✓" : refund.isPending ? "Confirm in wallet…" : receipt.isLoading ? "Refunding…" : canRefund ? "Refund my ticket" : "Refund opens 2 min after lobby creation…"}
      </button>
      {refund.data && <a className="txlink" href={explorerTx(refund.data)} target="_blank" rel="noreferrer">refund tx {short(refund.data)}</a>}
      {refund.error && <p className="error">{refund.error.message.split("\n")[0]}</p>}
    </div>
  );
}
