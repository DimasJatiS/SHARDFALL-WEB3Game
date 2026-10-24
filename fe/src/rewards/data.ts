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
