import { test } from "node:test";
import assert from "node:assert/strict";
import { ExpressionSchema } from "../src/core/schema";
import { PortraitSources, PortraitTags } from "../src/client/npc/sources";

test("every NPC portrait set covers the same expression tags as the schema", () => {
  assert.deepEqual(
    [...PortraitTags].sort(),
    [...ExpressionSchema.options].sort(),
  );
  assert.ok(Object.keys(PortraitSources).length >= 2);
  for (const [npcId, set] of Object.entries(PortraitSources)) {
    for (const tag of PortraitTags) {
      assert.match(
        set[tag] ?? "",
        /^data:image\/png;base64,/,
        `${npcId}/${tag} 缺少内联立绘`,
      );
    }
  }
});