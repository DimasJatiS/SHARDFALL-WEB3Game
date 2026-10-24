// Operator side of MatchEscrow: createMatch, isPlayer, settleMatch.
// If OPERATOR_PRIVATE_KEY / ESCROW_ADDRESS are missing the server runs off-chain (dev only).

import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

export const escrowAbi = [
  { type: "function", name: "createMatch", stateMutability: "nonpayable", inputs: [
    { name: "matchId", type: "bytes32" }, { name: "entryFee", type: "uint96" }, { name: "maxPlayers", type: "uint8" }, { name: "seedHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "settleMatch", stateMutability: "nonpayable", inputs: [
    { name: "matchId", type: "bytes32" }, { name: "top3", type: "address[3]" }, { name: "seed", type: "bytes32" }], outputs: [] },
  { type: "function", name: "isPlayer", stateMutability: "view", inputs: [
    { name: "matchId", type: "bytes32" }, { name: "player", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "operator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const KEY = process.env.OPERATOR_PRIVATE_KEY;
const ESCROW = process.env.ESCROW_ADDRESS as Address | undefined;
const RPCS = [process.env.RPC_URL || "https://rpc.ankr.com/monad_testnet", process.env.RPC_URL_FALLBACK || "https://testnet-rpc.monad.xyz"];

export const chainEnabled = !!(KEY && ESCROW);
const account = KEY ? privateKeyToAccount((KEY.startsWith("0x") ? KEY : `0x${KEY}`) as Hex) : undefined;

const clients = RPCS.map((url) => ({
  pub: createPublicClient({ chain: monadTestnet, transport: http(url) }),
  wallet: account ? createWalletClient({ chain: monadTestnet, transport: http(url), account }) : undefined,
}));

/** Run fn against the primary RPC, retry once on the fallback. */
async function withRetry<T>(label: string, fn: (c: (typeof clients)[number]) => Promise<T>): Promise<T> {
  try {
    return await fn(clients[0]);
  } catch (e) {
    console.warn(`[chain] ${label} failed on primary RPC, retrying on fallback:`, (e as Error).message.split("\n")[0]);
    return fn(clients[1]);
  }
}

export async function checkOperator() {
  if (!chainEnabled) {
    console.warn("[chain] OPERATOR_PRIVATE_KEY / ESCROW_ADDRESS not set: running OFF-CHAIN (dev only, payments not checked)");
    return;
  }
  const op = await clients[0].pub.readContract({ address: ESCROW!, abi: escrowAbi, functionName: "operator" });
  console.log(`[chain] escrow ${ESCROW}  operator ${op}  signer ${account!.address}`);
  if (op.toLowerCase() !== account!.address.toLowerCase()) console.error("[chain] WARNING: signer is not the escrow operator, createMatch will revert");
}

/** Send a tx (retrying the send once on the fallback RPC), then wait for the receipt. */
async function write(label: string, functionName: "createMatch" | "settleMatch", args: readonly unknown[]): Promise<Hex> {
  const send = (c: (typeof clients)[number]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.wallet!.writeContract({ address: ESCROW!, abi: escrowAbi, functionName, args } as any);
  let hash: Hex;
  try {
    hash = await send(clients[0]);
  } catch (e) {
    console.warn(`[chain] ${label} send failed on primary RPC, retrying on fallback:`, (e as Error).message.split("\n")[0]);
    hash = await send(clients[1]);
  }
  const r = await withRetry(`${label} receipt`, ({ pub }) => pub.waitForTransactionReceipt({ hash }));
  if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
  console.log(`[chain] ${label} ok ${hash}`);
  return hash;
}

export async function createMatch(matchId: Hex, entryFee: bigint, maxPlayers: number, seedHash: Hex): Promise<Hex | undefined> {
  if (!chainEnabled) return undefined;
  return write("createMatch", "createMatch", [matchId, entryFee, maxPlayers, seedHash]);
}

/** Wait for the player's joinMatch tx, then confirm the escrow has them registered. */
export async function verifyJoin(matchId: Hex, player: Address, txHash: Hex): Promise<boolean> {
  if (!chainEnabled) return true;
  return withRetry("verifyJoin", async ({ pub }) => {
    await pub.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 }).catch(() => undefined);
    return pub.readContract({ address: ESCROW!, abi: escrowAbi, functionName: "isPlayer", args: [matchId, player] });
  });
}

export async function settleMatch(matchId: Hex, top3: [Address, Address, Address], seed: Hex): Promise<Hex | undefined> {
  if (!chainEnabled) return undefined;
  return write("settleMatch", "settleMatch", [matchId, top3, seed]);
}
