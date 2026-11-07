# World ID integration debrief

Clinch, ETHGlobal Mumbai, November 2026.

## What we built

A per-human cap on top of Clinch's sybil-proof launch auction. The launch is priced in hUSDC, a 1:1 USDC voucher that only a verified human can mint, capped at 2,000 USDC per person and not transferable between wallets.

- **Credential:** Proof of Human through IDKit 4.6 (`@worldcoin/idkit`, `IDKitRequestWidget` with the `proofOfHuman` preset). The signal is the user's wallet address.
- **Server** (`app/server/world.ts`; Vercel Functions in `app/api/world/`):
  - signs each request with the RP key (`@worldcoin/idkit/signing`);
  - checks action, environment and that `signal_hash` matches the requesting wallet;
  - forwards the result unchanged to `POST /api/v4/verify/{rp_id}`;
  - on success, signs an attestation for the chain.
- **Contracts** (`contracts/src/HumanGate.sol`):
  - `AttestedWorldID` checks that attestation;
  - `HumanGate` binds each nullifier to exactly one wallet and enforces the cap.
- **Environment:** World staging, tested with the World ID simulator on Ethereum Sepolia.

## Time to first success

About an hour from having the app's keys (app ID, RP ID, RP signing key) to a real staging Proof of Human that passed the Developer Portal and registered a wallet on chain.

- The portal side took minutes. A signed request and a deliberately bad proof sent to `/api/v4/verify` came back with a proper verification failure, which confirmed the RP and action were live.
- The rest of the hour went into the on-chain side, because of the first friction point below.

Before we had keys, we built the whole flow against a mock verifier contract. The interface and the rejection paths were therefore already tested when the real credentials arrived.

## Friction

1. **No World ID 4.0 verifier on Ethereum Sepolia.**
   - The on-chain verification page lists the 4.0 `WorldIDVerifier` for World Chain and Arc only.
   - The 3.0 router table does include Ethereum Sepolia, which made it look like Sepolia was covered until we read closer.
   - We were deploying against Uniswap v4 on Sepolia, so we could not verify 4.0 proofs on chain. We had to add an attester: the portal does the ZK check, and our server signs a statement the contract trusts. It works, and the contract still enforces one wallet per nullifier, but it adds a trusted signer we would rather not have.
2. **Signal hashing is not documented for the on-chain path.**
   - The docs say to pass `responses[i].signal_hash` to the verifier, but not how it is computed.
   - Our contract needs to bind the proof to `msg.sender` itself. So we ended up with two hashes: IDKit's `hashSignal(lowercased address)`, which the server checks against the proof, and our own `keccak256(abi.encodePacked(wallet)) >> 8`, which the contract recomputes.
   - One documented, contract-friendly signal hash would remove that gap.
3. **Staging and the chain.** The docs list a staging verifier on World Chain but don't say whether simulator proofs verify against it. We could not tell without deploying there.
4. **Server examples are Next.js only.**
   - RP signing has to happen on a server, which is right. But a Vite single-page app has no server, and every example assumes Next.js route handlers.
   - We wrote the same three routes twice: as Vite dev-server middleware and as Vercel Functions.
   - A framework-neutral example (a plain `Request` to `Response` handler) would have saved that.
5. **Portal error detail.** A bad proof returned `all_verifications_failed` with detail `execution reverted (unknown custom error)`. That is accurate but tells the developer nothing about which input was wrong (signal, nonce, action or proof).
6. **Do actions need to be created in the portal first?** We could not find this stated. Our new action string verified without any portal setup, which is convenient, but we found that out by trying.

## What worked well

- **The simulator.** The "Paste code" flow with the connector URI made headless testing easy. We drove `IDKit.request(...).preset(proofOfHuman(...))` from a Node script, approved it in the simulator, and pushed the result through our real server route, all without a phone.
- **Uniqueness.** Same simulator identity, same action, same nullifier. Testing "one human, two wallets" took one extra run.
- **RP signing.** `signRequest` is a single call and the widget props map one to one onto its output.

## Missing capability

A Developer Portal verification result that a contract can verify on any chain. If `/api/v4/verify` returned, next to `success`, a signature from a published World key over `(rp_id, action, nullifier, signal_hash, environment)`, any EVM chain could check it with `ecrecover`. That would work today without a 4.0 verifier deployment, and it would remove the app-run attester entirely.

## The one improvement

Publish that signed verification result, or deploy the 4.0 `WorldIDVerifier` (or a `WorldIDSatellite`) on Ethereum Sepolia and mainnet. Either one would let an app verify Proof of Human on chain where its liquidity already is, which for a Uniswap v4 project is Ethereum, not World Chain. Everything else in the integration was straightforward.
