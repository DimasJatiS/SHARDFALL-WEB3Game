import { useState } from "react";
import { LEADERBOARD, portraitUrl, type LeaderRow } from "./data";

const PERIODS = [
  { id: "week", label: "Minggu ini" },
  { id: "all", label: "Sepanjang waktu" },
] as const;

const fmt = (n: number, d = 2) => n.toLocaleString("id-ID", { maximumFractionDigits: d });

/** Top raiders by MON earned. Avatar = the raider's skin portrait. */
export default function Leaderboard() {
  const [period, setPeriod] = useState<"week" | "all">("week");
  const rows = LEADERBOARD[period];
  const [first, second, third] = rows;

  return (
    <div className="lb">
      <div className="lb-tabs" role="tablist">
        {PERIODS.map((p) => (
          <button key={p.id} role="tab" aria-selected={period === p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="lb-podium" key={period}>
        <Podium row={second} place={2} />
        <Podium row={first} place={1} />
        <Podium row={third} place={3} />
      </div>

      <div className="lb-table-wrap">
        <table className="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Raider</th>
              <th className="num hide-sm">Match</th>
              <th className="num">Juara 1</th>
              <th className="num hide-sm">Top 3</th>
              <th className="num hide-sm">Coin terbaik</th>
              <th className="num">Hadiah</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.address} className={i < 3 ? `top r${i + 1}` : ""}>
                <td className="lb-rank">{i + 1}</td>
                <td>
                  <div className="lb-who">
                    <img className="lb-avatar" src={portraitUrl(r.skin)} alt="" />
                    <div>
                      <b>{r.name}</b>
                      <span className="mono">{r.address}</span>
                    </div>
                  </div>
                </td>
                <td className="num hide-sm">{r.matches}</td>
                <td className="num">{r.wins}</td>
                <td className="num hide-sm">{r.top3}</td>
                <td className="num hide-sm">
                  <img className="lb-coin" src="/assetv2/icons/items/coin.webp" alt="" /> {r.bestCoins}
                </td>
                <td className="num lb-earned">+{fmt(r.earned)} MON</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-note">Data contoh. Peringkat akan dibaca dari event <code>MatchSettled</code> di contract.</p>
    </div>
  );
}

function Podium({ row, place }: { row: LeaderRow; place: 1 | 2 | 3 }) {
  return (
    <div className={`lb-pod p${place}`}>
      {place === 1 && <img className="lb-crown" src="/assetv2/vfx/parry.webp" alt="" />}
      <div className="lb-pod-avatar">
        <img src={portraitUrl(row.skin)} alt="" />
      </div>
      <b>{row.name}</b>
      <span className="mono">{row.address}</span>
      <div className="lb-pod-block">
        <span className="lb-place">#{place}</span>
        <span className="lb-earned">+{fmt(row.earned)} MON</span>
        <span className="lb-sub">{row.wins} kemenangan</span>
      </div>
    </div>
  );
}
