import "dotenv/config";
import http from "node:http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./MatchRoom";
import { checkOperator } from "./chain";

const PORT = Number(process.env.PORT || 2567);

// Plain HTTP health check for hosting platforms (Railway/Fly).
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ ok: true, game: "shardfall" }));
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("match", MatchRoom);

await checkOperator().catch((e) => console.error("[chain] operator check failed:", e.message));
await gameServer.listen(PORT);
console.log(`Shardfall server on ws://localhost:${PORT}`);
