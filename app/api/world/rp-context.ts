import { fail, json, world } from "./_service";

export function POST() {
  try {
    return json(200, world.rpContext());
  } catch (e) {
    return fail(e);
  }
}
