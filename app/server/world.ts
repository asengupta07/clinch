/**
 * World ID routes for the human-capped launch, served by the Vite dev/preview server (Node only;
 * nothing here is bundled into the browser). Secrets come from non-VITE_ env vars in
 * app/.env.<mode>.local:
 *   WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY, WORLD_ACTION, WORLD_ENVIRONMENT,
 *   WORLD_VERIFY_URL, WORLD_ATTESTER_PK
 *
 *   GET  /api/world/config       -> { enabled, app_id, action, environment }
 *   POST /api/world/rp-context   -> RP-signed request context for IDKit (IDKit 4.x)
 *   POST /api/world/attest       { sender, result } -> { nullifier, proof } for HumanGate.verify()
 *
 * attest forwards the IDKit result unchanged to the Developer Portal, checks that the proof's
 * signal is the wallet asking, then signs what AttestedWorldID checks on chain. Uniqueness is
 * not tracked here: HumanGate rejects a nullifier already bound to another wallet.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { signRequest } from "@worldcoin/idkit/signing";
import type { Plugin } from "vite";
import { createPublicClient, encodeAbiParameters, getAddress, http, isAddress, keccak256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const gateAbi = parseAbi([
  "function worldId() view returns (address)",
  "function signalHashOf(address) pure returns (uint256)",
  "function externalNullifierHash() view returns (uint256)",
  "function walletOf(uint256) view returns (address)",
]);

interface WorldEnv {
  appId: string;
  rpId: string;
  signingKey: string;
  action: string;
  environment: string;
  verifyUrl: string;
  attesterPk: Hex;
}

function readEnv(env: Record<string, string>): WorldEnv | null {
  const w = {
    appId: env.WORLD_APP_ID,
    rpId: env.WORLD_RP_ID,
    signingKey: env.WORLD_RP_SIGNING_KEY,
    action: env.WORLD_ACTION,
    environment: env.WORLD_ENVIRONMENT,
    verifyUrl: (env.WORLD_VERIFY_URL || "https://developer.world.org").replace(/\/$/, ""),
    attesterPk: env.WORLD_ATTESTER_PK as Hex,
  };
  return Object.values(w).every(Boolean) ? w : null;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new HttpError(413, "request too large");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

interface IdkitItem {
  identifier?: string;
  nullifier?: string;
  signal_hash?: string;
}

export function worldRoutes(env: Record<string, string>, deployments: { humanGate?: string; chainId?: number }): Plugin {
  const w = readEnv(env);
  const gate = deployments.humanGate && isAddress(deployments.humanGate) ? getAddress(deployments.humanGate) : undefined;
  const pub = createPublicClient({ transport: http(env.VITE_RPC_URL || "http://127.0.0.1:8545") });
  const attester = w ? privateKeyToAccount(w.attesterPk) : undefined;

  async function attest(body: Record<string, unknown>) {
    if (!w || !attester || !gate) throw new HttpError(503, "World ID is not configured on this server");
    const sender = typeof body.sender === "string" && isAddress(body.sender) ? getAddress(body.sender) : null;
    if (!sender) throw new HttpError(400, "sender must be an address");
    const result = body.result as { action?: string; environment?: string; responses?: IdkitItem[] } | undefined;
    const item = result?.responses?.[0];
    if (!result || !item?.nullifier) throw new HttpError(400, "missing IDKit result");
    if (result.action !== undefined && result.action !== w.action) throw new HttpError(400, `proof is for action "${result.action}", expected "${w.action}"`);
    if (result.environment !== w.environment) throw new HttpError(400, `proof is from ${result.environment}, expected ${w.environment}`);
    // The signal binds the proof to one wallet; a proof made for another wallet is useless here.
    if (!item.signal_hash || BigInt(item.signal_hash) !== BigInt(hashSignal(sender.toLowerCase()))) {
      throw new HttpError(400, "This proof was made for a different wallet.");
    }

    const nullifier = BigInt(item.nullifier);
    const [verifier, signalHash, extNullifier, boundTo] = await Promise.all([
      pub.readContract({ address: gate, abi: gateAbi, functionName: "worldId" }),
      pub.readContract({ address: gate, abi: gateAbi, functionName: "signalHashOf", args: [sender] }),
      pub.readContract({ address: gate, abi: gateAbi, functionName: "externalNullifierHash" }),
      pub.readContract({ address: gate, abi: gateAbi, functionName: "walletOf", args: [nullifier] }),
    ]);
    if (boundTo !== "0x0000000000000000000000000000000000000000" && boundTo.toLowerCase() !== sender.toLowerCase()) {
      throw new HttpError(409, `This World ID is already bound to ${boundTo}. One human, one wallet.`);
    }

    const res = await fetch(`${w.verifyUrl}/api/v4/verify/${w.rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    });
    const verdict = (await res.json().catch(() => null)) as { success?: boolean; code?: string; detail?: string } | null;
    if (!res.ok || verdict?.success !== true) {
      throw new HttpError(400, `World ID rejected the proof${verdict?.code ? ` (${verdict.code})` : ""}.`);
    }

    const chainId = deployments.chainId ?? (await pub.getChainId());
    const inner = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        [BigInt(chainId), verifier as Address, signalHash, nullifier, extNullifier],
      ),
    );
    const sig = await attester.signMessage({ message: { raw: inner } });
    const r = BigInt(`0x${sig.slice(2, 66)}`);
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v = BigInt(parseInt(sig.slice(130, 132), 16));
    return {
      nullifier: nullifier.toString(),
      proof: [r, s, v, 0n, 0n, 0n, 0n, 0n].map(String),
      credential: item.identifier ?? null,
    };
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split("?")[0];
    if (!url?.startsWith("/api/world/")) return next();
    try {
      if (url === "/api/world/config" && req.method === "GET") {
        return send(res, 200, w && gate ? { enabled: true, app_id: w.appId, action: w.action, environment: w.environment } : { enabled: false });
      }
      if (url === "/api/world/rp-context" && req.method === "POST") {
        if (!w) throw new HttpError(503, "World ID is not configured on this server");
        const s = signRequest({ signingKeyHex: w.signingKey, action: w.action });
        return send(res, 200, { rp_id: w.rpId, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt, signature: s.sig });
      }
      if (url === "/api/world/attest" && req.method === "POST") {
        return send(res, 200, await attest(await readJson(req)));
      }
      throw new HttpError(404, "not found");
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error("[world]", e);
      return send(res, 500, { error: "World ID check failed on the server." });
    }
  };

  return {
    name: "clinch:world-id",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
