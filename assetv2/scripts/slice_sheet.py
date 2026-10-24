"""
slice_sheet.py - pipeline aset Shardfall (tema cyberpunk)

Memotong sheet hasil Figma (page "10 Shardfall Cyberpunk" di file ASSET MONAD)
menjadi aset siap pakai berformat WebP, lalu menulis manifest.json untuk kode.

    assetv2/
      source/            sheet PNG asli dari Figma (input)
      sprites/           satu file per frame: karakter, skin, musuh
      icons/             ikon item (32 px + @2x 64 px), buff, panduan lobby
      world/             tile 32 px, prop, trap, chest
      vfx/               efek, latar transparan
      ui/                logo, key art, background lobby, portrait skin
      manifest.json      path, ukuran, pivot, dan animasi semua aset
      preview/           contact_sheet.png + report.txt untuk cek cepat

Pemakaian (dari folder assetv2):
    pip install pillow numpy scipy
    python scripts/slice_sheet.py
    python scripts/slice_sheet.py --src source --out .      (default)

Kalau satu sheet di-generate ulang di Figma, ekspor dengan nama yang sama ke
source/ lalu jalankan lagi. Nama file per objek diatur di daftar SHEETS.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageDraw

try:
    from scipy import ndimage
except ImportError:  # pragma: no cover
    sys.exit("Butuh scipy: pip install scipy")


# --------------------------------------------------------------------------
# Animasi (urutan frame di strip) - indeks 0..13 sesuai PRD Shardfall
# --------------------------------------------------------------------------
RAIDER_ANIMS = {
    "idle": (0, 1, 4, True), "walk": (2, 5, 10, True), "attack": (6, 8, 14, False),
    "cast": (9, 10, 8, False), "defend": (11, 11, 1, False), "stun": (12, 12, 1, False),
    "dead": (13, 13, 1, False), "hit": (14, 14, 1, False), "victory": (15, 15, 1, False),
}
RAIDER_FRAMES = [
    ["idle_01", "idle_02", "walk_01", "walk_02"],
    ["walk_03", "walk_04", "attack_01", "attack_02"],
    ["attack_03", "cast_01", "cast_02", "defend_01"],
    ["stun_01", "dead_01", "hit_01", "victory_01"],
]
MOB_ANIMS = {
    "idle": (0, 1, 4, True), "move": (2, 5, 10, True), "windup": (6, 6, 1, False),
    "attack": (7, 7, 1, False), "recover": (8, 8, 1, False), "stun": (9, 9, 1, False),
    "hit": (10, 10, 1, False), "dead": (11, 11, 1, False),
}
MOB_FRAMES = [
    ["idle_01", "idle_02", "move_01", "move_02"],
    ["move_03", "move_04", "windup_01", "attack_01"],
    ["recover_01", "stun_01", "hit_01", "dead_01"],
]
BOSS_ANIMS = {
    "idle": (0, 1, 3, True), "walk": (2, 4, 6, True), "windup": (5, 5, 1, False),
    "slam": (6, 6, 1, False), "recover": (7, 7, 1, False), "stun": (8, 8, 1, False),
    "dead": (9, 9, 1, False),
}
BOSS_FRAMES = [
    ["idle_01", "idle_02", "walk_01", "walk_02"],
    ["walk_03", "windup_01", "slam_01"],
    ["recover_01", "stun_01", "dead_01"],
]

# --------------------------------------------------------------------------
# Spesifikasi sheet
#   mode "strip"  : semua objek jadi satu strip animasi (skala dikunci)
#   mode "single" : satu file per objek
# Spesifikasi objek (spec):
#   kind actor  -> kanvas size, tinggi badan target_h, kaki di pivot (x dari kaki, y = pivot_y)
#   kind fit    -> objek dimuat di box, align "center" atau "bottom" (dasar di pivot_y)
#   kind vfx    -> latar hitam dipertahankan
#   kind tile   -> tekstur dipotong persegi lalu diperkecil
# --------------------------------------------------------------------------
RAIDER = dict(kind="actor", size=(64, 64), target_h=50, pivot_y=60)
ICON = dict(kind="fit", size=(32, 32), box=(30, 30), align="center", hd=64)
BADGE = dict(kind="fit", size=(32, 32), box=(30, 30), align="center", hd=64)
VFX = dict(kind="vfx", size=(128, 128), box=(124, 124))

SHEETS = [
    # ---- karakter: keempat senjata memakai skala yang sama (grup "raider")
    *[{
        "file": f"sf_raider_{w}.png", "bg": "gray", "rows": 4, "cols": 4,
        "mode": "strip", "out": f"sprites/raider/{w}", "key": f"raider_{w}",
        "scale_group": "raider", "spec": RAIDER, "names": RAIDER_FRAMES, "anims": RAIDER_ANIMS,
    } for w in ("unarmed", "sword", "staff", "bow")],
    {
        "file": "sf_raider_skins.png", "bg": "gray", "rows": 2, "cols": 4, "mode": "single",
        "names": [["sprites/skins/knight", "sprites/skins/ember", "sprites/skins/verdant", "sprites/skins/void"],
                  ["ui/portraits/knight", "ui/portraits/ember", "ui/portraits/verdant", "ui/portraits/void"]],
        "spec": RAIDER,
        "row_spec": {1: dict(kind="fit", size=(128, 128), box=(120, 124), align="bottom", pivot_y=126)},
    },
    # ---- musuh
    {
        "file": "sf_enemy_crawler.png", "bg": "gray", "rows": 3, "cols": 4, "mode": "strip",
        "out": "sprites/enemies/crawler", "key": "crawler",
        "spec": dict(kind="actor", size=(64, 64), target_h=34, pivot_y=60),
        "names": MOB_FRAMES, "anims": MOB_ANIMS,
    },
    {
        "file": "sf_enemy_enforcer.png", "bg": "gray", "rows": 3, "cols": 4, "mode": "strip",
        "out": "sprites/enemies/enforcer", "key": "enforcer", "bg_tol": 64,
        "spec": dict(kind="actor", size=(96, 96), target_h=74, pivot_y=92),
        "names": MOB_FRAMES, "anims": MOB_ANIMS,
    },
    {
        "file": "sf_boss_titan.png", "bg": "gray", "rows": 3, "cols": 4, "mode": "strip",
        "out": "sprites/enemies/titan", "key": "titan",
        "spec": dict(kind="actor", size=(192, 192), target_h=150, pivot_y=186),
        "names": BOSS_FRAMES, "anims": BOSS_ANIMS,
    },
    # ---- ikon (nama sama dengan fe/public/assets/icons agar bisa langsung ganti)
    {
        "file": "sf_icons_items.png", "bg": "gray", "rows": 3, "cols": 3, "mode": "single",
        "names": [["icons/items/sword", "icons/items/staff", "icons/items/bow"],
                  ["icons/items/armor", "icons/items/heal", "icons/items/speed"],
                  ["icons/items/maxhp", "icons/items/invuln", "icons/items/coin"]],
        "spec": ICON,
    },
    {
        "file": "sf_icons_ui.png", "bg": "gray", "rows": 2, "cols": 4, "mode": "single",
        "names": [["icons/buffs/immune", "icons/buffs/swift", "icons/buffs/double_hit", "icons/buffs/stunned"],
                  ["icons/steps/loot", "icons/steps/quota", "icons/steps/fight", "icons/steps/paid"]],
        "spec": BADGE,
    },
    # ---- dunia
    {
        "file": "sf_chests.png", "bg": "gray", "rows": 2, "cols": 3, "mode": "single",
        "names": [["world/chests/chest_wood", "world/chests/chest_iron", "world/chests/chest_boss"],
                  ["world/chests/chest_wood_open", "world/chests/chest_iron_open", "world/chests/chest_boss_open"]],
        "spec": dict(kind="fit", size=(64, 64), box=(58, 58), align="bottom", pivot_y=62),
        "overrides": {
            "world/chests/chest_boss": dict(kind="fit", size=(96, 96), box=(90, 90), align="bottom", pivot_y=94),
            "world/chests/chest_boss_open": dict(kind="fit", size=(96, 96), box=(90, 90), align="bottom", pivot_y=94),
        },
        # tertutup dan terbuka satu tier memakai skala yang sama
        "shared_scale": [["world/chests/chest_wood", "world/chests/chest_wood_open"],
                         ["world/chests/chest_iron", "world/chests/chest_iron_open"],
                         ["world/chests/chest_boss", "world/chests/chest_boss_open"]],
    },
    {
        "file": "sf_props_traps.png", "bg": "gray", "rows": 2, "cols": 4, "mode": "single",
        "names": [["world/traps/spike_off", "world/traps/spike_on", "world/traps/lava_pool", "world/props/barrel"],
                  ["world/props/barrel_damaged", "world/props/tree_a", "world/props/tree_b", "world/props/pylon"]],
        "spec": dict(kind="fit", size=(64, 64), box=(62, 62), align="center"),
        "overrides": {
            "world/props/barrel": dict(kind="fit", size=(64, 64), box=(44, 58), align="bottom", pivot_y=62),
            "world/props/barrel_damaged": dict(kind="fit", size=(64, 64), box=(44, 58), align="bottom", pivot_y=62),
            "world/props/tree_a": dict(kind="fit", size=(64, 96), box=(62, 92), align="bottom", pivot_y=94),
            "world/props/tree_b": dict(kind="fit", size=(64, 96), box=(62, 92), align="bottom", pivot_y=94),
            "world/props/pylon": dict(kind="fit", size=(64, 96), box=(40, 92), align="bottom", pivot_y=94),
        },
        "shared_scale": [["world/traps/spike_off", "world/traps/spike_on"],
                         ["world/props/barrel", "world/props/barrel_damaged"]],
    },
    {
        "file": "sf_tiles.png", "bg": "gray", "rows": 2, "cols": 4, "mode": "single", "bg_tol": 20,
        "names": [["world/tiles/grass", "world/tiles/dirt", "world/tiles/stone", "world/tiles/sand"],
                  ["world/tiles/water", "world/tiles/side_soil", "world/tiles/side_metal", "world/tiles/side_concrete"]],
        "spec": dict(kind="tile", size=(32, 32), hd=64),
    },
    {
        "file": "sf_vfx.png", "bg": "black", "rows": 3, "cols": 4, "mode": "single",
        "names": [["vfx/slash", "vfx/hit", "vfx/cast_ring", "vfx/staff_impact"],
                  ["vfx/parry", "vfx/stun", "vfx/slam", "vfx/chest_burst"],
                  ["vfx/explosion", "vfx/zone_wall", "vfx/loot_beam", "vfx/immune_bubble"]],
        "spec": VFX,
    },
]

# Gambar utuh: (file sumber, file output, opsi)
FULL_IMAGES = [
    ("sf_key_art.png", "ui/key_art.webp", dict(quality=88)),
    ("sf_lobby_bg.png", "ui/lobby_bg.webp", dict(quality=88)),
    ("sf_logo.png", "ui/logo_dark.webp", dict(quality=92, crop_logo=True)),
    ("sf_logo.png", "ui/logo.webp", dict(lossless=True, crop_logo=True, key_out_bg=True)),
]


# --------------------------------------------------------------------------
# Deteksi objek dan penghapusan latar
# --------------------------------------------------------------------------
def to_np(img):
    return np.asarray(img.convert("RGB")).astype(np.int16)


def border_ref(arr):
    border = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    return np.median(border, axis=0)


def candidate_bg(arr, ref, bg, tol=48):
    """Piksel yang mirip latar: warna latar, atau bayangan abu-abu tanpa saturasi."""
    if bg == "black":
        return arr.max(axis=2) < 28
    dist = np.abs(arr - ref).sum(axis=2)
    sat = arr.max(axis=2) - arr.min(axis=2)
    lum = arr.mean(axis=2)
    return (dist < tol) | ((sat < 16) & (np.abs(lum - float(np.mean(ref))) < 55))


def remove_background(crop, bg, tol=48):
    """Latar = piksel mirip latar yang terhubung ke tepi crop, plus celah terkurung."""
    arr = to_np(crop)
    ref = border_ref(arr)
    cand = candidate_bg(arr, ref, bg, tol)
    lab, _ = ndimage.label(cand)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bgmask = np.isin(lab, edge[edge > 0])
    if bg != "black":
        lum = arr.mean(axis=2)
        sat = arr.max(axis=2) - arr.min(axis=2)
        ref_lum = float(np.mean(ref))
        strict = (np.abs(arr - ref).sum(axis=2) < 30) | ((sat < 10) & (lum < ref_lum - 8) & (lum > ref_lum - 50))
        slab, sn = ndimage.label(strict & ~bgmask)
        if sn:
            sizes = ndimage.sum(np.ones_like(slab), slab, index=range(1, sn + 1))
            bgmask |= np.isin(slab, [i + 1 for i, a in enumerate(sizes) if a >= 40])
    rgba = np.dstack([np.asarray(crop.convert("RGB")), np.where(bgmask, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def detect_objects(img, sh):
    """Kembalikan list per baris berisi bbox objek, urut kiri ke kanan.

    Baris ditentukan dari titik tengah objek (rows sama rata). Serpihan kecil
    (percikan, bintang stun, asap) digabung ke objek besar terdekat di baris yang sama.
    """
    rows, cols, bg = sh["rows"], sh["cols"], sh["bg"]
    tol = sh.get("bg_tol", 48)
    arr = to_np(img)
    h, w = arr.shape[:2]
    ch, cw = h / rows, w / cols
    fg = np.zeros((h, w), bool)
    for r in range(rows):  # latar dihitung per sel: nada abu-abu bisa beda per sel
        for c in range(cols):
            y0, y1, x0, x1 = int(r * ch), int((r + 1) * ch), int(c * cw), int((c + 1) * cw)
            cell = arr[y0:y1, x0:x1]
            fg[y0:y1, x0:x1] = ~candidate_bg(cell, border_ref(cell), bg, tol)
    fg = ndimage.binary_opening(fg, iterations=1)
    dil = ndimage.binary_dilation(fg, iterations=4)
    for r in range(1, rows):  # putus di batas baris agar kaki baris atas tidak menempel ke baris bawah
        yb = int(r * ch)
        dil[yb - 1:yb + 1] = False
    lab, _ = ndimage.label(dil)
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        ys, xs = sl
        area = int((lab[sl] == i).sum())
        if area < 120:
            continue
        comps.append(dict(box=[xs.start, ys.start, xs.stop, ys.stop], area=area,
                          cx=(xs.start + xs.stop) / 2, cy=(ys.start + ys.stop) / 2))
    if not comps:
        return [[] for _ in range(rows)]
    big_area = max(c["area"] for c in comps)
    bigs = [c for c in comps if c["area"] >= 0.12 * big_area]
    smalls = [c for c in comps if c["area"] < 0.12 * big_area]
    for s in smalls:
        def box_gap(b, sb=s["box"]):
            return max(0, b[0] - sb[2], sb[0] - b[2]) + max(0, b[1] - sb[3], sb[1] - b[3])
        t = min(bigs, key=lambda b: box_gap(b["box"]))
        b = t["box"]
        gap_x = max(0, b[0] - s["box"][2], s["box"][0] - b[2])
        gap_y = max(0, b[1] - s["box"][3], s["box"][1] - b[3])
        if gap_x > cw * 0.12 or gap_y > ch * 0.08:
            continue  # terlalu jauh dari objek mana pun (sisa bayangan sel lain): abaikan
        b = t["box"]
        t["box"] = [min(b[0], s["box"][0]), min(b[1], s["box"][1]), max(b[2], s["box"][2]), max(b[3], s["box"][3])]
    out = [[] for _ in range(rows)]
    for b in bigs:
        out[min(int(b["cy"] // ch), rows - 1)].append(b)
    return [[b["box"] for b in sorted(r, key=lambda b: b["cx"])] for r in out]


# --------------------------------------------------------------------------
# Proses ke ukuran game
# --------------------------------------------------------------------------
def tight(img):
    bbox = img.getchannel("A").getbbox()
    return img.crop(bbox) if bbox else img


def quantize(img, colors=32):
    """Kunci warna (tanpa dither) dan alpha biner supaya pixel art tetap tajam."""
    alpha = img.getchannel("A").point(lambda a: 255 if a > 110 else 0)
    q = img.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = q.convert("RGBA")
    out.putalpha(alpha)
    return out


def foot_x(obj):
    """Titik tengah kaki = tengah piksel tak-transparan di 20% bawah objek."""
    a = np.asarray(obj.getchannel("A")) > 0
    h = a.shape[0]
    xs = np.nonzero(a[int(h * 0.8):].any(axis=0))[0]
    return float(xs.mean()) if len(xs) else obj.width / 2


def fit_scale(obj, spec):
    return min(spec["box"][0] / obj.width, spec["box"][1] / obj.height)


def render(obj, spec, scale):
    W, H = spec["size"]
    kind = spec["kind"]
    w, h = max(1, round(obj.width * scale)), max(1, round(obj.height * scale))
    small = obj.resize((w, h), Image.BOX)
    if kind == "vfx":
        # latar hitam -> transparan: alpha = kecerahan, warna di-unpremultiply
        rgb = np.asarray(small.convert("RGB")).astype(np.float32)
        a = rgb.max(axis=2)
        a = np.where(a < 20, 0, a)  # buang noise hitam
        col = np.where(a[..., None] > 0, rgb * 255.0 / np.maximum(a, 1)[..., None], 0)
        rgba = np.dstack([np.clip(col, 0, 255), a]).astype(np.uint8)
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(Image.fromarray(rgba, "RGBA"), ((W - w) // 2, (H - h) // 2))
        return canvas
    small = quantize(small)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if kind == "actor":
        x = round(W / 2 - foot_x(obj) * scale)  # kaki di tengah, senjata boleh terpotong tepi
        y = spec["pivot_y"] - h
    elif spec.get("align") == "bottom":
        x, y = (W - w) // 2, spec["pivot_y"] - h
    else:
        x, y = (W - w) // 2, (H - h) // 2
    canvas.alpha_composite(small, (x, y)) if 0 <= x and x + w <= W and 0 <= y and y + h <= H else paste_clipped(canvas, small, x, y)
    return canvas


def paste_clipped(canvas, img, x, y):
    W, H = canvas.size
    sx0, sy0 = max(0, -x), max(0, -y)
    sx1, sy1 = min(img.width, W - x), min(img.height, H - y)
    if sx1 > sx0 and sy1 > sy0:
        canvas.alpha_composite(img.crop((sx0, sy0, sx1, sy1)), (max(0, x), max(0, y)))


def save_webp(img, path, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if kw.get("lossless", True) and "quality" not in kw:
        img.save(path, "WEBP", lossless=True, quality=100, method=6, exact=True)
    else:
        img.save(path, "WEBP", quality=kw.get("quality", 90), method=6)


# --------------------------------------------------------------------------
def cut_objects(img, sh, report):
    """Kembalikan dict nama -> cutout RGBA (resolusi sumber)."""
    rows = detect_objects(img, sh)
    cuts = {}
    for r, names in enumerate(sh["names"]):
        found = rows[r] if r < len(rows) else []
        if len(found) != len([n for n in names if n]):
            report.append(f"PERIKSA: {sh['file']} baris {r + 1}: {len(found)} objek terdeteksi, "
                          f"{len(names)} nama diharapkan")
        for c, name in enumerate(names):
            if not name or c >= len(found):
                if name:
                    report.append(f"TIDAK TERDETEKSI: {name} ({sh['file']} baris {r + 1} posisi {c + 1})")
                continue
            x0, y0, x1, y1 = found[c]
            if sh["mode"] == "strip":  # strip animasi: jangan ambil apa pun dari baris tetangga
                band = img.height / sh["rows"]
                y0, y1 = max(y0, int(r * band) + 7), min(y1, int((r + 1) * band) - 7)
            pad = 6
            crop = img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))
            if sh["bg"] == "black":
                cuts[name] = crop.convert("RGB")
            elif sh["spec"]["kind"] == "tile":
                cuts[name] = crop
            else:
                cuts[name] = tight(remove_background(crop, sh["bg"], sh.get("bg_tol", 48)))
    return cuts


def tile_texture(crop, size, tol=20):
    """Ambil bagian dalam kotak tekstur (buang tepi latar dan garis batas), lalu perkecil."""
    arr = to_np(crop)
    ref = border_ref(arr)
    mask = np.abs(arr - ref).sum(axis=2) >= tol
    mask = ndimage.binary_opening(mask, iterations=2)
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    side = min(x1 - x0, y1 - y0)
    inset = int(side * 0.03)
    box = (x0 + inset, y0 + inset, x0 + side - inset, y0 + side - inset)
    tex = crop.convert("RGB").crop(box)
    small = tex.resize(size, Image.BOX)
    return small.quantize(colors=16, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")


def process(src, out, report):
    manifest = {"version": 1, "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "note": "Path relatif ke folder assetv2. Pixel art: pakai NearestFilter / image-rendering: pixelated.",
                "sprites": {}, "images": {}}
    previews = []
    group_scale = {}
    for sh in SHEETS:
        path = os.path.join(src, sh["file"])
        if not os.path.exists(path):
            report.append(f"LEWATI (tidak ada): {sh['file']}")
            continue
        img = Image.open(path).convert("RGBA")
        cuts = cut_objects(img, sh, report)
        spec0 = sh["spec"]

        if sh["mode"] == "strip":
            order = [n for row in sh["names"] for n in row]
            first = cuts.get(order[0])
            grp = sh.get("scale_group")
            if grp and grp in group_scale:
                scale = group_scale[grp]
            else:
                scale = spec0["target_h"] / first.height
                if grp:
                    group_scale[grp] = scale
            W, H = spec0["size"]
            paths = []
            for n in order:  # satu file per frame, latar transparan
                rel = f"{sh['out']}/{n}.webp"
                if n in cuts:
                    save_webp(render(cuts[n], spec0, scale), os.path.join(out, rel))
                paths.append(rel)
            anims = {k: {"frames": paths[a:b + 1], "fps": fps, "loop": loop}
                     for k, (a, b, fps, loop) in sh["anims"].items()}
            manifest["sprites"][sh["key"]] = {
                "dir": sh["out"], "frameWidth": W, "frameHeight": H,
                "pivot": [W // 2, spec0["pivot_y"]], "anims": anims}
            previews.extend((f"{sh['key']}/{n}", os.path.join(out, p)) for n, p in zip(order, paths))
            report.append(f"FRAMES {sh['out']}/  {len(order)} file {W}x{H}, skala {scale:.3f}")
            continue

        # mode single
        shared = {}
        for group in sh.get("shared_scale", []):
            specs = [dict(spec0, **sh.get("overrides", {}).get(n, {})) for n in group]
            s = min(fit_scale(cuts[n], sp) for n, sp in zip(group, specs) if n in cuts)
            for n in group:
                shared[n] = s
        for r, names in enumerate(sh["names"]):
            for name in names:
                if name not in cuts:
                    continue
                spec = dict(spec0)
                spec.update(sh.get("row_spec", {}).get(r, {}))
                spec.update(sh.get("overrides", {}).get(name, {}))
                key = name.split("/")[-1]
                section = name.split("/")[0]
                entry = {}
                if spec["kind"] == "tile":
                    small = tile_texture(cuts[name], spec["size"])
                    save_webp(small, os.path.join(out, name + ".webp"))
                    if spec.get("hd"):
                        save_webp(tile_texture(cuts[name], (spec["hd"], spec["hd"])), os.path.join(out, name + "@2x.webp"))
                        entry["hd"] = name + "@2x.webp"
                else:
                    if spec["kind"] == "actor":
                        scale = group_scale.get(spec.get("scale_group")) or spec["target_h"] / cuts[name].height
                    else:
                        scale = shared.get(name) or fit_scale(cuts[name], spec)
                    frame = render(cuts[name], spec, scale)
                    save_webp(frame, os.path.join(out, name + ".webp"))
                    if spec.get("hd"):
                        hd = dict(spec, size=(spec["hd"], spec["hd"]),
                                  box=tuple(int(v * spec["hd"] / spec["size"][0]) for v in spec["box"]))
                        save_webp(render(cuts[name], hd, fit_scale(cuts[name], hd)), os.path.join(out, name + "@2x.webp"))
                        entry["hd"] = name + "@2x.webp"
                    if spec["kind"] == "actor" or spec.get("align") == "bottom":
                        entry["pivot"] = [spec["size"][0] // 2, spec["pivot_y"]]
                entry.update({"file": name + ".webp", "width": spec["size"][0], "height": spec["size"][1]})
                if spec["kind"] == "vfx":
                    entry["blend"] = "additive (opsional; latar sudah transparan)"
                parts = name.split("/")
                bucket = manifest["images"].setdefault(section, {})
                if len(parts) == 3:  # contoh icons/items/sword -> images.icons.items.sword
                    bucket = bucket.setdefault(parts[1], {})
                bucket[key] = entry
                previews.append((name, os.path.join(out, name + ".webp")))
                report.append(f"OK  {name}.webp  {spec['size'][0]}x{spec['size'][1]}")

    for fname, oname, opt in FULL_IMAGES:
        path = os.path.join(src, fname)
        if not os.path.exists(path):
            report.append(f"LEWATI (tidak ada): {fname}")
            continue
        img = Image.open(path).convert("RGBA")
        if opt.get("crop_logo"):
            arr = to_np(img)
            fg = ~candidate_bg(arr, border_ref(arr), "gray", 40)
            fg = ndimage.binary_opening(fg, iterations=2)
            ys, xs = np.nonzero(fg)
            pad = 24
            img = img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad),
                            min(img.width, xs.max() + pad), min(img.height, ys.max() + pad)))
        if opt.get("key_out_bg"):
            img = remove_background(img, "gray", 36)
        else:
            img = img.convert("RGB")
        save_webp(img, os.path.join(out, oname), **{k: v for k, v in opt.items() if k in ("quality", "lossless")})
        key = os.path.splitext(os.path.basename(oname))[0]
        manifest["images"].setdefault("ui", {}).setdefault("brand", {})[key] = {
            "file": oname, "width": img.width, "height": img.height}
        report.append(f"OK  {oname}  {img.width}x{img.height}")

    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    return previews


def contact_sheet(previews, out):
    cell, cols = 150, 12
    tiles = []
    for name, path in previews:
        im = Image.open(path).convert("RGBA")
        if im.width > im.height * 3:  # strip: tampilkan 4 frame pertama
            fw = im.height
            im = im.crop((0, 0, min(im.width, fw * 4), im.height))
        tiles.append((name, im))
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * (cell + 22)), (24, 28, 40, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(tiles):
        k = max(1, int(min((cell - 16) / im.width, (cell - 16) / im.height)))
        if im.width * k > cell - 16 or im.height * k > cell - 16:
            k = min((cell - 16) / im.width, (cell - 16) / im.height)
        big = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.NEAREST)
        x = (i % cols) * cell + (cell - big.width) // 2
        y = (i // cols) * (cell + 22) + (cell - big.height) // 2
        for cy in range(0, big.height, 8):  # papan catur: area transparan terlihat jelas
            for cx in range(0, big.width, 8):
                c = (70, 76, 92, 255) if (cx // 8 + cy // 8) % 2 else (52, 58, 74, 255)
                sheet.paste(c, (x + cx, y + cy, x + min(cx + 8, big.width), y + min(cy + 8, big.height)))
        sheet.alpha_composite(big, (x, y))
        draw.text(((i % cols) * cell + 6, (i // cols) * (cell + 22) + cell + 4), name[-34:], fill=(220, 226, 236, 255))
    os.makedirs(os.path.join(out, "preview"), exist_ok=True)
    sheet.save(os.path.join(out, "preview", "contact_sheet.png"))


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(here, "source"))
    ap.add_argument("--out", default=here)
    a = ap.parse_args()
    report = []
    previews = process(a.src, a.out, report)
    contact_sheet(previews, a.out)
    with open(os.path.join(a.out, "preview", "report.txt"), "w") as fh:
        fh.write("\n".join(report) + "\n")
    print("\n".join(report))
    print(f"\nSelesai: {len(previews)} aset. Cek preview/contact_sheet.png dan manifest.json")


if __name__ == "__main__":
    main()
