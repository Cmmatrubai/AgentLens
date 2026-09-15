import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  extractImportFacts,
  applyLocalSupportPolicy,
} from "../server/insights/import-facts.mjs";

const source = (code: string, changes = {}) => {
  const lines = code.split("\n");
  const excerpt = `diff --git a/src/entry.ts b/src/entry.ts\nnew file mode 100644\nindex 0000000..1234567\n--- /dev/null\n+++ b/src/entry.ts\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
  return {
    id: "src_north",
    attemptKey: "north",
    kind: "file",
    path: "src/entry.ts",
    provenance: "Final Git diff",
    excerpt,
    truncated: false,
    sha256: createHash("sha256").update(excerpt).digest("hex"),
    ...changes,
  };
};
const claimText =
  'North imports both QUEUE_LIMIT and warnOverflow from "./policy" into src/entry.ts.';
function run(
  sources,
  text = claimText,
  verdict = "supported",
  sideKey = "north",
) {
  const bundle = {
    sources,
    attempts: [
      { key: "north", model: "North" },
      { key: "south", model: "South" },
    ],
  };
  const draft = {
    findings: [
      { id: "f", sides: [{ attemptKey: sideKey, observation: text }] },
    ],
  };
  const checked = {
    findings: [
      {
        findingId: "f",
        verdict,
        issues: [],
        claims: [
          {
            unitId: "f0:observation:0",
            field: "sides[0].observation",
            text,
            verdict,
            reason: "Provider's original reason",
            passages: sources.map((s) => ({
              sourceId: s.id,
              attemptKey: s.attemptKey,
              kind: s.kind,
              label: s.path,
              quote: s.excerpt,
            })),
          },
        ],
      },
    ],
  };
  return applyLocalSupportPolicy(bundle, draft, checked).findings[0];
}

test("complete added source yields attempt- and hash-bound named import facts", () => {
  const s = source(
    'import { QUEUE_LIMIT, warnOverflow } from "./policy";\nexport const limit = QUEUE_LIMIT;',
  );
  const result = extractImportFacts({ sources: [s] });
  assert.equal(result.facts.length, 2);
  assert.deepEqual(
    result.facts.map((f) => [
      f.imported,
      f.local,
      f.module,
      f.path,
      f.attemptKey,
      f.sourceSha256,
    ]),
    [
      [
        "QUEUE_LIMIT",
        "QUEUE_LIMIT",
        "./policy",
        "src/entry.ts",
        "north",
        s.sha256,
      ],
      [
        "warnOverflow",
        "warnOverflow",
        "./policy",
        "src/entry.ts",
        "north",
        s.sha256,
      ],
    ],
  );
  assert.ok(
    result.facts.every((f) => f.id && f.sourceId === s.id && f.line === 1),
  );
  assert.equal(run([s]).verdict, "supported");
  assert.equal(run([s]).claims[0].localCheck.status, "matched");
});

test("co-occurrence and a local constant do not prove both symbols are imported", () => {
  const s = source(
    'import { warnOverflow } from "./policy";\nconst QUEUE_LIMIT = 64;',
  );
  assert.equal(run([s]).verdict, "needs_review");
  assert.equal(run([s]).claims[0].providerAssessment.verdict, "supported");
  assert.equal(run([s]).claims[0].localCheck.status, "unknown");
});

test("wrong attempt, module, file, aliases and type imports cannot satisfy a value import claim", () => {
  for (const s of [
    source('import { QUEUE_LIMIT, warnOverflow } from "./policy";', {
      attemptKey: "south",
    }),
    source('import { QUEUE_LIMIT, warnOverflow } from "./elsewhere";'),
    source('import { QUEUE_LIMIT as renamed, warnOverflow } from "./policy";'),
    source('import type { QUEUE_LIMIT, warnOverflow } from "./policy";'),
    source('import { type QUEUE_LIMIT, warnOverflow } from "./policy";'),
    source('import { QUEUE_LIMIT, warnOverflow } from "./policy";', {
      path: "other.ts",
    }),
  ])
    assert.equal(run([s]).verdict, "needs_review");
  assert.equal(
    run(
      [source('import { QUEUE_LIMIT, warnOverflow } from "./policy";')],
      claimText,
      "supported",
      "south",
    ).verdict,
    "needs_review",
  );
});

test("partial, malformed, wrong-hash and unsupported sources never yield facts", () => {
  const complete = source(
    'import { QUEUE_LIMIT, warnOverflow } from "./policy";',
  );
  for (const s of [
    { ...complete, truncated: true },
    { ...complete, sha256: "wrong" },
    source('import { QUEUE_LIMIT, warnOverflow } from "./policy";', {
      kind: "event",
      provenance: "Recorded command",
    }),
    source('import { QUEUE_LIMIT, warnOverflow } from "./policy";', {
      path: "src/entry.py",
    }),
    source('import { QUEUE_LIMIT, warnOverflow from "./policy";'),
    { ...complete, excerpt: complete.excerpt.replace("-0,0", "-2,0") },
  ]) {
    assert.equal(extractImportFacts({ sources: [s] }).facts.length, 0);
    assert.equal(run([s]).verdict, "needs_review");
  }
});

test("comments and strings containing import syntax are not import declarations", () => {
  for (const code of [
    '/* import { QUEUE_LIMIT, warnOverflow } from "./policy"; */',
    'const example = `import { QUEUE_LIMIT, warnOverflow } from "./policy";`;',
  ])
    assert.equal(run([source(code)]).verdict, "needs_review");
});

test("policy never upgrades a provider concern", () => {
  const s = source('import { QUEUE_LIMIT, warnOverflow } from "./policy";');
  for (const verdict of ["needs_review", "unsupported"])
    assert.equal(run([s], claimText, verdict).verdict, verdict);
  assert.equal(
    run([s], "The independent check result is unavailable.").verdict,
    "supported",
  );
});

test("compound C01 wording is withheld, not treated as a parsed fact", () => {
  const text =
    "git status lists eight modified files, adding packages/codex/src/lineDecoder.ts and packages/codex/test/lineDecoder.test.ts. rg shows MAX_SOURCE_LINE_BYTES and oversizedLineDiagnostic() defined in lineDecoder.ts (lines 10, 55, 68-69) and imported by recordRun.ts from @agentlens/codex; the processRunner.ts diff exports new consumeStreamLines and StreamLineConsumerInput.";
  assert.equal(
    run([source('import { QUEUE_LIMIT, warnOverflow } from "./policy";')], text)
      .verdict,
    "needs_review",
  );
});
