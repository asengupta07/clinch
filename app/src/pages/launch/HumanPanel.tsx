import { IdentificationBadge } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { maxUint256, type Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { erc20Abi, humanGateAbi } from "../../abi";
import { Badge, Button, Field, Notice, NumberInput } from "../../components/ui";
import { useToasts } from "../../components/Toasts";
import { deployments } from "../../config/env";
import { useAllowance, useBalance, type TokenMeta } from "../../hooks/data";
import { useTx } from "../../hooks/useTx";
import { fmtAmount } from "../../lib/format";
import { parseDecimal } from "../../lib/units";
import type { Attestation, WorldConfig } from "./WorldVerify";

const WorldVerify = lazy(() => import("./WorldVerify"));

/** True when this launch sells for the World ID gate's voucher token. */
export function isHumanGated(quote: Address | undefined): boolean {
  return !!quote && !!deployments.humanGate && quote.toLowerCase() === deployments.humanGate.toLowerCase();
}

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export function HumanPanel({ underlying, voucher }: { underlying: TokenMeta; voucher: TokenMeta }) {
  const gate = deployments.humanGate!;
  const { address } = useAccount();
  const toasts = useToasts();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const verifyTx = useTx();
  const depositTx = useTx();
  const redeemTx = useTx();

  const world = useQuery({
    queryKey: ["world-config"],
    queryFn: async (): Promise<WorldConfig | null> => {
      const r = await fetch("/api/world/config");
      if (!r.ok) return null;
      const c = (await r.json()) as WorldConfig & { enabled: boolean };
      return c.enabled ? c : null;
    },
    staleTime: Infinity,
    retry: false,
  });

  const reads = useReadContracts({
    contracts: [
      { address: gate, abi: humanGateAbi, functionName: "cap" },
      { address: gate, abi: humanGateAbi, functionName: "humanOf", args: [address ?? ZERO] },
      { address: gate, abi: humanGateAbi, functionName: "remaining", args: [address ?? ZERO] },
    ],
    query: { refetchInterval: 4000 },
  });
  const cap = reads.data?.[0]?.result as bigint | undefined;
  const humanId = reads.data?.[1]?.result as bigint | undefined;
  const remaining = reads.data?.[2]?.result as bigint | undefined;
  const verified = !!humanId && humanId !== 0n;

  const usdcBal = useBalance(underlying.address, address);
  const voucherBal = useBalance(voucher.address, address);
  const allowance = useAllowance(underlying.address, address, gate);

  const amountRaw = amount ? parseDecimal(amount, underlying.decimals) : null;
  const amountErr =
    amount && amountRaw === null
      ? "Enter a valid amount."
      : amountRaw && remaining !== undefined && amountRaw > remaining
        ? `Your cap leaves ${fmtAmount(remaining, underlying.decimals)} ${underlying.symbol}.`
        : amountRaw && usdcBal.data !== undefined && amountRaw > usdcBal.data
          ? `You have ${fmtAmount(usdcBal.data, underlying.decimals)} ${underlying.symbol}.`
          : undefined;

  /** The server vouched for the World ID proof; now bind this wallet to that human on chain. */
  const onAttested = (a: Attestation) => {
    void verifyTx.send({
      label: "Register as a verified human",
      address: gate,
      abi: humanGateAbi,
      functionName: "verify",
      args: [0n, BigInt(a.nullifier), a.proof.map(BigInt) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]],
      success: "Verified. This wallet is now bound to your World ID.",
    });
  };

  const deposit = async () => {
    if (!amountRaw || amountErr) return;
    if ((allowance.data ?? 0n) < amountRaw) {
      const ok = await depositTx.send({ label: `Approve ${underlying.symbol}`, address: underlying.address, abi: erc20Abi, functionName: "approve", args: [gate, maxUint256] });
      if (!ok) return;
    }
    const ok = await depositTx.send({
      label: `Deposit ${amount} ${underlying.symbol}`,
      address: gate,
      abi: humanGateAbi,
      functionName: "deposit",
      args: [amountRaw],
      success: `You now hold ${voucher.symbol} to bid with.`,
    });
    if (ok) setAmount("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5">
        <IdentificationBadge size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <p className="text-[13px] leading-relaxed text-ink-2">
          The comparison arm: the same Clinch auction, but only people with World ID Proof of Human can bid, up to{" "}
          <span className="num text-ink">{cap !== undefined ? fmtAmount(cap, underlying.decimals, { max: 0 }) : "…"}</span> {underlying.symbol} each. Bids
          are in {voucher.symbol}, minted 1:1 from {underlying.symbol} after you verify. Redeem it back any time.
        </p>
      </div>

      {!address ? (
        <Notice>Connect a wallet to verify.</Notice>
      ) : verified ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone="accent">Verified human</Badge>
          <span className="text-ink-3">
            Cap left <span className="num text-ink-2">{remaining !== undefined ? fmtAmount(remaining, underlying.decimals) : "…"}</span> {underlying.symbol}
          </span>
        </div>
      ) : world.data === null ? (
        <Notice tone="warn">World ID is not configured on this server. Run the app with the WORLD_* variables in app/.env.sepolia.local.</Notice>
      ) : (
        <div className="space-y-3">
          <Button variant="primary" className="w-full" loading={verifyTx.busy || world.isLoading} disabled={!world.data} onClick={() => setOpen(true)}>
            Verify with World ID
          </Button>
          <p className="text-[12px] leading-relaxed text-ink-3">
            One proof per person, bound to this wallet. World checks the proof, and the gate contract refuses a second wallet for the same person.
            {world.data?.environment === "staging" && (
              <>
                {" "}
                Staging: scan with the{" "}
                <a className="underline decoration-line underline-offset-2 hover:text-ink-2" href="https://simulator.worldcoin.org/" target="_blank" rel="noreferrer">
                  World ID simulator
                </a>
                .
              </>
            )}
          </p>
          {open && world.data && (
            <Suspense fallback={null}>
              <WorldVerify
                config={world.data}
                sender={address}
                open={open}
                onOpenChange={setOpen}
                onAttested={onAttested}
                onFail={(m) => toasts.push({ kind: "error", title: "World ID", body: m })}
              />
            </Suspense>
          )}
        </div>
      )}

      {verified && (
        <div className="space-y-3 border-t border-line pt-4">
          <Field
            label={`Deposit ${underlying.symbol} for ${voucher.symbol}`}
            htmlFor="human-deposit"
            error={amountErr}
            right={
              <span className="num text-[12px] text-ink-3">
                {voucherBal.data !== undefined ? `${fmtAmount(voucherBal.data, voucher.decimals)} ${voucher.symbol}` : ""}
              </span>
            }
          >
            <NumberInput id="human-deposit" value={amount} onChange={setAmount} suffix={underlying.symbol} invalid={!!amountErr} placeholder="0" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" loading={depositTx.busy} disabled={!amountRaw || !!amountErr} onClick={deposit}>
              Deposit
            </Button>
            <Button
              loading={redeemTx.busy}
              disabled={!voucherBal.data}
              onClick={() =>
                voucherBal.data &&
                redeemTx.send({
                  label: `Redeem ${voucher.symbol}`,
                  address: gate,
                  abi: humanGateAbi,
                  functionName: "redeem",
                  args: [voucherBal.data],
                  success: `Redeemed for ${underlying.symbol}.`,
                })
              }
            >
              Redeem all
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
