import { z } from "zod";

const boundedText = z.string().max(262_144);
const boundedDiffText = z.string().max(2_097_152);
const boundedPath = z.string().min(1).max(4_096);

export const gitStatusContentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("status"),
  entries: z.array(z.object({
    code: z.string().min(1).max(16),
    path: boundedPath
  }).strict()).max(10_000)
}).strict();

const gitDiffLineV1Schema = z.object({
  type: z.enum(["context", "add", "delete", "excluded", "no_newline"]),
  oldLineNumber: z.number().int().positive().nullable(),
  newLineNumber: z.number().int().positive().nullable(),
  text: boundedDiffText
}).strict().superRefine((line, context) => {
  if (line.type === "context" && (line.oldLineNumber === null || line.newLineNumber === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Context lines require both line numbers." });
  }
  if ((line.type === "add" || line.type === "excluded") && line.oldLineNumber !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Added lines cannot have an old line number." });
  }
  if (line.type === "delete" && line.newLineNumber !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Deleted lines cannot have a new line number." });
  }
  if (line.type === "no_newline" && (line.oldLineNumber !== null || line.newLineNumber !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "No-newline markers cannot have line numbers." });
  }
});

const gitDiffHunkV1Schema = z.object({
  header: z.string().max(8_192),
  oldStart: z.number().int().nonnegative(),
  oldCount: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  lines: z.array(gitDiffLineV1Schema).max(200_000)
}).strict();

const gitDiffMetadataV1Schema = z.object({
  type: z.enum([
    "binary", "rename_from", "rename_to", "copy_from", "copy_to",
    "similarity", "dissimilarity", "mode", "index", "excluded", "other"
  ]),
  text: boundedDiffText
}).strict();

const gitDiffFileV1Schema = z.object({
  oldPath: boundedPath,
  newPath: boundedPath,
  headers: z.array(z.string().max(8_192)).max(64),
  metadata: z.array(gitDiffMetadataV1Schema).max(1_000),
  hunks: z.array(gitDiffHunkV1Schema).max(100_000)
}).strict();

export const gitDiffContentV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("diff"),
  files: z.array(gitDiffFileV1Schema).max(100_000),
  preamble: z.array(boundedDiffText).max(1_000),
  truncated: z.boolean(),
  malformed: z.boolean()
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
