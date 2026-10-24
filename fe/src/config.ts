// Web3 + deployment config. Values come from .env (see .env.example).

import type { Address } from "viem";
export { monadTestnet } from "viem/chains"; // chain ID 10143, built into viem

const env = import.meta.env;
const addr = (v: string | undefined) =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

export const ESCROW = addr(env.VITE_ESCROW_ADDRESS);
export const SKIN_SHOP = addr(env.VITE_SKIN_SHOP_ADDRESS);
/** Colyseus server, e.g. ws://localhost:2567. Empty = practice mode only. */
export const SERVER_URL: string = env.VITE_SERVER_URL ?? "";
export const RPC_URL: string =
  env.VITE_RPC_URL || "https://testnet-rpc.monad.xyz";
export const EXPLORER = "https://testnet.monadvision.com";
export const FAUCET = "https://faucet.monad.xyz";

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
console.log("Config:", {
  ESCROW,
  SKIN_SHOP,
  SERVER_URL,
  RPC_URL,
  EXPLORER,
  FAUCET,
});

export const escrowAbi = [
  {
    type: "function",
    name: "joinMatch",
    stateMutability: "payable",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "event",
    name: "MatchCreated",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "entryFee", type: "uint96", indexed: false },
      { name: "seedHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PlayerJoined",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "MatchSettled",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "top3", type: "address[3]", indexed: false },
      { name: "prizes", type: "uint256[3]", indexed: false },
      { name: "seed", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const skinShopAbi = [
  {
    type: "function",
    name: "buySkin",
    stateMutability: "payable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;
