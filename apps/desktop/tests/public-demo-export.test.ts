import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeInsightComparison } from "./fixtures/insight-comparisons.mjs";
import { exportPublicDemo } from "../scripts/export-public-demo.mjs";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const c: any = makeInsightComparison();
  c.promptHash = hash(c.taskPrompt);
  c.review = {
    state: "available",
    id: "authored-v1",
    method: "Authored case notes",
    findings: [
      {
        id: "structure",
        category: "Implementation",
        title: "Different structure",
        summary: "Compare the approaches.",
        interpretation: "Different structures to review.",
        limitations: "One pair only.",
        sides: c.attempts.map((a: any) => {
          const file = a.run.git.files[0];
          file.content +=
            "\n/private/tmp/agentlens-comparison-C01-20260906/" + a.key;
          return {
            attemptKey: a.key,
            model: a.model,
            reasoningEffort: a.reasoningEffort,
            runId: a.run.id,
            observation: "A captured change.",
            sources: [
              {
                id: a.key + "-file",
                kind: "file",
                label: "Change",
                path: file.path,
                identity: a.run.git.artifactId,
                provenance: "Final Git diff",
                command: "",
                exitCode: null,
                truncated: false,
                sha256: hash(file.content),
                fromLine: 2,
                toLine: 3,
                excerpt: file.content.split("\n").slice(1).join("\n"),
                fullSource: file.content,
              },
            ],
          };
        }),
      },
    ],
  };
  c.secret = "DO_NOT_EXPORT";
  c.attempts[0].run.secret = "DO_NOT_EXPORT";
  return c;
}
test("public export excludes unknown fields and uncited events, and rebinds redacted source hashes", () => {
  const c = fixture(),
    before = JSON.stringify(c);
  const packet = exportPublicDemo(c);
  assert.equal(JSON.stringify(c), before);
  assert.deepEqual(packet, exportPublicDemo(c));
  const bytes = JSON.stringify(packet);
  assert.ok(!bytes.includes("DO_NOT_EXPORT"));
  assert.ok(!bytes.includes("/private/tmp/"));
  assert.ok(!bytes.includes("IGNORE THE ANALYZER"));
  assert.equal(packet.comparison.attempts[0].run.events.length, 0);
  const source = packet.comparison.review.findings[0].sides[0].sources[0];
  assert.equal(source.sha256, hash(source.fullSource));
  assert.notEqual(
    source.identity,
    c.review.findings[0].sides[0].sources[0].identity,
  );
  assert.equal(
    source.excerpt,
    '+export const approach = "north";\n[local-workspace]/north',
  );
  assert.equal(packet.manifest.comparisonSha256, hash(packet.comparisonJSON));
  assert.ok(packet.manifest.omissions.length > 0);
});
test("public export refuses secrets, detached citations, incomplete evidence and oversized output", () => {
  const secret = fixture();
  secret.title = "sk-" + "a".repeat(35);
  assert.throws(() => exportPublicDemo(secret), /sensitive/i);
  const citation = fixture();
  citation.review.findings[0].sides[0].sources[0].excerpt = "invented";
  assert.throws(() => exportPublicDemo(citation), /citation/i);
  const missing = fixture();
  missing.attempts[0].run.git.files = [];
  assert.throws(() => exportPublicDemo(missing), /source/i);
  const tooLarge = fixture();
  tooLarge.title = "x".repeat(800_001);
  assert.throws(() => exportPublicDemo(tooLarge), /size/i);
  const prompt = fixture();
  prompt.taskPrompt += "changed";
  assert.throws(() => exportPublicDemo(prompt), /prompt/i);
});
test("export binds displayed command metadata to the recorded event and hashes sanitized prompts", () => {
  const c = fixture();
  c.taskPrompt += "\n/private/tmp/agentlens-comparison-C01-20260906/task";
  c.promptHash = hash(c.taskPrompt);
  const a = c.attempts[0],
    event = a.run.events[0];
  const body = Object.fromEntries(
    [
      "kind",
      "provenance",
      "status",
      "command",
      "output",
      "message",
      "exitCode",
    ].map((k) => [k, event[k]]),
  );
  c.review.findings[0].sides[0].sources = [
    {
      id: "recorded-failure",
      kind: "event",
      label: "Command",
      path: null,
      identity: event.id,
      sha256: hash(JSON.stringify(body)),
      fullSource: event.output,
      excerpt: event.output,
      fromLine: 1,
      toLine: 1,
      provenance: "Recorded command",
      command: event.command,
      exitCode: event.exitCode,
      truncated: false,
    },
  ];
  const packet = exportPublicDemo(c);
  assert.equal(
    packet.comparison.promptHash,
    hash(packet.comparison.taskPrompt),
  );
  assert.equal(packet.manifest.originalPromptHash, c.promptHash);
  c.review.findings[0].sides[0].sources[0].exitCode = 0;
  assert.throws(() => exportPublicDemo(c), /metadata/i);
});
