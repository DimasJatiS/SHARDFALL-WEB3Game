// Sample casual-mode catalogue (lofi 04). Sponsors are placeholders until deals are signed.

export const STARTING_RP = 320;

export interface Voucher {
  id: string;
  sponsor: string;
  title: string;
  cost: number;
  stock: number;
  /** ISO date */
  until: string;
  /** asset path under /assetv2 */
  art: string;
  kind: "sponsor" | "skin";
  /** prefix of the code shown to the cashier */
  prefix: string;
}

export const VOUCHERS: Voucher[] = [
  { id: "kopi", sponsor: "Kedai kopi", title: "Diskon 20% kedai kopi", cost: 250, stock: 40, until: "2026-11-30", art: "icons/items/heal@2x.webp", kind: "sponsor", prefix: "KOPI" },
  { id: "makan", sponsor: "Makanan", title: "Gratis 1 camilan", cost: 300, stock: 25, until: "2026-11-15", art: "icons/items/maxhp@2x.webp", kind: "sponsor", prefix: "MKN" },
  { id: "gadget", sponsor: "Gadget", title: "Potongan Rp50.000", cost: 500, stock: 10, until: "2026-12-31", art: "icons/items/invuln@2x.webp", kind: "sponsor", prefix: "GDT" },
  { id: "skin-void", sponsor: "SHARDFALL", title: "Skin season Void", cost: 200, stock: 100, until: "2026-12-31", art: "ui/portraits/void.webp", kind: "skin", prefix: "SKIN" },
  { id: "merch", sponsor: "Monad Jogja", title: "Stiker + gantungan kunci", cost: 150, stock: 0, until: "2026-11-01", art: "icons/steps/quota@2x.webp", kind: "sponsor", prefix: "MRC" },
  { id: "pulsa", sponsor: "Operator", title: "Pulsa Rp10.000", cost: 400, stock: 30, until: "2026-11-20", art: "icons/items/coin@2x.webp", kind: "sponsor", prefix: "PLS" },
];

export const EARN = [
  { icon: "icons/steps/fight@2x.webp", title: "Selesaikan match", rp: 20 },
  { icon: "icons/steps/paid@2x.webp", title: "Masuk top 3", rp: 50 },
  { icon: "icons/steps/loot@2x.webp", title: "Misi harian", rp: 30 },
];

/** Demo codes. Real codes will be checked by the backend / registry contract. */
export const REDEEM_CODES: Record<string, { points: number; label: string; expired?: boolean }> = {
  "ZR-JOGJA-2026": { points: 100, label: "event ZR-JOGJA" },
  "ZR-UGM-BLTZ": { points: 75, label: "turnamen kampus" },
  "ZR-MONAD-0001": { points: 150, label: "sponsor Monad" },
  "ZR-OLD-2025": { points: 50, label: "event lama", expired: true },
};

export const DEMO_CODE = "ZR-JOGJA-2026";

/** Weekly leaderboard prizes in Raider Points, by final rank of the week. */
export const LEADER_TIERS = [
  { from: 1, to: 1, rp: 500, extra: "Badge Champion" },
  { from: 2, to: 2, rp: 300, extra: "Badge Runner-up" },
  { from: 3, to: 3, rp: 200, extra: "Badge Podium" },
  { from: 4, to: 10, rp: 100 },
] as const;

export const tierFor = (rank: number) => LEADER_TIERS.find((t) => rank >= t.from && rank <= t.to);

/** The week resets Monday 00:00 WIB (UTC+7). Week id = that Monday's date, e.g. "2026-10-19". */
const WIB = 7 * 3600e3;
export function weekStart(now = Date.now()) {
  const local = new Date(now + WIB);
  const day = (local.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day) - WIB;
}
export const weekId = (start: number) => new Date(start + WIB).toISOString().slice(0, 10);
export const WEEK_MS = 7 * 24 * 3600e3;

/**
 * Demo stand-in for "your rank last week" until ranks are read from MatchSettled events:
 * a stable rank 1–15 per wallet and week, so every wallet can try the claim flow.
 */
export function demoRank(address: string, week: string) {
  let h = 2166136261;
  for (const c of address.toLowerCase() + week) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 15) + 1;
}
