import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowsLeftRight, CaretDown, Drop, SignOut, Wallet } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance as useEthBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain, deployments, IS_LOCAL } from "../config/env";
import { useBalance, useToken, type TokenMeta } from "../hooks/data";
import { useTx } from "../hooks/useTx";
import { erc20Abi } from "../abi";
import { fmt, fmtAmount, shortAddr } from "../lib/format";
import { DEMO_CONNECTOR_TYPE, demoConnectorId, demoWallets } from "../wallet/demo";
import { Badge, Button, CopyButton, cx } from "./ui";

function TokenRow({ token, owner }: { token: TokenMeta; owner: `0x${string}` }) {
  const bal = useBalance(token.address, owner);
  const { send, busy } = useTx();
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="num text-[13px] text-ink">
          {bal.data === undefined ? "…" : fmtAmount(bal.data, token.decimals)} <span className="text-ink-3">{token.symbol}</span>
        </div>
      </div>
      {token.faucetAmount > 0n && (
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() =>
            send({
              label: `Faucet: ${fmtAmount(token.faucetAmount, token.decimals)} ${token.symbol}`,
              address: token.address,
              abi: erc20Abi,
              functionName: "faucet",
              args: [],
              success: `Minted ${fmtAmount(token.faucetAmount, token.decimals)} test ${token.symbol}.`,
            })
          }
        >
          <Drop size={14} /> Faucet
        </Button>
      )}
    </div>
  );
}

export function Balances({ owner }: { owner: `0x${string}` }) {
  const usdc = useToken(deployments.usdc).token;
  const weth = useToken(deployments.weth).token;
  const clnch = useToken(deployments.clnch).token;
  const eth = useEthBalance({ address: owner });
  return (
    <div>
      <div className="flex items-center justify-between py-1.5">
        <div className="num text-[13px] text-ink">
          {eth.data ? fmt(Number(eth.data.value) / 1e18, { max: 4 }) : "…"} <span className="text-ink-3">ETH</span>
        </div>
        <span className="text-[12px] text-ink-3">gas</span>
      </div>
      {[usdc, weth, clnch].filter(Boolean).map((t) => (
        <TokenRow key={t!.address} token={t!} owner={owner} />
      ))}
    </div>
  );
}

/** Deterministic two-tone disc from the address, so the connected wallet is recognisable at a glance. */
function AddressAvatar({ address }: { address: string }) {
  const h1 = parseInt(address.slice(2, 6), 16) % 360;
  const h2 = parseInt(address.slice(-4), 16) % 360;
  return (
    <span
      aria-hidden
      className="inline-block size-9 shrink-0 rounded-full ring-1 ring-inset ring-line-strong"
      style={{ background: `conic-gradient(from ${h1}deg, oklch(0.7 0.11 ${h1}), oklch(0.5 0.09 ${h2}), oklch(0.7 0.11 ${h1}))` }}
    />
  );
}

export function WalletMenu() {
  const reduced = useReducedMotion();
  const { address, connector, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { openChainModal } = useChainModal();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isDemo = connector?.type === DEMO_CONNECTOR_TYPE;
  const demoIdx = isDemo ? demoWallets.find((w) => w.address === address)?.index : undefined;
  const hasDemo = IS_LOCAL && demoWallets.length > 0;
  const wrongChain = isConnected && chainId !== chain.id;

  /** Browser and mobile wallets go through RainbowKit's modal. */
  const chooseWallet = async () => {
    setErr(null);
    setOpen(false);
    if (isConnected) await disconnectAsync();
    openConnectModal?.();
  };

  const connectDemo = async (index: number) => {
    setErr(null);
    const c = connectors.find((x) => x.id === demoConnectorId(index));
    if (!c) return;
    try {
      if (isConnected) await disconnectAsync();
      await connectAsync({ connector: c, chainId: chain.id });
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  };

  const switchNetwork = async () => {
    setErr(null);
    try {
      await switchChainAsync({ chainId: chain.id });
    } catch (e) {
      // the wallet may not know this chain or refuse the request; RainbowKit's chain modal explains it
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
      openChainModal?.();
    }
  };

  // Not connected and no demo wallets to offer: the button opens RainbowKit straight away.
  const onButton = () => {
    if (!isConnected && !hasDemo) return chooseWallet();
    setOpen((o) => !o);
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant={isConnected ? "secondary" : "primary"}
        onClick={onButton}
        loading={!isConnected && (isPending || connectModalOpen)}
        aria-expanded={isConnected || hasDemo ? open : undefined}
        aria-haspopup={isConnected || hasDemo ? "dialog" : undefined}
        className="h-9"
      >
        <Wallet size={16} />
        {isConnected ? (
          <span className="num text-[13px]">{isDemo && demoIdx !== undefined ? `Demo #${demoIdx}` : shortAddr(address)}</span>
        ) : (
          <span className="text-[13px]">Connect</span>
        )}
        {wrongChain && (
          <Badge tone="warn" className="h-5 px-1.5">
            wrong network
          </Badge>
        )}
        {(isConnected || hasDemo) && <CaretDown size={12} />}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Wallet"
            initial={reduced ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 z-40 mt-2 w-[min(92vw,372px)] rounded-[20px] border border-line-strong bg-surface p-4 shadow-[0_24px_64px_-24px_rgb(0_0_0/0.65)]"
          >
            {isConnected && address && (
              <div className="rounded-2xl bg-surface-2 p-3.5 ring-1 ring-inset ring-line">
                <div className="flex items-center justify-between gap-2">
                  <AddressAvatar address={address} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-ink-3">{isDemo ? "Demo wallet (local chain only)" : connector?.name}</div>
                    <div className="num flex items-center gap-1 text-[13px] text-ink">
                      {shortAddr(address)} <CopyButton value={address} label="Copy address" />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await disconnectAsync();
                      setOpen(false);
                    }}
                    aria-label="Disconnect"
                  >
                    <SignOut size={14} /> Disconnect
                  </Button>
                </div>
                {wrongChain ? (
                  <div className="mt-3 rounded-xl bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn">
                    Your wallet is on another network. Clinch runs on {chain.name}.
                    <Button size="sm" variant="primary" className="mt-2 w-full" loading={switching} onClick={switchNetwork}>
                      Switch to {chain.name}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2">
                    <Balances owner={address} />
                  </div>
                )}
              </div>
            )}

            <Button variant="secondary" className={cx("w-full justify-center", isConnected && "mt-3")} onClick={chooseWallet}>
              {isConnected ? (
                <>
                  <ArrowsLeftRight size={15} /> Switch wallet
                </>
              ) : (
                <>
                  <Wallet size={15} /> Connect a wallet
                </>
              )}
            </Button>

            {hasDemo && (
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <div className="text-[12px] font-medium text-ink-3">Demo wallets</div>
                  <div className="text-[11.5px] text-ink-3">local anvil only, public test keys</div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {demoWallets.map((w) => {
                    const active = isDemo && demoIdx === w.index;
                    return (
                      <button
                        key={w.index}
                        type="button"
                        disabled={isPending}
                        onClick={() => connectDemo(w.index)}
                        aria-pressed={active}
                        className={cx(
                          "rounded-xl border px-3 py-2.5 text-left transition-colors duration-200",
                          active ? "border-accent-line bg-accent-soft" : "border-line hover:border-line-strong hover:bg-surface-2",
                        )}
                      >
                        <div className="text-[12.5px] font-medium text-ink">
                          #{w.index} <span className="font-normal text-ink-3">{w.label}</span>
                        </div>
                        <div className="num text-[11.5px] text-ink-3">{shortAddr(w.address)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {err && <p className="mt-3 text-[12.5px] text-bad">{err}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
