import { fail, json, world } from "./_service";

export function GET() {
  try {
    return json(200, world.config());
  } catch (e) {
    return fail(e);
  }
}
