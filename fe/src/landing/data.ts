// Static content + mock data for the landing page. Swap the mocks for
// server / contract reads once the indexer is live.

export const asset = (p: string) => `/assetv2/${p}`;

export const PORTRAITS = ["knight", "ember", "verdant", "void"] as const;
export const portraitUrl = (skin: number) => asset(`ui/portraits/${PORTRAITS[skin % PORTRAITS.length]}.webp`);

/** Mock: Raider Points of the connected wallet (Fase 1, casual mode). */
export const MOCK_RP = 320;

export interface OpenMatch {
  id: string;
  players: number;
  max: number;
  status: "lobby" | "countdown" | "playing";
  /** seconds: lobby countdown, or time elapsed while playing */
  clock?: number;
}

export const OPEN_MATCHES: OpenMatch[] = [
  { id: "0x7a3f…c21", players: 6, max: 10, status: "lobby" },
  { id: "0x19be…d4d", players: 2, max: 10, status: "countdown", clock: 102 },
  { id: "0xd0c4…9e8", players: 10, max: 10, status: "playing", clock: 192 },
];

export interface LeaderRow {
  name: string;
  address: string;
  skin: number;
  matches: number;
  wins: number;
  top3: number;
  bestCoins: number;
  earned: number; // MON
}

export const LEADERBOARD: Record<"week" | "all", LeaderRow[]> = {
  week: [
    { name: "Nyx", address: "0x4f2a…b7e1", skin: 3, matches: 41, wins: 9, top3: 22, bestCoins: 412, earned: 3.42 },
    { name: "Kael", address: "0x91cd…03fa", skin: 0, matches: 37, wins: 7, top3: 18, bestCoins: 388, earned: 2.81 },
    { name: "Mira", address: "0x0b77…e5c2", skin: 2, matches: 44, wins: 6, top3: 19, bestCoins: 365, earned: 2.47 },
    { name: "Vex", address: "0xa3e0…11d9", skin: 1, matches: 29, wins: 5, top3: 12, bestCoins: 341, earned: 1.86 },
    { name: "Juno", address: "0x6c18…9a4b", skin: 0, matches: 33, wins: 4, top3: 13, bestCoins: 318, earned: 1.62 },
    { name: "Bram", address: "0xee52…7c30", skin: 1, matches: 26, wins: 3, top3: 10, bestCoins: 296, earned: 1.18 },
    { name: "Sela", address: "0x2d9f…4410", skin: 2, matches: 31, wins: 3, top3: 9, bestCoins: 287, earned: 1.04 },
    { name: "Tobi", address: "0x88a1…c6f2", skin: 3, matches: 22, wins: 2, top3: 7, bestCoins: 270, earned: 0.79 },
  ],
  all: [
    { name: "Kael", address: "0x91cd…03fa", skin: 0, matches: 212, wins: 38, top3: 97, bestCoins: 451, earned: 16.3 },
    { name: "Nyx", address: "0x4f2a…b7e1", skin: 3, matches: 188, wins: 35, top3: 90, bestCoins: 412, earned: 14.9 },
    { name: "Odo", address: "0x5b03…aa18", skin: 1, matches: 240, wins: 29, top3: 101, bestCoins: 398, earned: 13.2 },
    { name: "Mira", address: "0x0b77…e5c2", skin: 2, matches: 173, wins: 24, top3: 76, bestCoins: 365, earned: 10.7 },
    { name: "Rusty", address: "0x7e44…2b9c", skin: 0, matches: 151, wins: 19, top3: 61, bestCoins: 349, earned: 8.45 },
    { name: "Vex", address: "0xa3e0…11d9", skin: 1, matches: 120, wins: 17, top3: 52, bestCoins: 341, earned: 7.6 },
    { name: "Juno", address: "0x6c18…9a4b", skin: 0, matches: 134, wins: 14, top3: 49, bestCoins: 318, earned: 6.12 },
    { name: "Sela", address: "0x2d9f…4410", skin: 2, matches: 98, wins: 11, top3: 38, bestCoins: 287, earned: 4.9 },
  ],
};

export const SPONSORS = [
  { tag: "Kopi", title: "Diskon 20% kedai kopi", rp: 250, img: "icons/items/heal@2x.webp" },
  { tag: "Makanan", title: "Gratis 1 camilan", rp: 300, img: "icons/items/maxhp@2x.webp" },
  { tag: "Gadget", title: "Potongan Rp50rb", rp: 500, img: "icons/items/invuln@2x.webp" },
];

export const STEPS = [
  { icon: "icons/steps/paid@2x.webp", title: "Connect Wallet", body: "Pilih wallet, otomatis pindah ke Monad Testnet (chain 10143)." },
  { icon: "icons/items/coin@2x.webp", title: "Join 0,1 MON", body: "Tiket masuk ke smart contract, bukan ke server. Tunggu konfirmasi, lalu masuk lobby." },
  { icon: "icons/steps/loot@2x.webp", title: "Loot = skor", body: "Kalahkan penjaga, buka chest. Coin = total nilai item di 8 slot." },
  { icon: "icons/steps/quota@2x.webp", title: "Lolos kuota zona", body: "Tiap fase ada kuota coin. Di bawah kuota saat fase habis = tereliminasi." },
  { icon: "icons/steps/fight@2x.webp", title: "Top 3 dibayar", body: "Contract membayar 60/25/15 otomatis. Cek sendiri di explorer." },
];

export const CONTROLS: { keys: string[]; label: string }[] = [
  { keys: ["WASD"], label: "Gerak" },
  { keys: ["Mouse"], label: "Bidik" },
  { keys: ["Klik kiri"], label: "Attack · cooldown 0,4 dtk" },
  { keys: ["Klik kanan"], label: "Tahan untuk defend · damage depan −70%" },
  { keys: ["Spasi"], label: "Parry · jendela 0,2 dtk, lawan stun 1 dtk" },
  { keys: ["1", "6"], label: "Pakai item dari tas" },
  { keys: ["Tahan F"], label: "Buka chest / ambil loot (1,5 dtk)" },
];

export const ROADMAP = [
  { tag: "Sekarang", title: "MVP Testnet", body: "Escrow, seed adil, payout top 3." },
  { tag: "Fase 1", title: "Pilot sponsor Jogja", body: "Mode gratis, Raider Points, voucher." },
  { tag: "Fase 2", title: "Mainnet & season", body: "Level akun, achievement, kosmetik." },
  { tag: "Fase 3", title: "Turnamen B2B", body: "Kampus, komunitas, brand." },
  { tag: "Fase 4", title: "SDK Fair Match", body: "Escrow + seed adil untuk game lain." },
];

export const FAQ = [
  {
    q: "Ini judi?",
    a: "Bukan. Hasil ditentukan skill: loot, bertahan di zona, dan bertarung. Tidak ada elemen acak yang bisa dibeli, dan seed map dikunci sebelum siapa pun join. Saat hackathon semua berjalan di testnet dengan MON gratis.",
  },
  {
    q: "Apa server masih bisa curang?",
    a: "Server tidak memegang uang. Tiket ada di contract MatchEscrow, seed map di-commit (hash) sebelum join lalu dibuka saat settle, jadi siapa pun bisa mencocokkan map dan hasilnya di explorer.",
  },
  {
    q: "Wallet apa yang bisa dipakai?",
    a: "Wallet browser apa pun yang mendukung jaringan EVM: MetaMask, Rabby, OKX, dan sejenisnya. Login Google + wallet otomatis sedang disiapkan.",
  },
  {
    q: "Di mana dapat MON testnet?",
    a: "Gratis dari faucet.monad.xyz. Satu tiket + gas butuh sekitar 0,101 MON.",
  },
  {
    q: "Kalau match batal?",
    a: "Kalau kurang dari 4 pemain saat timer lobby habis, match batal dan tombol Refund muncul. Tiket kembali utuh dari contract.",
  },
];
