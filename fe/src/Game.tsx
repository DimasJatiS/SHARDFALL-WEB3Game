import { useEffect, useRef, useState } from "react";
import { loadGameAssets, type GameAssets } from "./game/assets";
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
  const [assets, setAssets] = useState<GameAssets | null>(null);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Assets are loaded once per page (the lobby starts this early), then reused every match.
  useEffect(() => {
    let live = true;
    loadGameAssets((done, total) => live && setProgress(done / total)).then(
      (a) => live && setAssets(a),
      (e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => { live = false; };
  }, [attempt]);

  useEffect(() => {
    if (!assets) return;
    const stage = stageRef.current!, overlay = overlayRef.current!;
    const renderer = new GameRenderer(stage, overlay, source.map, source.selfId, assets);
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
  }, [source, assets]);

  return (
    <div className="game">
      <div ref={stageRef} className="stage" />
      <div ref={overlayRef} className="world-overlay" />
      {!assets && (
        <div className="game-loading">
          {loadError ? (
            <>
              <p className="error">{loadError}</p>
              <button className="btn" onClick={() => { setLoadError(null); setAttempt((n) => n + 1); }}>Coba lagi</button>
            </>
          ) : (
            <>
              <b>Memuat aset…</b>
              <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            </>
          )}
        </div>
      )}
      {view && <Hud snap={view.snap} feed={view.feed} map={source.map} selfId={source.selfId} practice={source.practice} now={view.now} onUse={(i) => inputRef.current?.queueUse(i)} onLeave={onLeave} />}
    </div>
  );
}
