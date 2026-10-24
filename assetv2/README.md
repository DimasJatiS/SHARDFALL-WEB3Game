# Shardfall assetv2 (tema cyberpunk)

Aset hasil generate di Figma (file **ASSET MONAD**, page **10 Shardfall Cyberpunk**), dipotong otomatis oleh `scripts/slice_sheet.py` ke format **WebP**. Semua path, ukuran, pivot, dan animasi tercatat di `manifest.json`, jadi kode cukup membaca satu file itu.

## Struktur

```
assetv2/
├── manifest.json            ← daftar semua aset (path, ukuran, pivot, animasi)
├── sprites/                 satu file per frame, latar transparan
│   ├── raider/
│   │   ├── unarmed/         idle_01.webp, idle_02.webp, walk_01..04, attack_01..03, cast_01..02,
│   │   ├── sword/           defend_01, stun_01, dead_01, hit_01, victory_01  (16 file, 64x64)
│   │   ├── staff/
│   │   └── bow/
│   ├── skins/               knight | ember | verdant | void  (64x64, acuan palette swap)
│   └── enemies/
│       ├── crawler/         idle_01..02, move_01..04, windup_01, attack_01, recover_01, stun_01, hit_01, dead_01 (64x64)
│       ├── enforcer/        nama frame sama dengan crawler (96x96)
│       └── titan/           idle_01..02, walk_01..03, windup_01, slam_01, recover_01, stun_01, dead_01 (192x192)
├── icons/
│   ├── items/               sword staff bow armor heal speed maxhp invuln coin  (32x32 + @2x 64x64)
│   ├── buffs/               immune swift double_hit stunned  (32 + @2x)
│   └── steps/               loot quota fight paid  (32 + @2x, panduan lobby)
├── world/
│   ├── tiles/               grass dirt stone sand water side_soil side_metal side_concrete  (32 seamless + @2x)
│   ├── props/               barrel barrel_damaged (64) | tree_a tree_b pylon (64x96)
│   ├── traps/               spike_off spike_on lava_pool  (64)
│   └── chests/              chest_wood chest_iron (64) | chest_boss (96)  + *_open
├── vfx/                     slash hit cast_ring staff_impact parry stun slam chest_burst
│                            explosion zone_wall loot_beam immune_bubble  (128, latar transparan)
├── ui/
│   ├── logo.webp            transparan | logo_dark.webp (latar navy)
│   ├── key_art.webp         1536x864
│   ├── lobby_bg.webp        1376x768, tengah sengaja gelap untuk kartu UI
│   └── portraits/           knight | ember | verdant | void  (128x128, kartu Your Raider)
├── source/                  sheet PNG asli dari Figma (input skrip)
├── scripts/slice_sheet.py
└── preview/                 contact_sheet.png + report.txt
```

Nama ikon dan VFX sama dengan file lama di `fe/public/assets/` (`heal`, `speed`, `maxhp`, `invuln`, `coin`, `sword`, `bow`, `slash`, `explosion`, `lava_pool`), hanya ekstensinya `.webp`.

## Pakai di kode

Salin `assetv2/` ke `fe/public/assetv2/`, lalu:

```ts
const manifest = await fetch('/assetv2/manifest.json').then(r => r.json());

// Animasi karakter: daftar file per animasi sudah ada di manifest
const raider = manifest.sprites.raider_sword;      // { dir, frameWidth, frameHeight, pivot, anims }
const walk = raider.anims.walk;                     // { frames: ['sprites/raider/sword/walk_01.webp', ...], fps, loop }
const loader = new THREE.TextureLoader();
const textures = await Promise.all(walk.frames.map(f => loader.loadAsync('/assetv2/' + f)));
textures.forEach(t => { t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; });

// tiap tick: material.map = textures[Math.floor(time * walk.fps) % textures.length]
// material: new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.5 })

// Ikon HUD
<img src={'/assetv2/' + manifest.images.icons.items.heal.file} style={{ imageRendering: 'pixelated' }} />
```

Atau langsung pakai path-nya tanpa manifest: `/assetv2/sprites/raider/sword/attack_02.webp`.

| Sprite | Ukuran frame, pivot | Animasi |
| --- | --- | --- |
| `raider/<senjata>/` | 64x64, (32, 60) | idle 2, walk 4, attack 3, cast 2, defend 1, stun 1, dead 1, hit 1, victory 1 |
| `enemies/crawler/` | 64x64, (32, 60) | idle 2, move 4, windup, attack, recover, stun, hit, dead |
| `enemies/enforcer/` | 96x96, (48, 92) | sama dengan crawler |
| `enemies/titan/` | 192x192, (96, 186) | idle 2, walk 3, windup (telegraph slam), slam, recover, stun, dead |

Semua sprite, ikon, prop, chest, trap, VFX, portrait, dan `logo.webp` berlatar **transparan**. Yang sengaja tidak transparan: tile (tekstur penuh), `key_art`, `lobby_bg`, dan `logo_dark`.

- **Skin:** `sprites/skins/*` dan `ui/portraits/*` adalah acuan warna. Frame `raider/*` digambar dengan palet Knight (helm `#c9d3e0`, bayangan helm `#7d8aa0`, plume `#f2c94c`, tunik `#3a5bd9`, bayangan tunik `#24398f`, jubah `#c23b3b`, celana `#4a3a2e`, kulit `#e0ac7e`), jadi palette swap tetap jalan. Warna hasil potongan sudah dikuantisasi, jadi cocokkan dengan toleransi kecil, bukan exact match.
- **Varian minion per camp:** pakai frame `crawler` dan beri tint atau hue shift di material (hijau, teal, ungu, oranye).
- **VFX:** latar sudah transparan, jadi bisa pakai blending normal. `THREE.AdditiveBlending` membuatnya lebih menyala.
- **Tile:** 32x32 seamless untuk sisi atas voxel, `@2x` kalau butuh lebih tajam. Pakai `RepeatWrapping` + `NearestFilter`.
- **Bingkai rarity:** dari kode (Common `#9aa3ad`, Rare `#4aa3ff`, Epic `#b06bff`), tidak digambar di ikon.

## Menjalankan ulang

```
pip install pillow numpy scipy
python scripts/slice_sheet.py
```

Kalau satu sheet di-generate ulang di Figma, ekspor dengan nama yang sama ke `source/`, jalankan lagi, lalu cek `preview/contact_sheet.png` dan `preview/report.txt` (baris `PERIKSA` atau `TIDAK TERDETEKSI` berarti jumlah objek di sheet tidak cocok dengan daftar nama di `SHEETS`).

## Catatan

- Di `raider/bow/`, frame `stun_01` dan `hit_01` tidak memegang busur. Tidak terlalu terlihat saat main; kalau perlu, tempel busur dari frame idle.
- Di frame serang dan victory, ujung senjata bisa terpotong di tepi frame 64 px. Ini disengaja: posisi kaki dikunci di tengah supaya badan tidak bergeser antar frame.
- Asap di frame dead ikut terhapus bersama latar abu-abu; tambahkan dengan partikel di kode.
- Musuh dan chest di prototype sekarang masih voxel 3D procedural. Sprite ini siap kalau tim memutuskan pindah ke billboard 2D; kalau tetap voxel, pakai sebagai acuan warna.
