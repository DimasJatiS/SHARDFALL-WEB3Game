import "@nomicfoundation/hardhat-viem";
import "@nomicfoundation/hardhat-verify";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

const PRIVATE_KEY = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", metadata: { bytecodeHash: "ipfs" } },
  },
  networks: {
    // Local rehearsal chain that uses Monad's chain id so the server/client config is identical.
    hardhat: { chainId: 10143 },
    monadTestnet: {
      url: process.env.RPC_URL || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`] : [],
    },
  },
  // Monad Testnet verification goes through Sourcify (shown on MonadVision).
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://testnet.monadvision.com",
  },
  etherscan: { enabled: false },
};

export default config;
