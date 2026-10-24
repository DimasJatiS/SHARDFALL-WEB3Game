// Deploy MatchEscrow + SkinShop to Monad Testnet and save the addresses.
//   npm run deploy
// Needs PRIVATE_KEY (deployer, funded from faucet.monad.xyz). OPERATOR / TREASURY default to the deployer.
import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { getAddress } from "viem";

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("Set PRIVATE_KEY in contracts/.env");
  const pub = await hre.viem.getPublicClient();
  const me = deployer.account.address;
  const operator = getAddress(process.env.OPERATOR || me);
  const treasury = getAddress(process.env.TREASURY || me);
  const balance = await pub.getBalance({ address: me });
  console.log(`Deployer ${me}  balance ${Number(balance) / 1e18} MON`);
  console.log(`Operator ${operator}\nTreasury ${treasury}`);

  const escrow = await hre.viem.deployContract("MatchEscrow", [operator, treasury]);
  console.log(`MatchEscrow  ${escrow.address}`);
  const skinUri = process.env.SKIN_URI || "";
  const shop = await hre.viem.deployContract("SkinShop", [treasury, skinUri]);
  console.log(`SkinShop     ${shop.address}`);

  const out = {
    network: hre.network.name,
    chainId: 10143,
    deployedAt: new Date().toISOString(),
    deployer: me,
    MatchEscrow: { address: escrow.address, args: [operator, treasury] },
    SkinShop: { address: shop.address, args: [treasury, skinUri] },
  };
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
  console.log(`\nfe/.env:\n  VITE_ESCROW_ADDRESS=${escrow.address}\n  VITE_SKIN_SHOP_ADDRESS=${shop.address}`);
  console.log(`server/.env:\n  ESCROW_ADDRESS=${escrow.address}`);
  console.log(`\nExplorer: https://testnet.monadvision.com/address/${escrow.address}`);
  console.log(`Next: npm run verify`);
}

main().catch((e) => { console.error(e); process.exit(1); });
