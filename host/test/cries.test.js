import { test } from "node:test";
import assert from "node:assert/strict";

import { EEVEE_IDLE_CRY } from "../src/pet/cries.js";

test("Eevee idle cry is species themed", () => {
  assert.equal(EEVEE_IDLE_CRY, "Bui!");
});
