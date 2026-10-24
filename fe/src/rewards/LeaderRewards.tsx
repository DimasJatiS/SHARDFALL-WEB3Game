// Weekly leaderboard prizes: top 10 of last week claim Raider Points once per week.
// Rank is a labelled demo value (demoRank) until it is read from MatchSettled events.

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { assetUrl } from "../game/assets";
import { useSite } from "../site/context";
import { navigate } from "../site/router";
import { LEADER_TIERS, WEEK_MS, demoRank, tierFor, weekId, weekStart } from "./data";
import { claimLeaderPrize, leaderClaimed, useRewards } from "./store";

const fmtDate = (t: number) => new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d} hari ${h} jam` : `${h} jam ${m} menit`;
}

export default function LeaderRewards({ address, onNeedWallet }: { address?: string; onNeedWallet: () => void }) {
  const site = useSite();
  const wallet = useRewards(address);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const thisWeek = weekStart(now);
  const lastWeek = thisWeek - WEEK_MS;
  const lastId = weekId(lastWeek);
  const rank = address ? demoRank(address, lastId) : null;
  const tier = rank ? tierFor(rank) : undefined;
  const claimed = leaderClaimed(wallet, lastId);

  const claim = () => {
    if (!address || !rank) return onNeedWallet();
    const r = claimLeaderPrize(address, lastId, rank);
    if (!r.ok) return site.toast(r.error);
    site.toast(`+${r.claim.points} RP dari leaderboard minggu lalu`);
  };

  return (
    <>
      <div className="lp-head-row rw-head">
        <h2>Hadiah leaderboard mingguan</h2>
        <span className="lp-dim">Reset setiap Senin 00:00 WIB · berikutnya dalam {countdown(thisWeek + WEEK_MS - now)}</span>
      </div>

      <div className="rw-lb">
        <section className="rw-lb-me">
          <span className="lp-dim">Peringkatmu minggu lalu ({fmtDate(lastWeek)} – {fmtDate(thisWeek - 1)})</span>
          {!address ? (
            <>
              <b className="rw-lb-rank">—</b>
              <p className="lp-dim">Connect wallet untuk melihat peringkat dan klaim hadiah.</p>
              <button className="lp-btn primary" onClick={onNeedWallet}>Connect Wallet</button>
            </>
          ) : (
            <>
              <motion.b key={rank} className={`rw-lb-rank${tier ? " win" : ""}`} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                #{rank}
              </motion.b>
              {tier ? (
                <>
                  <p>Hadiah: <b className="rw-gold">+{tier.rp} RP</b>{"extra" in tier && <> · {tier.extra}</>}</p>
                  <button className="lp-btn primary" disabled={claimed} onClick={claim}>
                    {claimed ? "✓ Sudah diklaim" : `Klaim ${tier.rp} RP`}
                  </button>
                </>
              ) : (
                <>
                  <p className="lp-dim">Di luar top 10. Masuk top 10 minggu ini untuk dapat hadiah.</p>
                  <button className="lp-btn primary" onClick={site.play}>Main Sekarang</button>
                </>
              )}
            </>
          )}
          <p className="lp-note">Peringkat masih contoh untuk demo; nanti dihitung dari event <code>MatchSettled</code>.</p>
        </section>

        <section className="rw-lb-tiers">
          <h3>Hadiah per peringkat</h3>
          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead><tr><th>Peringkat</th><th className="num">Raider Points</th><th>Bonus</th></tr></thead>
              <tbody>
                {LEADER_TIERS.map((t) => (
                  <tr key={t.from} className={rank && rank >= t.from && rank <= t.to ? "rw-lb-mine" : ""}>
                    <td>
                      {t.from <= 3 && <img className="rw-lb-medal" src={assetUrl("icons/items/coin.webp")} alt="" />}
                      #{t.from}{t.to > t.from && `–${t.to}`}
                    </td>
                    <td className="num rw-gold">+{t.rp}</td>
                    <td className="lp-dim">{"extra" in t ? t.extra : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lp-note">
            Peringkat diurutkan berdasarkan total hadiah MON selama seminggu.{" "}
            <button className="lp-textlink" onClick={() => navigate("home", "leaderboard")}>Lihat leaderboard →</button>
          </p>
        </section>
      </div>
    </>
  );
}
