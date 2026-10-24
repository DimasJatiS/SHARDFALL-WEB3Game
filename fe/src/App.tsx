import { useState } from "react";
import Game from "./Game";
import type { GameSource } from "./game/net";
import type { MatchResult } from "./shared/types";
import Lobby from "./ui/Lobby";
import Results from "./ui/Results";

type Screen =
  | { name: "lobby" }
  | { name: "game"; source: GameSource; joinTx?: `0x${string}` }
  | { name: "results"; result: MatchResult; selfId: string; source: GameSource; joinTx?: `0x${string}` };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "lobby" });

  if (screen.name === "game") {
    const { source, joinTx } = screen;
    return <Game source={source} onEnd={(result) => setScreen({ name: "results", result, selfId: source.selfId, source, joinTx })} />;
  }

  if (screen.name === "results") {
    return (
      <Results
        result={screen.result}
        selfId={screen.selfId}
        source={screen.source}
        joinTx={screen.joinTx}
        onBack={() => { screen.source.dispose(); setScreen({ name: "lobby" }); }}
      />
    );
  }

  return <Lobby onStart={(source, joinTx) => setScreen({ name: "game", source, joinTx })} />;
}
