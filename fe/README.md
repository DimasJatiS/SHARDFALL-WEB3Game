# SHARDFALL — frontend

Isometric battle royale for Monad Blitz Jogja Vol. 2. Vite + React + Three.js + wagmi.

```bash
npm install
cp .env.example .env   # fill in addresses / server URL
npm run dev            # http://localhost:5173
```

- `/?practice` jumps straight into an offline practice match (`&bots=3..9`, `&seed=123`).
- `VITE_DEMO=true` makes zones faster and quotas lower so a pitch demo ends in ~90 s.

## Modes

| Mode | Needs | What happens |
| --- | --- | --- |
| Practice | nothing | The full match simulation runs in the browser against bots. Payouts are simulated. |
| Ranked | `VITE_SERVER_URL`, `VITE_ESCROW_ADDRESS`, wallet on Monad Testnet | Join the Colyseus room, pay `joinMatch` (0.1 MON), host starts with 4+ paid players, server settles on-chain. |

## Layout

```text
src/
  shared/        Shared with the game server: config.ts (all tuning numbers), types.ts
                 (data contract), generateMap.ts (deterministic map from seed), rng.ts
  game/
    sim.ts       Authoritative match simulation (combat, chests, loot, zone, quota, ranking)
                 + practice bots. The server can run this same class.
    net.ts       GameSource interface: LocalSource (practice) and RemoteSource (Colyseus).
                 The server protocol is documented at the top of this file.
    renderer.ts  Three.js: ortho iso camera, instanced voxel terrain, billboard sprites,
                 voxel enemies, VFX, bloom + tilt-shift
    sprites.ts   Procedural pixel-art player sheets (4 palette skins) and item icons
    creatures.ts Voxel monsters from ellipsoid math
    input.ts     WASD (rotated 45°) + mouse → InputMsg
  ui/            Lobby (wallet, skins, ranked room, practice), Hud, Minimap, Results
  Game.tsx       Game screen: owns renderer + input loop, feeds the HUD
  config.ts      Contract addresses, ABIs, explorer links
  wagmi.ts       wagmi config (Monad Testnet, injected wallet)
```

## Controls

WASD move · LMB attack · RMB (or Shift) defend · Space parry · hold F open chest · tap F loot · 1–6 use/equip bag slot
