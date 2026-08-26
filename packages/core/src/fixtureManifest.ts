import { z } from "zod";

const fixtureBehaviorSchema = z.enum([
  "read-success",
  "edit-success",
  "failure-recovery",
  "interrupted"
]);

const fixtureEntrySchema = z.object({
  file: z.string().regex(/^[a-z0-9-]+\.jsonl$/),
  behavior: fixtureBehaviorSchema,
  sourceFixtureClass: z.string().min(1),
  sanitizedClasses: z.array(z.string().min(1)).min(1)
});

export const fixtureManifestSchema = z.object({
  observedCodexVersion: z.string().min(1),
  fixtures: z.array(fixtureEntrySchema).length(4)
});

export type FixtureBehavior = z.infer<typeof fixtureBehaviorSchema>;
export type FixtureManifestEntry = z.infer<typeof fixtureEntrySchema>;
export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;
