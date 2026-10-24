import { useEffect, useMemo, useRef } from "react";
import { TILE } from "../shared/generateMap";
import type { MapData, Snapshot } from "../shared/types";

const SIZE = 168;
const COLORS: Record<number, [number, number, number]> = {
  [TILE.GRASS]: [95, 168, 74],
  [TILE.DIRT]: [154, 116, 72],
  [TILE.STONE]: [138, 143, 152],
  [TILE.SAND]: [216, 196, 138],
  [TILE.WATER]: [30, 70, 110],
};

export default function Minimap({ map, snap, selfId }: { map: MapData; snap: Snapshot; selfId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  // Terrain is static: render once per map.
  const base = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = map.size;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(map.size, map.size);
    for (let i = 0; i < map.size * map.size; i++) {
      const [r, g, b] = COLORS[map.type[i]] ?? COLORS[TILE.GRASS];
      const shade = map.type[i] === TILE.WATER ? 1 : 0.85 + map.height[i] * 0.07;
      img.data.set([r * shade, g * shade, b * shade, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }, [map]);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const k = SIZE / map.size;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(base, 0, 0, SIZE, SIZE);
    const z = snap.zone;

    // Darken outside the zone.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.arc(z.cx * k, z.cz * k, Math.max(0, z.r * k), 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(30, 70, 190, 0.45)";
    ctx.fill("evenodd");
    ctx.restore();
    ctx.strokeStyle = "#5ab0ff";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(z.cx * k, z.cz * k, Math.max(0, z.r * k), 0, Math.PI * 2); ctx.stroke();
    if (z.next.r > 0) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(z.next.cx * k, z.next.cz * k, z.next.r * k, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const c of snap.chests) {
      if (c.opened) continue;
      ctx.fillStyle = c.tier === "boss" ? "#e8c547" : c.tier === "iron" ? "#c9d1d9" : "#b07a3a";
      const s = c.tier === "boss" ? 6 : 4;
      ctx.fillRect(c.x * k - s / 2, c.z * k - s / 2, s, s);
      if (!c.locked) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(c.x * k - s / 2 - 1, c.z * k - s / 2 - 1, s + 2, s + 2); }
    }
    for (const l of snap.loot) {
      ctx.fillStyle = l.bag ? "#ff8a5a" : "#b06bff";
      ctx.beginPath(); ctx.arc(l.x * k, l.z * k, 2, 0, Math.PI * 2); ctx.fill();
    }
    const me = snap.players.find((p) => p.id === selfId);
    if (me) {
      ctx.save();
      ctx.translate(me.x * k, me.z * k);
      ctx.rotate(me.face);
      ctx.fillStyle = me.alive ? "#ffffff" : "#888";
      ctx.strokeStyle = "#1a1420";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 4); ctx.lineTo(-2, 0); ctx.lineTo(-4, -4); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }, [snap, base, map.size, selfId]);

  // The camera looks along (-1,-1,-1): rotate the map so "up" matches the screen.
  return (
    <div className="minimap">
      <canvas ref={ref} width={SIZE} height={SIZE} style={{ transform: "rotate(45deg) scale(0.72)" }} />
    </div>
  );
}
