import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { monadTestnet, RPC_URL } from "./config";

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: { [monadTestnet.id]: http(RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
