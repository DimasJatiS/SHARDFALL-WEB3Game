import { useState } from "react";
import Game from "./Game";
import Landing from "./landing/Landing";
import type { GameSource } from "./game/net";
import type { MatchResult } from "./shared/types";
import Lobby from "./ui/Lobby";
import Results from "./ui/Results";

type Screen =
  | { name: "landing" }
  | { name: "lobby" }
  | { name: "game"; source: GameSource; joinTx?: `0x${string}` }
  | { name: "results"; result: MatchResult; selfId: string; source: GameSource; joinTx?: `0x${string}` };

export default function App() {
  // /?practice skips the landing page so the lobby's demo shortcut keeps working.
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(location.search).has("practice") ? { name: "lobby" } : { name: "landing" },
  );

  if (screen.name === "landing") {
    return <Landing onPlay={() => { window.scrollTo(0, 0); setScreen({ name: "lobby" }); }} />;
  }

  if (screen.name === "game") {
    const { source, joinTx } = screen;
    return (
      <Game
        source={source}
        onEnd={(result) => setScreen({ name: "results", result, selfId: source.selfId, source, joinTx })}
        onLeave={() => { source.leave(); setScreen({ name: "lobby" }); }}
      />
    );
  }

  if (screen.name === "results") {
    return (
      <Results
        result={screen.result}
        selfId={screen.selfId}
        source={screen.source}
        joinTx={screen.joinTx}
        onBack={() => { screen.source.leave(); setScreen({ name: "lobby" }); }}
      />
    );
  }

  return <Lobby onStart={(source, joinTx) => setScreen({ name: "game", source, joinTx })} />;
}
