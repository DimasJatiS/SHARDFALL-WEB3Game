import { useEffect, useRef, useState } from "react";
import { GameRenderer } from "./game/renderer";
import { InputController } from "./game/input";
import type { GameSource } from "./game/net";
import { GAME } from "./shared/config";
import type { GameEvent, MatchResult, Snapshot } from "./shared/types";
import Hud, { type FeedEntry } from "./ui/Hud";

interface Props {
  source: GameSource;
  onEnd: (r: MatchResult) => void;
  onLeave: () => void;
}

const HUD_HZ = 10;

export default function Game({ source, onEnd, onLeave }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputController | null>(null);
  const [view, setView] = useState<{ snap: Snapshot; feed: FeedEntry[]; now: number } | null>(null);
  const onEndRef = useRef(onEnd);
  useEffect(() => { onEndRef.current = onEnd; });

  useEffect(() => {
    const stage = stageRef.current!, overlay = overlayRef.current!;
    const renderer = new GameRenderer(stage, overlay, source.map, source.selfId);
    const input = new InputController(renderer.renderer.domElement);
    inputRef.current = input;
    let feed: FeedEntry[] = [];
    let feedId = 0;
    let raf = 0;
    let last = performance.now();
    let inputAcc = 0;
    let hudAcc = 0;

    const pushFeed = (evs: GameEvent[], snap: Snapshot) => {
      const name = (id?: string) => snap.players.find((p) => p.id === id)?.name ?? "?";
      for (const e of evs) {
        if (e.type === "kill") {
          const text =
            e.reason === "player" ? `${name(e.killer)} eliminated ${name(e.victim)}`
            : e.reason === "quota" ? `${name(e.victim)} missed the coin quota`
            : e.reason === "zone" ? `${name(e.victim)} was consumed by the zone`
            : e.reason === "trap" ? `${name(e.victim)} fell to a trap`
            : `${name(e.victim)} was slain by monsters`;
          feed.push({ id: feedId++, text, at: performance.now(), self: e.victim === source.selfId || e.killer === source.selfId, kind: e.reason });
        } else if (e.type === "phase") {
          feed.push({ id: feedId++, text: `Zone phase ${e.phase} begins`, at: performance.now(), kind: "phase", banner: e.phase });
        } else if (e.type === "quota" && e.eliminated.length) {
          feed.push({ id: feedId++, text: `Quota ${e.quota}: ${e.eliminated.length} eliminated`, at: performance.now(), kind: "quota" });
        }
      }
      const now = performance.now();
      feed = feed.filter((f) => now - f.at < 7000).slice(-6);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const snap = source.latest();
      const events = source.drainEvents();
      inputAcc += dt;
      if (inputAcc >= 1 / GAME.tickHz) {
        inputAcc %= 1 / GAME.tickHz;
        const aim = renderer.groundPoint(input.mouseX, input.mouseY, renderer.selfGroundY() + 0.5);
        source.sendInput(input.build(aim));
      }
      renderer.render(snap, events, dt);
      if (snap) {
        if (events.length) pushFeed(events, snap);
        hudAcc += dt;
        if (hudAcc >= 1 / HUD_HZ) {
          hudAcc = 0;
          // Copy so the HUD never sees objects mutated by the sim after render.
          setView({ snap: structuredClone({ ...snap, events: [] }), feed: [...feed], now });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const offEnd = source.onEnd((r) => onEndRef.current(r));

    return () => {
      cancelAnimationFrame(raf);
      offEnd();
      input.dispose();
      inputRef.current = null;
      renderer.dispose();
      overlay.replaceChildren();
    };
  }, [source]);

  return (
    <div className="game">
      <div ref={stageRef} className="stage" />
      <div ref={overlayRef} className="world-overlay" />
      {view && <Hud snap={view.snap} feed={view.feed} map={source.map} selfId={source.selfId} practice={source.practice} now={view.now} onUse={(i) => inputRef.current?.queueUse(i)} onLeave={onLeave} />}
    </div>
  );
}
