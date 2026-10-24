# Shardfall: fair-play battle royale on Monad

A 5-minute isometric battle royale for 3–10 players in the browser. Players buy a ticket in MON. The ticket money sits in a smart contract, not with the organizer. The map is locked on-chain before the match starts, and the top 3 are paid automatically by the contract the moment the match ends.

> Built at **Monad Blitz Jogja 2026** (24 Oct 2026).

| | |
|---|---|
| **Live app** | _TODO: Vercel URL_ |
| **Game server** | _TODO: Railway/Fly `wss://` URL_ |
| **Network** | Monad Testnet (chain ID `10143`) |
| **MatchEscrow** | _TODO: address_ ([explorer](https://testnet.monadvision.com/address/TODO)) |
| **SkinShop** | _TODO: address_ ([explorer](https://testnet.monadvision.com/address/TODO)) |

## The problem

- Prizes at community and campus game tournaments are held by the organizer. They often arrive late, get cut, or never arrive, and players can't check any of it.
- Players can't prove a game was fair. Loot positions, chest contents and the zone could all be rigged.

## How Shardfall uses Monad

Gameplay runs on a normal real-time server (20 ticks/s). The blockchain does only the three things it is good at:

1. **Holds the money.** Tickets go from each player's wallet straight into `MatchEscrow`. The server never touches player funds.
2. **Proves the map wasn't changed (commit-reveal).** When a match is created, the server commits `keccak256(seed)` on-chain *before anyone joins*. At the end it reveals the seed. The contract rejects settlement if the hash doesn't match. The results screen re-checks this against the chain and shows a **Verified** badge.
3. **Pays the winners automatically.** `settleMatch` sends 5% to the treasury and splits the rest 60/25/15 between the top 3, in one transaction.

One match = 3 kinds of on-chain transaction: `createMatch` (server) → `joinMatch` (each player, from their own wallet, live in the demo) → `settleMatch` (server). If a lobby never fills (fewer than 3 players after 2 min) or a match is never settled (15 min), each player can call `refund` and get their ticket back. Skins are cosmetic-only ERC-1155 tokens (`SkinShop`, 0.05 MON). There is no pay-to-win.

```
Browser (React + Three.js + wagmi) ──input──▶ Game server (Colyseus, authoritative sim)
        │  joinMatch (0.1 MON)                      │ createMatch(seedHash) / settleMatch(seed)
        ▼                                           ▼
                    MatchEscrow on Monad Testnet  ──▶ pays top 3
```

## Gameplay

Explore → clear monster camps → open chests → every item is worth coins (common 10, rare 25, epic 60) → at the end of each zone phase, anyone below the coin quota is eliminated → fight to be the last one standing. Players who die drop all their loot.

**Controls:** WASD move · LMB attack · RMB defend · Space parry · hold F open chest · tap F loot · 1–6 use/equip.

## Repository layout

```
contracts/   Solidity: MatchEscrow.sol, SkinShop.sol, Hardhat tests, deploy + verify scripts
server/      Colyseus game server: lobby, ticket checks, 20 Hz match, createMatch/settleMatch
fe/          React + Three.js client: lobby + wallet, game, HUD, results with on-chain proof
  src/shared/   config.ts (all game numbers), types.ts, generateMap.ts (shared with server)
  src/game/     sim.ts (match rules, run by the server and by offline practice), renderer, sprites
```

## Quick start: try it in 1 minute (no wallet)

```bash
cd fe
npm install
npm run dev
# open http://localhost:5173/?practice   (offline practice match against bots)
```

## Run the full on-chain version

Requirements: Node 20+, MetaMask, and test MON from <https://faucet.monad.xyz> for the deployer/operator wallet and each player wallet.

### 1. Deploy and verify the contracts

```bash
cd contracts
npm install
cp .env.example .env        # set PRIVATE_KEY (testnet-only wallet)
npm test                    # 9 tests: rejections, 10- and 4-player payouts, refunds, skins
npm run deploy              # prints addresses, saves deployments/monadTestnet.json
npm run verify              # verifies source on Sourcify → shown on MonadVision
```

By default the deployer is also the `operator` (the account the server uses) and the `treasury`. Set `OPERATOR` / `TREASURY` in `.env` to use different addresses.

### 2. Start the game server

```bash
cd server
npm install
cp .env.example .env        # OPERATOR_PRIVATE_KEY = operator key, ESCROW_ADDRESS = MatchEscrow address
npm start                   # ws://localhost:2567
```

### 3. Start the client

```bash
cd fe
npm install
cp .env.example .env        # VITE_SERVER_URL=ws://localhost:2567, VITE_ESCROW_ADDRESS, VITE_SKIN_SHOP_ADDRESS
npm run dev
```

Open the app in 4 browsers or profiles, each with a different funded wallet. Connect the wallet (the app switches to Monad Testnet), then click **Find match** and **Pay ticket · 0.1 MON**. The host clicks **Start** once 4+ players have paid. When the match ends, the results screen shows the payout, the **Verified** proof, and explorer links for the commit, ticket and settlement transactions.

Set `VITE_DEMO=true` (client) and `DEMO=true` (server) for a 90-second match with lower quotas, which is useful for a live pitch. Both sides must use the same value.

### Rehearse without testnet MON (optional)

```bash
cd contracts && npx hardhat node                                   # local chain, uses chain id 10143
npx hardhat run scripts/deploy.ts --network localhost              # in a second terminal
# server/.env: RPC_URL=http://127.0.0.1:8545, operator = Hardhat account #0 key
# fe/.env:     VITE_RPC_URL=http://127.0.0.1:8545, addresses from the deploy output
```

## Hosting

| Part | Where | Settings |
|---|---|---|
| Client | Vercel | Root directory `fe`, build `npm run build`, output `dist`, env `VITE_*` (`VITE_SERVER_URL` must be `wss://…`) |
| Server | Railway / Fly | Root directory = repo root (the server imports `fe/src/shared` and `fe/src/game/sim.ts`), build `npm ci --prefix server`, start `npm start --prefix server`, env from `server/.env.example` |

## Contract interface

```solidity
createMatch(bytes32 matchId, uint96 entryFee, uint8 maxPlayers, bytes32 seedHash)  // operator
joinMatch(bytes32 matchId) payable                                                 // players
settleMatch(bytes32 matchId, address[3] top3, bytes32 seed)                        // operator
refund(bytes32 matchId)                                                            // players, after timeout
isPlayer(bytes32, address) / playerCount(bytes32) / refundAvailable(bytes32) / matches(bytes32)
```

## Known trade-offs

The server is still trusted to report the correct ranking. The seed commit-reveal proves the map, loot table and zone path were fixed before the match. Making the results themselves verifiable (replayable inputs, multiple independent operators) is on the roadmap. All money in this demo is Monad Testnet MON with no real value.
