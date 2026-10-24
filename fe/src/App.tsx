import { AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import Game from "./Game";
import type { GameSource } from "./game/net";
import Landing from "./landing/Landing";
import Rewards from "./rewards/Rewards";
import type { MatchResult } from "./shared/types";
import SiteLayout from "./site/SiteLayout";
import { navigate, useRoute } from "./site/router";
import Lobby from "./ui/Lobby";
import Results from "./ui/Results";

type PlayScreen =
  | { name: "lobby" }
  | { name: "game"; source: GameSource; joinTx?: `0x${string}` }
  | { name: "results"; result: MatchResult; source: GameSource; joinTx?: `0x${string}` };

const goPlay = () => navigate("play");

export default function App() {
  const route = useRoute();
  if (route === "play") return <PlayArea />;
  return (
    <SiteLayout route={route} onPlay={goPlay}>
      {route === "rewards" ? <Rewards /> : <Landing />}
    </SiteLayout>
  );
}

/** #/play: lobby → match → results. Results overlay the frozen match instead of replacing it. */
function PlayArea() {
  const [screen, setScreen] = useState<PlayScreen>({ name: "lobby" });
  const active = useRef<GameSource | null>(null);

  // Leaving #/play mid-match (back button, navbar) must not leave a live room behind.
  useEffect(() => () => {
    active.current?.leave();
    active.current = null;
  }, []);

  const toLobby = (source: GameSource) => {
    if (active.current === source) {
      source.leave();
      active.current = null;
    }
    setScreen({ name: "lobby" });
  };

  if (screen.name === "lobby") {
    return (
      <Lobby
        onStart={(source, joinTx) => {
          active.current = source;
          setScreen({ name: "game", source, joinTx });
        }}
      />
    );
  }

  const { source, joinTx } = screen;
  return (
    <>
      <Game
        source={source}
        onEnd={(result) => setScreen({ name: "results", result, source, joinTx })}
        onLeave={() => toLobby(source)}
      />
      <AnimatePresence>
        {screen.name === "results" && (
          <Results
            result={screen.result}
            selfId={source.selfId}
            source={source}
            joinTx={joinTx}
            onBack={() => toLobby(source)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
