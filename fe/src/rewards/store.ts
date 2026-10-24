// Raider Points + claims for the casual mode (Fase 1). Until the RewardsRegistry contract
// and backend exist this is a local mock per wallet, persisted in this browser only.
// Keep the API (balance, claim, redeem, history) when swapping in real reads/writes.

import { useSyncExternalStore } from "react";
import { REDEEM_CODES, STARTING_RP, VOUCHERS, tierFor, type Voucher } from "./data";

export interface Claim {
  id: string;
  at: number;
  kind: "voucher" | "code" | "leaderboard";
  title: string;
  /** negative = spent, positive = earned */
  points: number;
  status: "aktif" | "selesai" | "kedaluwarsa";
  /** Voucher code shown to the cashier (voucher claims only). */
  code?: string;
  /** Mock hash, not on-chain yet. */
  tx: string;
  voucherId?: string;
}

interface WalletRewards {
  rp: number;
  claims: Claim[];
  usedCodes: string[];
  /** voucherId → claimed count, to shrink "Sisa" */
  taken: Record<string, number>;
  /** Week ids whose leaderboard prize was claimed. Optional: older saves lack it. */
  leaderWeeks?: string[];
}

const KEY = "sf.rewards.v1";
type Db = Record<string, WalletRewards>;

const fresh = (): WalletRewards => ({ rp: STARTING_RP, claims: [], usedCodes: [], taken: {} });

let db: Db = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Db;
  } catch {
    return {};
  }
})();
const listeners = new Set<() => void>();

function commit(next: Db) {
  db = next;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private mode: keep in memory */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const GUEST = fresh();
const keyOf = (address?: string) => address?.toLowerCase() ?? "";
const read = (address?: string) => (address ? db[keyOf(address)] ?? GUEST : GUEST);

function update(address: string, fn: (w: WalletRewards) => WalletRewards) {
  commit({ ...db, [keyOf(address)]: fn(db[keyOf(address)] ?? fresh()) });
}

const mockTx = () =>
  "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const voucherCode = (v: Voucher) =>
  `${v.prefix}-${Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(36).toUpperCase().padStart(2, "0")).join("").slice(0, 6)}`;

export function useRewards(address?: string) {
  return useSyncExternalStore(subscribe, () => read(address));
}

export function stockLeft(v: Voucher, w: WalletRewards) {
  return Math.max(0, v.stock - (w.taken[v.id] ?? 0));
}

export type ClaimResult = { ok: true; claim: Claim } | { ok: false; error: string };

export function claimVoucher(address: string, voucherId: string): ClaimResult {
  const v = VOUCHERS.find((x) => x.id === voucherId);
  const w = read(address);
  if (!v) return { ok: false, error: "Voucher tidak ditemukan." };
  if (stockLeft(v, w) <= 0) return { ok: false, error: "Voucher sudah habis." };
  if (w.rp < v.cost) return { ok: false, error: `Poin kurang ${v.cost - w.rp} RP.` };
  const claim: Claim = {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind: "voucher",
    title: v.title,
    points: -v.cost,
    status: "aktif",
    code: voucherCode(v),
    tx: mockTx(),
    voucherId: v.id,
  };
  update(address, (x) => ({
    ...x,
    rp: x.rp - v.cost,
    claims: [claim, ...x.claims],
    taken: { ...x.taken, [v.id]: (x.taken[v.id] ?? 0) + 1 },
  }));
  return { ok: true, claim };
}

export const CODE_FORMAT = /^ZR-[A-Z0-9]{3,6}-[A-Z0-9]{4}$/;

export function redeemCode(address: string, raw: string): ClaimResult {
  const code = raw.trim().toUpperCase();
  if (!CODE_FORMAT.test(code)) return { ok: false, error: "Format kode: ZR-XXXX-XXXX." };
  const entry = REDEEM_CODES[code];
  if (!entry) return { ok: false, error: "Kode tidak ditemukan." };
  if (entry.expired) return { ok: false, error: "Kode kedaluwarsa." };
  if (read(address).usedCodes.includes(code)) return { ok: false, error: "Kode sudah dipakai." };
  const claim: Claim = {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind: "code",
    title: `Kode ${entry.label}`,
    points: entry.points,
    status: "selesai",
    tx: mockTx(),
  };
  update(address, (x) => ({ ...x, rp: x.rp + entry.points, claims: [claim, ...x.claims], usedCodes: [...x.usedCodes, code] }));
  return { ok: true, claim };
}

export const leaderClaimed = (w: WalletRewards, week: string) => !!w.leaderWeeks?.includes(week);

export function claimLeaderPrize(address: string, week: string, rank: number): ClaimResult {
  const tier = tierFor(rank);
  if (!tier) return { ok: false, error: `Peringkat #${rank} di luar top 10.` };
  if (leaderClaimed(read(address), week)) return { ok: false, error: "Hadiah minggu ini sudah diklaim." };
  const claim: Claim = {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind: "leaderboard",
    title: `Hadiah leaderboard #${rank} · minggu ${week}`,
    points: tier.rp,
    status: "selesai",
    tx: mockTx(),
  };
  update(address, (x) => ({ ...x, rp: x.rp + tier.rp, claims: [claim, ...x.claims], leaderWeeks: [...(x.leaderWeeks ?? []), week] }));
  return { ok: true, claim };
}

/** Cashier side, mocked: mark a voucher as used. */
export function markUsed(address: string, claimId: string) {
  update(address, (x) => ({ ...x, claims: x.claims.map((c) => (c.id === claimId ? { ...c, status: "selesai" } : c)) }));
}
