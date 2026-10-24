// Skin shop tab: real buySkin() on the SkinShop ERC-1155 (0.05 MON, cosmetic only).
// Ownership comes from balanceOf; the equipped skin is the same "sf.skin" key the lobby reads.

import { useState } from "react";
import { parseEther } from "viem";
import { usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { SKIN_SHOP, explorerTx, monadTestnet, skinShopAbi } from "../config";
import { PORTRAITS, portraitUrl } from "../landing/data";
import { GAME } from "../shared/config";
import { useSite } from "../site/context";
import { short, useWalletStatus } from "../site/wallet";

const PRICE = GAME.economy.skinPriceMon;
const PAID_IDS = [1, 2, 3] as const;
const label = (p: string) => p[0].toUpperCase() + p.slice(1);

const loadSkin = () => { try { return Number(localStorage.getItem("sf.skin") ?? "0"); } catch { return 0; } };
const saveSkin = (i: number) => { try { localStorage.setItem("sf.skin", String(i)); } catch { /* private mode */ } };

export default function SkinShop() {
  const site = useSite();
  const { address, isConnected, onChain, bal, refetch: refetchBal } = useWalletStatus();
  const [equipped, setEquipped] = useState(loadSkin);
  const [buying, setBuying] = useState<number | null>(null);

  const owned = useReadContracts({
    contracts: PAID_IDS.map((id) => ({
      address: SKIN_SHOP!, abi: skinShopAbi, functionName: "balanceOf" as const,
      args: [address!, BigInt(id)] as const, chainId: monadTestnet.id,
    })),
    query: { enabled: !!SKIN_SHOP && !!address },
  });
  const switchChain = useSwitchChain();
  const buy = useWriteContract();
  const client = usePublicClient({ chainId: monadTestnet.id });
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  // Without a SkinShop deployment every skin is a free preview.
  const isOwned = (i: number) => i === 0 || !SKIN_SHOP || (owned.data?.[i - 1]?.result ?? 0n) > 0n;
  const busy = buying !== null;

  const purchase = async (i: number) => {
    if (!isConnected) {
      site.toast("Connect wallet dulu untuk membeli skin.");
      return site.openWallet(false);
    }
    setBuying(i);
    setConfirmed(null);
    buy.reset();
    switchChain.reset();
    try {
      if (!onChain) await switchChain.mutateAsync({ chainId: monadTestnet.id });
      const hash = await buy.mutateAsync({
        address: SKIN_SHOP!, abi: skinShopAbi, functionName: "buySkin",
        args: [BigInt(i)], value: parseEther(PRICE), chainId: monadTestnet.id,
      });
      const r = await client!.waitForTransactionReceipt({ hash });
      setConfirmed(r.status === "success");
      if (r.status === "success") site.toast(`Skin ${label(PORTRAITS[i])} sudah jadi milikmu`);
      void owned.refetch();
      void refetchBal();
    } catch {
      // Rejected in the wallet or reverted: the error shows under the grid.
    } finally {
      setBuying(null);
    }
  };

  const equip = (i: number) => {
    saveSkin(i);
    setEquipped(i);
    site.toast(`${label(PORTRAITS[i])} dipakai di match berikutnya`);
  };

  const error = buy.error ?? switchChain.error;
  const lowBalance = bal !== undefined && bal < parseEther(PRICE);

  return (
    <>
      <div className="lp-head-row rw-head">
        <h2>Skin shop</h2>
        <span className="lp-dim">ERC-1155 · {PRICE.replace(".", ",")} MON per skin · kosmetik saja, tidak mengubah stat</span>
      </div>
      {!SKIN_SHOP && <p className="lp-note">SkinShop belum dideploy (<code>VITE_SKIN_SHOP_ADDRESS</code> kosong): semua skin tersedia sebagai preview.</p>}

      <div className="rw-grid">
        {PORTRAITS.map((p, i) => {
          const mine = isOwned(i);
          const pending = buying === i;
          return (
            <article key={p} className={`rw-card rw-skin${equipped === i ? " on" : ""}`}>
              <div className="rw-card-art skin"><img src={portraitUrl(i)} alt="" /></div>
              <span className="rw-sponsor">[{i === 0 ? "Default" : `Skin #${i}`}]</span>
              <h3>{label(p)}</h3>
              <p className="lp-dim">
                {equipped === i ? "Sedang dipakai" : mine ? "Dimiliki" : isConnected && owned.isLoading ? "Mengecek kepemilikan…" : `${PRICE.replace(".", ",")} MON`}
              </p>
              {mine ? (
                <button className="lp-btn block" disabled={equipped === i} onClick={() => equip(i)}>
                  {equipped === i ? "✓ Dipakai" : "Pakai"}
                </button>
              ) : (
                <button className="lp-btn primary block" disabled={busy} onClick={() => purchase(i)}>
                  {pending
                    ? switchChain.isPending ? "Switch jaringan…" : buy.isPending ? "Setujui di wallet…" : "Menunggu konfirmasi…"
                    : `Beli · ${PRICE.replace(".", ",")} MON`}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <div aria-live="polite">
        {buy.data && (
          <p className="lp-note">
            Tx skin <a href={explorerTx(buy.data)} target="_blank" rel="noreferrer" className="mono">{short(buy.data)}</a>
            {confirmed === true ? " ✓ terkonfirmasi" : confirmed === false ? " ✗ gagal (revert)" : " · menunggu konfirmasi"}
          </p>
        )}
        {error && <p className="lp-error">{error.message.split("\n")[0]}</p>}
        {isConnected && lowBalance && <p className="lp-note">Saldo MON kurang dari {PRICE.replace(".", ",")} MON. Ambil MON testnet di faucet dulu.</p>}
      </div>
    </>
  );
}
