import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { fmtAmount } from "./format";

/** Human messages for every custom error in the Clinch ABIs. */
const MESSAGES: Record<string, string | ((args: readonly unknown[]) => string)> = {
  // ClinchHook
  DepthExceeded: "This batch is full for this side (5% of pool). Try a smaller order or the next batch.",
  BatchFull: "This batch already has the maximum number of orders. Wait for the next batch.",
  OrderTooSmall: "The order is below this pool's minimum size.",
  InvalidLimit: "A buy order needs a maximum price above zero.",
  OrderNotMarketable: "Your limit is worse than the current price, so this order can't fill. A buy limit must be at or above spot; a sell limit at or below.",
  PoolTooShallow: "This pool's reserves are too small for batch trading right now.",
  PriceOutOfRange: "The pool price is outside the supported range.",
  BatchNotClosed: "The batch window is still open. Settling becomes possible once it closes.",
  NothingToSettle: "There is no closed, unsettled batch to settle right now.",
  RescueNotReady: "It is too early to cancel. Cancelling is only allowed after the rescue delay passes.",
  AlreadyClaimed: "This has already been claimed.",
  NotFinal: "This batch has not been settled or cancelled yet, so nothing can be claimed.",
  PoolNotInitialized: "This pool has not been initialized.",
  PoolReservedFor: (a) => `This pool is reserved for the launch at ${String(a[0])}.`,
  AlreadyInitialized: "This pool is already initialized.",
  DirectSwapDisabled: "Direct swaps are disabled. Orders go through batches.",
  SettlementShortfall: (a) =>
    `The pool delivered less than the engine required (needed ${String(a[0])}, got ${String(a[1])}). Settlement was reverted to protect traders.`,
  TransferAmountMismatch: "The token transferred a different amount than requested (fee-on-transfer tokens are not supported).",
  Reentrancy: "Reentrant call blocked.",
  LadderExhausted: "The auction needs more price steps than one transaction allows. Use the rescue path after the delay.",
  InvalidPool: "Invalid pool configuration.",
  InvalidConfig: "Invalid pool configuration.",
  NotSettleable: "This batch cannot be settled.",
  // ClinchLaunch
  WrongStatus: "The sale is not in the right state for this action.",
  SaleClosed: "Bidding has ended for this sale.",
  SaleOpen: "The sale is still open. It can be settled after it ends.",
  TooManyBids: "This sale has reached its maximum number of bids.",
  BidTooSmall: "The budget is below the sale's minimum bid.",
  LimitBelowReserve: "Your maximum price is below the reserve price.",
  NotIssuer: "Only the issuer can withdraw.",
  Underfunded: "The sale was not funded with enough tokens.",
  // Factory
  InvalidParams: "Invalid parameters.",
  NoFreePoolKey: "No free pool key is available for this pair.",
  HookMismatch: "Hook mismatch.",
};

export function errorName(e: unknown): string | null {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? null;
  }
  return null;
}

/** Turn any error from viem / a wallet into one readable sentence. */
export function humanError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      const name = r.data?.errorName;
      if (name && MESSAGES[name]) {
        const m = MESSAGES[name];
        return typeof m === "function" ? m(r.data?.args ?? []) : m;
      }
      if (name === "Panic" || r.reason?.includes("Arithmetic")) {
        return "The transaction would fail: likely an insufficient token balance or allowance.";
      }
      if (r.reason === "TRANSFER_FROM_FAILED" || r.reason === "TRANSFER_FAILED") {
        return "Token transfer failed: check your balance and approval.";
      }
      if (r.reason) return `Reverted: ${r.reason}`;
      if (name) return `Reverted: ${name}`;
      // solmate ERC20 underflows on insufficient balance/allowance -> panic 0x11
      if (r.signature === "0x4e487b71" || /0x11|overflow|underflow/i.test(r.shortMessage)) {
        return "The transaction would fail: likely an insufficient token balance or allowance.";
      }
      return "The transaction would revert.";
    }
    if (/insufficient funds/i.test(e.message)) return "Not enough ETH to pay for gas.";
    if (/chain mismatch|does not match the target chain/i.test(e.message)) return "Your wallet is on a different network. Switch networks and try again.";
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export { fmtAmount };
