import { z } from "zod";

const boundedText = z.string().max(262_144);
const boundedPath = z.string().min(1).max(4_096);

export const gitStatusContentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("status"),
  entries: z.array(z.object({
    code: z.string().min(1).max(16),
    path: boundedPath
  }).strict()).max(10_000)
}).strict();

export const gitDiffContentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("diff"),
  text: boundedText,
  truncated: z.boolean()
}).strict();

export const gitDiffCheckContentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("diff_check"),
  passed: z.boolean(),
  output: boundedText
}).strict();

export const gitUntrackedContentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("untracked"),
  entries: z.array(z.object({
    path: boundedPath,
    type: z.enum(["file", "directory", "symlink", "other"]),
    size: z.number().int().nonnegative()
  }).strict()).max(10_000)
}).strict();

export const gitContentV1Schema = z.discriminatedUnion("kind", [
  gitStatusContentV1Schema,
  gitDiffContentV1Schema,
  gitDiffCheckContentV1Schema,
  gitUntrackedContentV1Schema
]);

export type GitStatusContentV1 = z.infer<typeof gitStatusContentV1Schema>;
export type GitDiffContentV1 = z.infer<typeof gitDiffContentV1Schema>;
export type GitDiffCheckContentV1 = z.infer<typeof gitDiffCheckContentV1Schema>;
export type GitUntrackedContentV1 = z.infer<typeof gitUntrackedContentV1Schema>;
export type GitContentV1 = z.infer<typeof gitContentV1Schema>;
