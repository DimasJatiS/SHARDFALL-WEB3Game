import { formatEther, parseEther } from "viem";
import { useBalance, useConnection } from "wagmi";
import { monadTestnet } from "../config";
import { GAME } from "../shared/config";

/** Ticket + a small gas buffer, the minimum balance to join a ranked match. */
export const NEED_WEI = parseEther(GAME.economy.ticketMon) + parseEther("0.001");

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const mon = (wei: bigint, digits = 4) =>
  Number(formatEther(wei)).toLocaleString("id-ID", { maximumFractionDigits: digits });

export function useWalletStatus() {
  const { address, isConnected, chainId } = useConnection();
  const balance = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address, refetchInterval: 8000 } });
  const onChain = isConnected && chainId === monadTestnet.id;
  const bal = balance.data?.value;
  return { address, isConnected, onChain, bal, enough: bal !== undefined && bal >= NEED_WEI, refetch: balance.refetch };
}
