import { ShieldCheck } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Address as Addr, Badge, Card, cx, Notice, Spinner, Term, TERMS } from "../components/ui";
import { disableAnon, enableAnon, useAnonState } from "../config/anon";
import { ANON_RPC_SPECIFIER, chain, deployments, IS_LOCAL, RPC_URL } from "../config/env";

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-[9px] size-2 rounded-full bg-accent" aria-hidden />
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <div className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-ink-2">{children}</div>
    </li>
  );
}

function AnonToggle() {
  const s = useAnonState();
  const available = !!ANON_RPC_SPECIFIER;
  const on = s.status === "on" || s.status === "starting";
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">Anon-RPC for reads</h3>
          <p className="mt-1 max-w-[56ch] text-[13.5px] leading-relaxed text-ink-2">
            Routes every read this page makes through a hash-pinned anon-client running in a sandboxed worker (
            <code className="num text-[12.5px]">@anon-rpc/browser-harness</code>), so the RPC provider cannot tie the addresses you look up to your
            network identity.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Anon-RPC for reads"
          disabled={!available || s.status === "starting"}
          onClick={() => (on ? disableAnon() : void enableAnon())}
          className={cx(
            "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            on ? "border-accent bg-accent" : "border-line-strong bg-surface-2",
          )}
        >
          <span className={cx("inline-block size-4.5 rounded-full bg-surface shadow transition-transform", on ? "translate-x-[22px]" : "translate-x-[3px]")} />
        </button>
      </div>
      <div className="mt-4">
        {!available ? (
          <Notice tone="info">
            Anon-RPC needs an on-chain anon-client specifier; available on Sepolia/mainnet deployments. This build has none configured
            {IS_LOCAL ? " (it targets a local anvil chain)" : ""}, so reads go directly to {RPC_URL}. Set <code className="num">VITE_ANON_RPC_SPECIFIER</code> to
            enable it.
          </Notice>
        ) : s.status === "starting" ? (
          <Notice tone="info">
            <span className="inline-flex items-center gap-2">
              <Spinner /> Loading and verifying the anon-client (its bytes must hash to the specifier's pinned value)…
            </span>
          </Notice>
        ) : s.status === "on" ? (
          <Notice tone="ok">Reads are going through Anon-RPC. Transactions still go to the normal RPC (see below).</Notice>
        ) : s.status === "error" ? (
          <Notice tone="warn">Anon-RPC failed ({s.error}). Reads fell back to the normal RPC at {RPC_URL}.</Notice>
        ) : (
          <Notice tone="info">Off. Reads go directly to {RPC_URL}.</Notice>
        )}
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
        Writes always go to the normal RPC: your wallet's own RPC for a browser wallet, or {RPC_URL} for demo wallets. A transaction becomes public on chain
        anyway, so hiding it from the RPC would add little.
      </p>
    </Card>
  );
}

export default function Trust() {
  const contracts: [string, string | undefined][] = [
    ["ClinchHook (Uniswap v4 hook)", deployments.hook],
    ["ClinchLaunchFactory", deployments.factory],
    ["Demo launch", deployments.launch],
    ["Uniswap v4 PoolManager", deployments.poolManager],
    ["USDC (test token)", deployments.usdc],
    ["WETH (test token)", deployments.weth],
    ["CLNCH (test token)", deployments.clnch],
  ];
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-10 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">How it works</h1>
      <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-ink-2">
        Clinch is adaptive clinching (Dobzinski, Lavi and Nisan, 2008) with the sybil-proof AMM extension of Zhang, Li, Shi, Zhang, Xia and Han (arXiv
        2610.36629). One engine library backs both the launch contract and the v4 hook.
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="mech">
          <h2 id="mech" className="text-[20px] font-semibold tracking-tight text-ink">
            The mechanism
          </h2>
          <ol className="mt-5 flex flex-col gap-6 border-l border-line pl-0">
            <Step title="Escrow a limit and a budget">
              Each bid is a maximum price and a budget, and the whole budget is locked in the contract. That <Term tip={TERMS.escrow}>escrow</Term> is
              exactly the hypothesis of the sybil-proofness theorem: nobody can claim more budget than they hold.
            </Step>
            <Step title="Raise the price in small steps">
              The price starts at the reserve (for a launch) or the pool's spot price (for a batch) and rises by ε per step, landing exactly on each
              bidder's limit. Bidders whose limit is reached drop out.
            </Step>
            <Step title="Clinch what others cannot absorb">
              At every price, each remaining bidder <Term tip={TERMS.clinch}>clinches</Term> the supply that all the other bidders together can no
              longer afford at that price, and pays that price for it. Prices are therefore{" "}
              <Term tip={TERMS.nonUniform}>not uniform</Term>, and that is why the truth is the best bid.
            </Step>
            <Step title="Settle, permissionlessly">
              When the window ends, anyone calls <code className="num">settle()</code>. A launch fixes every allocation and seeds a Uniswap v4 pool at
              the discovered price. A batch fills the <Term tip={TERMS.dominant}>minority side</Term> at spot, clinches the dominant side against the
              pool curve, makes one swap on the PoolManager and returns the discretization surplus as a <Term tip={TERMS.rebate}>rebate</Term>.
            </Step>
          </ol>
        </section>

        <section aria-labelledby="guarantees">
          <h2 id="guarantees" className="text-[20px] font-semibold tracking-tight text-ink">
            What is guaranteed, and what is not
          </h2>
          <ul className="mt-5 flex flex-col gap-3 text-[14px] leading-relaxed text-ink-2">
            <li className="flex gap-2.5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
              <span>Bidding your true value and budget is a dominant strategy, and splitting a budget across wallets never helps (Theorem 1.3 for launches, 6.6 for two-sided batches).</span>
            </li>
            <li className="flex gap-2.5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
              <span>On chain the ladder is discrete. In 200 random instances times 400 adversarial searches, no split or misreport gained more than ε of its budget.</span>
            </li>
            <li className="flex gap-2.5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
              <span>Allocation does not depend on the order of bids, so a builder cannot profit from reordering, and injecting bids earns nothing (no free lunch).</span>
            </li>
            <li className="mt-2 text-ink-3">Not claimed: that whales get less. They get what their budget buys. Identity caps can still be layered on top.</li>
            <li className="text-ink-3">Costs: budgets sit in escrow for the window, prices differ per bidder, and batches clear per window rather than per swap.</li>
            <li className="text-ink-3">Assumes bids cannot be censored by the block builder, as every sealed or batch mechanism does.</li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="crops" className="mt-14 border-t border-line pt-10">
        <h2 id="crops" className="text-[20px] font-semibold tracking-tight text-ink">
          If this website disappears
        </h2>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4 text-[14px] leading-relaxed text-ink-2">
            <p>
              <span className="font-medium text-ink">Censorship resistance.</span> <code className="num">settle()</code>, <code className="num">claim()</code>{" "}
              and the rescue paths are permissionless. A keeper script settles closed batches and ended launches, but if it stops, any wallet can do the same
              from this page or from a block explorer.
            </p>
            <p>
              <span className="font-medium text-ink">Open source.</span> The contracts, this app and the research simulations build from the repository
              alone.
            </p>
            <p>
              <span className="font-medium text-ink">Privacy.</span> A plain RPC provider sees your IP address and every address you query: balances,
              allowances and the order logs filtered by your address. Anon-RPC hides that for reads. Transactions are public on chain regardless.
            </p>
            <p>
              <span className="font-medium text-ink">Security.</span> Keys stay in your wallet. This app has no server, no analytics and no trackers; it
              talks only to {chain.name}'s RPC.
            </p>
          </div>
          <AnonToggle />
        </div>

        <h3 className="mt-10 text-[15px] font-semibold text-ink">Contracts on {chain.name}</h3>
        <Card className="mt-3 divide-y divide-line">
          {contracts
            .filter(([, a]) => !!a)
            .map(([label, a]) => (
              <div key={label} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[13px] text-ink-2">{label}</span>
                <span className="min-w-0 text-[13px]">
                  <Addr address={a!} copy full />
                </span>
              </div>
            ))}
        </Card>
        {IS_LOCAL && (
          <p className="mt-3 text-[12.5px] text-ink-3">
            <Badge className="mr-2">local</Badge>These addresses are on a local anvil chain (chain id {chain.id}).
          </p>
        )}
      </section>
    </div>
  );
}
