import { createContext, useContext } from "react";

export interface SiteApi {
  /** Open the wallet onboarding; `forPlay` continues to the lobby once the wallet is ready. */
  openWallet(forPlay: boolean): void;
  /** Lobby if the wallet is ready to pay a ticket, otherwise the onboarding first. */
  join(): void;
  /** Lobby straight away (practice needs no wallet). */
  play(): void;
  toast(message: string): void;
}

export const SiteContext = createContext<SiteApi | null>(null);

export function useSite(): SiteApi {
  const api = useContext(SiteContext);
  if (!api) throw new Error("useSite must be used inside <SiteLayout>");
  return api;
}
