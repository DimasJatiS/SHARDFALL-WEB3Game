export { monadTestnet } from "viem/chains"; // chain ID 10143, built into viem

export const CONFIG = { ticketMon: "0.1", minPlayers: 4, maxPlayers: 10, mapSize: 64 } as const;

export const ESCROW = import.meta.env.VITE_ESCROW_ADDRESS as `0x${string}`;

export const escrowAbi = [
  { type: "function", name: "joinMatch", stateMutability: "payable",
    inputs: [{ name: "matchId", type: "bytes32" }], outputs: [] },
] as const;