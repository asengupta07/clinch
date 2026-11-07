import { fail, json, world } from "./_service";

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 64_000) return json(413, { error: "request too large" });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    return json(200, await world.attest(body));
  } catch (e) {
    return fail(e);
  }
}
