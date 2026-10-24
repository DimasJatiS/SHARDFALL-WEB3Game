// Copies the runtime part of ../assetv2 (the single source of truth) into public/assetv2.
// Runs before dev and build; source sheets, previews and scripts are never shipped.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fe = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(fe, "..", "assetv2");
const out = join(fe, "public", "assetv2");
const RUNTIME = ["manifest.json", "sprites", "icons", "world", "vfx", "ui"];

if (!existsSync(join(src, "manifest.json"))) {
  console.error(`sync-assets: ${src}/manifest.json tidak ditemukan`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
for (const entry of RUNTIME) cpSync(join(src, entry), join(out, entry), { recursive: true });
console.log(`sync-assets: ${RUNTIME.join(", ")} → public/assetv2`);
