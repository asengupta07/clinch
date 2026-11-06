import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Abi, ContractFunctionArgs, ContractFunctionName, TransactionReceipt, Address } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getConnectorClient, switchChain } from "wagmi/actions";
import { writeContract } from "viem/actions";
import { useToasts } from "../components/Toasts";
import { chain } from "../config/env";
import { publicClient } from "../config/wagmi";
import { humanError } from "../lib/errors";

export interface TxRequest<abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">> {
  /** what the toast says, e.g. "Approve USDC" */
  label: string;
  address: Address;
  abi: abi;
  functionName: fn;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", fn>;
  /** message on success */
  success?: string;
}

export type TxPhase = "idle" | "simulating" | "signing" | "pending" | "confirmed" | "failed";

/**
 * Simulate (to surface decoded revert reasons before the wallet prompt), sign, wait for the
 * receipt, toast every phase, then refresh all chain reads.
 */
export function useTx() {
  const config = useConfig();
  const { address, chainId, isConnected } = useAccount();
  const toasts = useToasts();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<TxPhase>("idle");

  const send = useCallback(
    async <abi extends Abi, fn extends ContractFunctionName<abi, "nonpayable" | "payable">>(req: TxRequest<abi, fn>): Promise<TransactionReceipt | null> => {
      if (!isConnected || !address) {
        toasts.push({ kind: "error", title: "Connect a wallet first" });
        return null;
      }
      const tid = toasts.push({ kind: "pending", title: req.label, body: "Checking the transaction…" });
      try {
        if (chainId !== chain.id) {
          toasts.update(tid, { body: `Switching your wallet to ${chain.name}…` });
          await switchChain(config, { chainId: chain.id });
        }
        setPhase("simulating");
        const sim = await publicClient.simulateContract({
          account: address,
          address: req.address,
          abi: req.abi as Abi,
          functionName: req.functionName as string,
          args: req.args as readonly unknown[],
        });
        setPhase("signing");
        toasts.update(tid, { body: "Confirm in your wallet…" });
        const client = await getConnectorClient(config, { chainId: chain.id });
        // Use the connector's own account (a local signer for demo wallets, JSON-RPC for injected).
        const { account: _ignored, ...request } = sim.request as Record<string, unknown>;
        void _ignored;
        const hash = await writeContract(client, { ...(request as object), account: client.account, chain } as never);
        setPhase("pending");
        toasts.update(tid, { body: "Waiting for the next block…", hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 500 });
        if (receipt.status !== "success") throw new Error("The transaction reverted on chain.");
        setPhase("confirmed");
        toasts.update(tid, { kind: "success", body: req.success ?? `Confirmed in block ${receipt.blockNumber.toString()}.`, hash });
        await qc.invalidateQueries();
        return receipt;
      } catch (e) {
        setPhase("failed");
        toasts.update(tid, { kind: "error", body: humanError(e) });
        return null;
      }
    },
    [address, chainId, config, isConnected, qc, toasts],
  );

  return { send, phase, busy: phase === "simulating" || phase === "signing" || phase === "pending" };
}
