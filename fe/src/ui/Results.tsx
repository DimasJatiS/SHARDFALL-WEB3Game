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

export default function Results({ result, selfId, source, joinTx, onBack }: Props) {
  const [settleTx, setSettleTx] = useState(result.settleTx);
  useEffect(() => source.onSettled?.((tx) => setSettleTx(tx)), [source]);

  const me = result.standings.find((s) => s.id === selfId);
  const myPrize = me && me.rank <= 3 ? result.prizesWei[me.rank - 1] : null;
  const skinOf = (id: string) => source.latest()?.players.find((p) => p.id === id)?.skin ?? 0;
  const title = me?.rank === 1 ? "Victory!" : me && me.rank <= 3 ? "Top 3!" : "Match over";

  return (
    <div className="results-page">
      <div className="results-card">
        <div className={`res-title ${me && me.rank <= 3 ? "win" : ""}`}>{title}</div>
        <div className="res-rank">#{me?.rank ?? "–"}<span>of {result.standings.length}</span></div>
        {myPrize ? (
          <div className="res-prize">+{fmtMon(myPrize)} MON {result.practice && <em>(simulated)</em>}</div>
        ) : (
          <div className="res-prize none">No prize this time</div>
        )}

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
          <thead><tr><th>#</th><th>Raider</th><th>Coins</th><th>Kills</th><th>Prize</th></tr></thead>
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
            <p className="muted">Practice match: payouts shown are what a ranked match with {result.standings.length} players would pay. No MON moved.</p>
          ) : (
            <>
              <Verified result={result} />
              <div className="oc-row"><span>Prize pool</span><b>{fmtMon(result.poolWei)} MON</b></div>
              {result.createTx && <div className="oc-row"><span>Seed committed</span><a href={explorerTx(result.createTx)} target="_blank" rel="noreferrer">{short(result.createTx)} ↗</a></div>}
              {joinTx && <div className="oc-row"><span>Your ticket</span><a href={explorerTx(joinTx)} target="_blank" rel="noreferrer">{short(joinTx)} ↗</a></div>}
              <div className="oc-row">
                <span>Settlement</span>
                {settleTx ? <a href={explorerTx(settleTx)} target="_blank" rel="noreferrer">{short(settleTx)} ↗</a> : <span className="pending">waiting for settleMatch…</span>}
              </div>
              {ESCROW && <div className="oc-row"><span>Escrow</span><a href={explorerAddress(ESCROW)} target="_blank" rel="noreferrer">{short(ESCROW)} ↗</a></div>}
              <div className="oc-row"><span>Map seed</span><span className="mono">{result.seed}</span></div>
            </>
          )}
        </div>
        <button className="btn primary big" onClick={onBack}>Play again</button>
      </div>
    </div>
  );
}

/** Checks the fairness proof against the chain: the revealed seed hashes to the value committed in
 *  createMatch before anyone joined, and that seed is the one that generated this map. */
function Verified({ result }: { result: MatchResult }) {
  const { data: m } = useReadContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "matches",
    args: result.matchId ? [result.matchId] : undefined,
    chainId: monadTestnet.id,
    query: { enabled: !!ESCROW && !!result.matchId, refetchInterval: (q) => (q.state.data?.[3] ? false : 3000) },
  });
  if (!result.seedHex || !result.matchId) return null;
  const committed = m?.[5];
  const settled = m?.[3];
  const seedOk = !!committed && keccak256(result.seedHex) === committed;
  const mapOk = parseInt(result.seedHex.slice(2, 10), 16) === result.seed;
  const ok = seedOk && mapOk;
  return (
    <div className={`verified ${ok ? "ok" : committed ? "bad" : ""}`}>
      <div className="v-title">{ok ? "✓ Verified" : committed ? "✗ Verification failed" : "Checking on-chain…"}</div>
      <div className="v-row">{seedOk ? "✓" : "·"} keccak256(revealed seed) matches the hash committed before anyone joined</div>
      <div className="v-row">{mapOk ? "✓" : "·"} this map was generated from that seed</div>
      <div className="v-row">{settled ? "✓" : "·"} prizes paid by MatchEscrow {settled ? "" : "(waiting)"}</div>
      <div className="v-hash mono">seed {short(result.seedHex)} · hash {committed ? short(committed) : "…"}</div>
    </div>
  );
}
