import { Check, Code, EyeSlash, Gavel, Info, LockKey, Minus, ShieldCheck } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Address as Addr, Badge, Card, cx, Notice, PageHeader, Spinner, Term, TERMS } from "../components/ui";
import { disableAnon, enableAnon, useAnonState } from "../config/anon";
import { ANON_RPC_SPECIFIER, chain, deployments, IS_LOCAL, RPC_URL } from "../config/env";

function Step({ n, title, children, last }: { n: number; title: string; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4">
      {!last && <span aria-hidden className="absolute bottom-0 left-[15.5px] top-9 w-px bg-line-strong" />}
      <span
        aria-hidden
        className="num relative inline-flex size-8 items-center justify-center rounded-full bg-surface-2 text-[13px] text-accent ring-1 ring-inset ring-accent-line"
      >
        {n}
      </span>
      <div className={cx("min-w-0 pt-1", !last && "pb-8")}>
        <h3 className="text-[15px] font-medium text-ink">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        <p className="mt-1.5 max-w-[72ch] text-[14px] leading-relaxed text-ink-2">{children}</p>
      </div>
    </li>
  );
}

function AnonToggle() {
  const s = useAnonState();
  const available = !!ANON_RPC_SPECIFIER;
  const on = s.status === "on" || s.status === "starting";
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium text-ink">Anon-RPC for reads</h3>
          <p className="mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-2">
            Routes every read this page makes through a hash-pinned anon-client running in a sandboxed worker (
            <code className="num text-[12.5px]">@anon-rpc/browser-harness</code>), so the RPC provider cannot tie the addresses you look up to your
            network identity.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[12.5px] text-ink-3" aria-hidden>
            {!available ? "Unavailable" : s.status === "starting" ? "Starting" : on ? "On" : "Off"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Anon-RPC for reads"
            disabled={!available || s.status === "starting"}
            onClick={() => (on ? disableAnon() : void enableAnon())}
            className="group -my-2.5 inline-flex h-11 items-center rounded-full px-1 disabled:cursor-not-allowed"
          >
            <span
              className={cx(
                "relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset transition-[background-color,box-shadow] duration-200 ease-[var(--ease-out-quint)] group-disabled:opacity-50",
                on ? "bg-accent ring-accent" : "bg-surface-2 ring-line-strong group-hover:ring-ink-3",
              )}
            >
              <span
                className={cx(
                  "inline-block size-[18px] rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-[var(--ease-out-quint)]",
                  on ? "translate-x-[23px]" : "translate-x-[3px]",
                )}
              />
            </span>
          </button>
        </div>
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

const GUARANTEES: ReactNode[] = [
  <>
    Bidding your true value and budget is a dominant strategy, and splitting a budget across wallets never helps (Theorem 1.3 for launches, 6.6 for
    two-sided batches).
  </>,
  <>On chain the ladder is discrete. In 200 random instances times 400 adversarial searches, no split or misreport gained more than ε of its budget.</>,
  <>Allocation does not depend on the order of bids, so a builder cannot profit from reordering, and injecting bids earns nothing (no free lunch).</>,
];

const NOT_CLAIMED: ReactNode[] = [
  <>That whales get less. They get what their budget buys. Identity caps can still be layered on top.</>,
  <>Free of costs. Budgets sit in escrow for the window, prices differ per bidder, and batches clear per window rather than per swap.</>,
  <>Censorship resistance at the block level. It assumes bids cannot be censored by the block builder, as every sealed or batch mechanism does.</>,
];

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
    <div className="mx-auto max-w-[1240px] px-4 pb-24 sm:px-6">
      <PageHeader
        title={
          <>
            How it <em>works</em>
          </>
        }
        meta={
          <p className="max-w-[72ch] text-[15px] leading-relaxed text-ink-2">
            Clinch is adaptive clinching (Dobzinski, Lavi and Nisan, 2008) with the sybil-proof AMM extension of Zhang, Li, Shi, Zhang, Xia and Han (arXiv
            2610.36629). One engine library backs both the launch contract and the v4 hook.
          </p>
        }
      />

      <div className="flex flex-col gap-16 sm:gap-20">
        <section aria-labelledby="mech" className="grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 id="mech" className="text-[20px] font-medium tracking-[-0.015em] text-ink">
              The mechanism
            </h2>
            <p className="mt-2 max-w-[40ch] text-[13.5px] leading-relaxed text-ink-3">Four steps, the same for a token launch and for a batch of swaps.</p>
          </div>
          <ol className="flex flex-col">
            <Step n={1} title="Escrow a limit and a budget">
              Each bid is a maximum price and a budget, and the whole budget is locked in the contract. That <Term tip={TERMS.escrow}>escrow</Term> is exactly
              the hypothesis of the sybil-proofness theorem: nobody can claim more budget than they hold.
            </Step>
            <Step n={2} title="Raise the price in small steps">
              The price starts at the reserve (for a launch) or the pool's spot price (for a batch) and rises by ε per step, landing exactly on each bidder's
              limit. Bidders whose limit is reached drop out.
            </Step>
            <Step n={3} title="Clinch what others cannot absorb">
              At every price, each remaining bidder <Term tip={TERMS.clinch}>clinches</Term> the supply that all the other bidders together can no longer
              afford at that price, and pays that price for it. Prices are therefore <Term tip={TERMS.nonUniform}>not uniform</Term>, and that is why the
              truth is the best bid.
            </Step>
            <Step n={4} title="Settle, permissionlessly" last>
              When the window ends, anyone calls <code className="num">settle()</code>. A launch fixes every allocation and seeds a Uniswap v4 pool at the
              discovered price. A batch fills the <Term tip={TERMS.dominant}>minority side</Term> at spot, clinches the dominant side against the pool
              curve, makes one swap on the PoolManager and returns the discretization surplus as a <Term tip={TERMS.rebate}>rebate</Term>.
            </Step>
          </ol>
        </section>

        <section aria-labelledby="guarantees" className="grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 id="guarantees" className="text-[20px] font-medium tracking-[-0.015em] text-ink">
              What is guaranteed, and what is not
            </h2>
          </div>
          <div className="grid gap-10 md:grid-cols-2 md:gap-8">
            <div>
              <h3 className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <ShieldCheck size={18} weight="duotone" className="text-accent" aria-hidden /> Guaranteed
              </h3>
              <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
                {GUARANTEES.map((g, i) => (
                  <li key={i} className="flex gap-3 py-3.5 text-[14px] leading-relaxed text-ink-2">
                    <Check size={15} weight="bold" className="mt-1 shrink-0 text-accent" aria-hidden />
                    <span className="max-w-[72ch]">{g}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <Info size={18} className="text-ink-3" aria-hidden /> Not claimed
              </h3>
              <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
                {NOT_CLAIMED.map((g, i) => (
                  <li key={i} className="flex gap-3 py-3.5 text-[14px] leading-relaxed text-ink-3">
                    <Minus size={15} weight="bold" className="mt-1 shrink-0" aria-hidden />
                    <span className="max-w-[72ch]">{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="crops" className="grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 id="crops" className="text-[20px] font-medium tracking-[-0.015em] text-ink">
              If this website disappears
            </h2>
            <p className="mt-2 max-w-[40ch] text-[13.5px] leading-relaxed text-ink-3">Censorship resistance, open source, privacy and security.</p>
          </div>
          <div className="flex min-w-0 flex-col gap-10">
            <dl className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              <Pillar icon={<Gavel size={18} aria-hidden />} title="Censorship resistance">
                <code className="num">settle()</code>, <code className="num">claim()</code> and the rescue paths are permissionless. A keeper script settles
                closed batches and ended launches, but if it stops, any wallet can do the same from this page or from a block explorer.
              </Pillar>
              <Pillar icon={<Code size={18} aria-hidden />} title="Open source">
                The contracts, this app and the research simulations build from the repository alone.
              </Pillar>
              <Pillar icon={<EyeSlash size={18} aria-hidden />} title="Privacy">
                A plain RPC provider sees your IP address and every address you query: balances, allowances and the order logs filtered by your address.
                Anon-RPC hides that for reads. Transactions are public on chain regardless.
              </Pillar>
              <Pillar icon={<LockKey size={18} aria-hidden />} title="Security">
                Keys stay in your wallet. This app has no server, no analytics and no trackers; it talks only to {chain.name}'s RPC.
              </Pillar>
            </dl>
            <AnonToggle />
          </div>
        </section>

        <section aria-labelledby="contracts" className="grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 id="contracts" className="text-[20px] font-medium tracking-[-0.015em] text-ink">
              Contracts on {chain.name}
            </h2>
            {IS_LOCAL && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] leading-relaxed text-ink-3">
                <Badge>local</Badge> Local anvil chain, id <span className="num">{chain.id}</span>.
              </p>
            )}
          </div>
          <Card className="min-w-0 overflow-hidden">
            <ul className="divide-y divide-line">
              {contracts
                .filter(([, a]) => !!a)
                .map(([label, a]) => (
                  <li key={label} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <span className="text-[13px] text-ink-2">{label}</span>
                    <span className="min-w-0 text-[12.5px] [&_a]:break-all [&_a]:text-right">
                      <Addr address={a!} copy full />
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}

function Pillar({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-[14px] font-medium text-ink">
        <span className="text-ink-3">{icon}</span>
        {title}
      </dt>
      <dd className="mt-1.5 max-w-[72ch] text-[14px] leading-relaxed text-ink-2">{children}</dd>
    </div>
  );
}
