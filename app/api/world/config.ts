import { fail, json, world } from "./_service.js";

export function GET() {
  try {
    return json(200, world.config());
  } catch (e) {
    return fail(e);
  }
}
