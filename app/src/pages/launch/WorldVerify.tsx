import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useEffect, useRef, useState } from "react";

export interface WorldConfig {
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging";
}

/** What /api/world/attest returns: the inputs for HumanGate.verify(). */
export interface Attestation {
  nullifier: string;
  proof: string[];
}

/** World App / bridge error codes a person can act on, in plain words. */
const WORLD_ERRORS: Record<string, string> = {
  user_rejected: "You cancelled the request in World App.",
  verification_rejected: "World App declined the verification.",
  credential_unavailable: "This World ID doesn't have the Proof of Human credential yet.",
  connection_failed: "Couldn't reach World App. Try again.",
  max_verifications_reached: "This World ID has already verified for this sale.",
  timestamp_too_old: "The request expired. Try again.",
  rp_signature_expired: "The request expired. Try again.",
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

/**
 * IDKit 4 widget bound to one wallet: the signal is the wallet address. The RP context is signed
 * by our server, and the server checks the proof with the World Developer Portal before it signs
 * the attestation that HumanGate checks on chain. Loaded lazily, only when someone verifies.
 */
export default function WorldVerify({
  config,
  sender,
  open,
  onOpenChange,
  onAttested,
  onFail,
}: {
  config: WorldConfig;
  sender: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAttested: (a: Attestation) => void;
  onFail: (message: string) => void;
}) {
  const [rp, setRp] = useState<RpContext | null>(null);
  const cb = useRef({ onFail, onOpenChange });
  cb.current = { onFail, onOpenChange };

  // One signed RP context per widget mount (it expires, so it is not cached across opens).
  useEffect(() => {
    let live = true;
    post<RpContext>("/api/world/rp-context", {})
      .then((c) => live && setRp(c))
      .catch((e: Error) => {
        cb.current.onFail(e.message);
        cb.current.onOpenChange(false);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!rp) return null;
  return (
    <IDKitRequestWidget
      open={open}
      onOpenChange={onOpenChange}
      app_id={config.app_id}
      action={config.action}
      rp_context={rp}
      environment={config.environment}
      allow_legacy_proofs
      preset={proofOfHuman({ signal: sender.toLowerCase() })}
      handleVerify={async (result: IDKitResult) => {
        try {
          onAttested(await post<Attestation>("/api/world/attest", { sender, result }));
        } catch (e) {
          // Our own refusal (second wallet, wrong wallet): close the widget's generic decline screen and say why.
          onOpenChange(false);
          onFail(e instanceof Error ? e.message : String(e));
          throw e;
        }
      }}
      onSuccess={() => onOpenChange(false)}
      onError={(code) => {
        if (code !== "failed_by_host_app") onFail(WORLD_ERRORS[code] ?? `World ID could not verify you (${code}).`);
      }}
    />
  );
}
