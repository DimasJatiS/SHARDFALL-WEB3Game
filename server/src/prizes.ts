import { GAME } from "../../fe/src/shared/config";

/** Same split as MatchEscrow.settleMatch: 5% fee, then 60/25/15 (wei strings). */
export function computePrizes(players: number, ticketWei: bigint) {
  const pool = ticketWei * BigInt(players);
  const net = pool - (pool * BigInt(GAME.economy.feeBps)) / 10000n;
  const prizes = GAME.economy.prizeBps.map((bps) => ((net * BigInt(bps)) / 10000n).toString()) as [string, string, string];
  return { pool: pool.toString(), prizes };
}
