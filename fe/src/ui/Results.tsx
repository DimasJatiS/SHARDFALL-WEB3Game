import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { keccak256 } from "viem";
import { useReadContract } from "wagmi";
import { ESCROW, escrowAbi, explorerAddress, explorerTx, monadTestnet } from "../config";
import { fmtMon, type GameSource } from "../game/net";
import { portrait } from "../game/sprites";
import type { MatchResult } from "../shared/types";
import { CoinIcon } from "./Hud";

interface Props {
  result: MatchResult;
  selfId: string;
  source: GameSource;
  joinTx?: `0x${string}`;
  onBack: () => void;
}

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Fase 5 · lofi 03 step 5: glass overlay on top of the frozen match. */
export default function Results({ result, selfId, source, joinTx, onBack }: Props) {
  const [settleTx, setSettleTx] = useState(result.settleTx);
  useEffect(() => source.onSettled?.((tx) => setSettleTx(tx)), [source]);
  const proof = useVerification(result);

  const me = result.standings.find((s) => s.id === selfId);
  const myPrize = me && me.rank <= 3 ? result.prizesWei[me.rank - 1] : null;
  const skinOf = (id: string) => source.latest()?.players.find((p) => p.id === id)?.skin ?? 0;
  const title = me?.rank === 1 ? "Juara 1!" : me && me.rank <= 3 ? "Masuk top 3!" : "Match selesai";
  const ahead = me && me.rank > 1 ? result.standings.find((s) => s.rank === me.rank - 1) : undefined;
  const runnerUp = result.standings.find((s) => s.rank === 2);
  const lead = me && runnerUp ? me.coins - runnerUp.coins : 0;
  const gap = me && ahead ? ahead.coins - me.coins : 0;
  const taunt =
    me?.rank === 1 && runnerUp ? (lead > 0 ? `Unggul ${lead} coin dari #2.` : "Seri coin dengan #2, menang tiebreak.")
    : ahead && me ? (gap > 0 ? `${me.rank <= 3 ? "Hampir!" : "Sedikit lagi."} #${ahead.rank} hanya unggul ${gap} coin.` : `Coin-mu sama dengan #${ahead.rank}; kalah tiebreak.`)
    : null;

  const badge = result.practice
    ? { cls: "practice", text: "Latihan · simulasi" }
    : proof.ok ? { cls: "ok", text: "✓ Terverifikasi on-chain" }
    : proof.failed ? { cls: "bad", text: "✗ Verifikasi gagal" }
    : { cls: "", text: "Memverifikasi…" };

  return (
    <motion.div className="results-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <motion.div
        className={`results-card ${me && me.rank <= 3 ? "win" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="res-rank"
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 22, delay: 0.15 }}
      >
        <div className="res-head">
          <div>
            <div className={`res-title ${me && me.rank <= 3 ? "win" : ""}`}>{title}</div>
            <div className="res-rank" id="res-rank">#{me?.rank ?? "–"}<span>dari {result.standings.length}</span></div>
          </div>
          <span className={`res-badge ${badge.cls}`}>{badge.text}</span>
        </div>

        <div className={`res-prize-box ${myPrize ? "" : "none"}`}>
          <span>Hadiah</span>
          {myPrize ? (
            <motion.b initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", delay: 0.45 }}>
              +{fmtMon(myPrize)} MON {result.practice && <em>(simulasi)</em>}
            </motion.b>
          ) : (
            <b>Belum dapat hadiah</b>
          )}
        </div>

        {me && (
          <div className="res-stats">
            <div><span>Coin</span><b><CoinIcon /> {me.coins}</b></div>
            <div><span>Kill</span><b>{me.kills}</b></div>
            <div><span>Pemain</span><b>{result.standings.length}</b></div>
          </div>
        )}
        {taunt && <p className="res-taunt">{taunt}</p>}

        {!result.practice && (
          <div className="res-links">
            {joinTx ? <a href={explorerTx(joinTx)} target="_blank" rel="noreferrer">tx join ↗</a> : <span className="muted">tx join –</span>}
            {settleTx ? <a href={explorerTx(settleTx)} target="_blank" rel="noreferrer">tx settle ↗</a> : <span className="pending">menunggu settleMatch</span>}
          </div>
        )}

        <button className="btn primary big res-again" onClick={onBack}>Main Lagi</button>

        <details className="res-more">
          <summary>Klasemen & bukti on-chain</summary>
          <div className="podium">
            {[1, 0, 2].map((i) => {
              const s = result.standings[i];
              if (!s) return <div key={i} />;
              return (
                <div key={s.id} className={`pod p${s.rank} ${s.id === selfId ? "me" : ""}`}>
                  <img src={portrait(skinOf(s.id))} alt="" />
                  <b>{s.name}</b>
                  <span className="mono">{s.address ? short(s.address) : s.bot ? "bot" : ""}</span>
                  <div className="pod-block">
                    <span className="place">#{s.rank}</span>
                    <span>{fmtMon(result.prizesWei[s.rank - 1])} MON</span>
                  </div>
                </div>
              );
            })}
          </div>

          <table className="standings">
            <thead><tr><th>#</th><th>Raider</th><th>Coin</th><th>Kill</th><th>Hadiah</th></tr></thead>
            <tbody>
              {result.standings.map((s) => (
                <tr key={s.id} className={s.id === selfId ? "me" : ""}>
                  <td>{s.rank}</td>
                  <td>{s.name} {s.bot && <em className="muted">bot</em>}</td>
                  <td><CoinIcon /> {s.coins}</td>
                  <td>{s.kills}</td>
                  <td>{s.rank <= 3 ? `${fmtMon(result.prizesWei[s.rank - 1])} MON` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="onchain">
            {result.practice ? (
              <p className="muted">Match latihan: hadiah di atas adalah yang akan dibayar match ranked dengan {result.standings.length} pemain. Tidak ada MON yang berpindah.</p>
            ) : (
              <>
                <Verified result={result} proof={proof} />
                <div className="oc-row"><span>Prize pool</span><b>{fmtMon(result.poolWei)} MON</b></div>
                {result.createTx && <div className="oc-row"><span>Seed di-commit</span><a href={explorerTx(result.createTx)} target="_blank" rel="noreferrer">{short(result.createTx)} ↗</a></div>}
                {joinTx && <div className="oc-row"><span>Tiketmu</span><a href={explorerTx(joinTx)} target="_blank" rel="noreferrer">{short(joinTx)} ↗</a></div>}
                <div className="oc-row">
                  <span>Settlement</span>
                  {settleTx ? <a href={explorerTx(settleTx)} target="_blank" rel="noreferrer">{short(settleTx)} ↗</a> : <span className="pending">menunggu settleMatch</span>}
                </div>
                {ESCROW && <div className="oc-row"><span>Escrow</span><a href={explorerAddress(ESCROW)} target="_blank" rel="noreferrer">{short(ESCROW)} ↗</a></div>}
                <div className="oc-row"><span>Map seed</span><span className="mono">{result.seed}</span></div>
              </>
            )}
          </div>
        </details>
      </motion.div>
    </motion.div>
  );
}

/** Checks the fairness proof against the chain: the revealed seed hashes to the value committed in
 *  createMatch before anyone joined, and that seed is the one that generated this map. */
function useVerification(result: MatchResult) {
  const { data: m } = useReadContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "matches",
    args: result.matchId ? [result.matchId] : undefined,
    chainId: monadTestnet.id,
    query: { enabled: !result.practice && !!ESCROW && !!result.matchId, refetchInterval: (q) => (q.state.data?.[3] ? false : 3000) },
  });
  const committed = m?.[5];
  const settled = !!m?.[3];
  const seedOk = !!committed && !!result.seedHex && keccak256(result.seedHex) === committed;
  const mapOk = !!result.seedHex && parseInt(result.seedHex.slice(2, 10), 16) === result.seed;
  const ok = seedOk && mapOk;
  return { committed, settled, seedOk, mapOk, ok, failed: !!committed && !ok };
}

function Verified({ result, proof }: { result: MatchResult; proof: ReturnType<typeof useVerification> }) {
  if (!result.seedHex || !result.matchId) return null;
  const { committed, settled, seedOk, mapOk, ok } = proof;
  return (
    <div className={`verified ${ok ? "ok" : committed ? "bad" : ""}`}>
      <div className="v-title">{ok ? "✓ Terverifikasi" : committed ? "✗ Verifikasi gagal" : "Mengecek on-chain…"}</div>
      <div className="v-row">{seedOk ? "✓" : "·"} keccak256(seed yang dibuka) sama dengan hash yang di-commit sebelum ada yang join</div>
      <div className="v-row">{mapOk ? "✓" : "·"} map ini dibuat dari seed tersebut</div>
      <div className="v-row">{settled ? "✓" : "·"} hadiah dibayar oleh MatchEscrow {settled ? "" : "(menunggu)"}</div>
      <div className="v-hash mono">seed {short(result.seedHex)} · hash {committed ? short(committed) : "…"}</div>
    </div>
  );
}
