// Verify the deployed contracts on Sourcify (shown as verified on MonadVision).
//   npm run verify
import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

async function main() {
  const file = path.join(__dirname, "..", "deployments", "monadTestnet.json");
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const name of ["MatchEscrow", "SkinShop"] as const) {
    const { address, args } = d[name];
    console.log(`Verifying ${name} at ${address}…`);
    try {
      await hre.run("verify:verify", { address, constructorArguments: args });
    } catch (e) {
      console.error(`  ${name}: ${e instanceof Error ? e.message : e}`);
    }
    console.log(`  https://testnet.monadvision.com/address/${address}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
