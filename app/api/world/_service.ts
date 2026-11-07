/**
 * Shared World ID service for the Vercel Functions in this folder. The deployed app is the
 * Sepolia build, so it reads the Sepolia deployment; the RPC can be overridden with WORLD_RPC_URL.
 * Files starting with "_" are not routes on Vercel.
 */
import deployments from "../../src/deployments.sepolia.json" with { type: "json" };
import { createWorldService, errorResponse } from "../../server/world";

export const world = createWorldService(
  process.env,
  deployments as { humanGate?: string; chainId?: number },
  process.env.WORLD_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
);

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export function fail(e: unknown) {
  const { status, body } = errorResponse(e);
  return json(status, body);
}
