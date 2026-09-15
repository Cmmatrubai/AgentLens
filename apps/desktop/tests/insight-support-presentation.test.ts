import { test } from "node:test";
import assert from "node:assert/strict";
import {
  partitionSupportFindings,
  isCurrentSupportConsent,
} from "../src/insight-support-presentation.ts";
import type { ComparisonFinding } from "../src/comparison-types.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SupportReview,
  SupportAttemptFactsPreview,
  SupportSourceDetailsPreview,
} from "../src/SupportReview.tsx";
import type { RealComparison } from "../src/comparison-types.ts";
import type {
  InsightReadSuccess,
  InsightSupport,
  InsightReviewSupportInput,
  InsightPreviewSource,
} from "../src/insight-types.ts";

const findings = ["a", "b", "c"].map((id) => ({
  id,
  title: id,
  category: `Category ${id}`,
  summary: `Summary ${id}`,
  interpretation: "Interpretation",
  limitations: "Limits",
  sides: [],
})) as ComparisonFinding[];
const available = (
  verdicts: Array<"supported" | "needs_review" | "unsupported">,
): InsightSupport => ({
  state: "available",
  reviewKey: "key",
  error: null,
  review: {
    id: "review",
    createdAt: 1,
    model: "reviewer",
    baseUrl: "https://example.test/v1",
    version: "v1",
    promptVersion: "v1",
    usage: null,
    diagnostics: null,
    findings: verdicts.map((verdict, i) => ({
      findingId: findings[i].id,
      verdict,
      reason: "Bounded evidence review.",
      issues:
        verdict === "supported"
          ? []
          : [
              {
                claim: "Claim",
                explanation: "Outside the selected evidence.",
                sourceIds: ["source"],
              },
            ],
    })),
  },
});

test("only reviewed supported findings become main cards; flagged originals are preserved", () => {
  const result = partitionSupportFindings(
    findings,
    available(["supported", "needs_review", "unsupported"]),
  );
  assert.equal(result.reviewed, true);
  assert.deepEqual(result.supported, [findings[0]]);
  assert.deepEqual(
    result.pending.map((item) => item.finding),
    [findings[1], findings[2]],
  );
  assert.equal(result.pending[1].result?.verdict, "unsupported");
});

test("missing, running, stale, failed and interrupted review cannot promote a draft", () => {
  for (const state of [
    "not_reviewed",
    "running",
    "stale",
    "failed",
    "interrupted",
  ] as const) {
    const result = partitionSupportFindings(findings, {
      ...available(["supported", "supported", "supported"]),
      state,
    });
    assert.equal(result.reviewed, false);
    assert.equal(result.supported.length, 0);
    assert.deepEqual(
      result.pending.map((item) => item.finding),
      findings,
    );
  }
  assert.equal(partitionSupportFindings(findings, null).supported.length, 0);
});

test("incomplete, duplicate, extra and contradictory review verdicts fail closed", () => {
  for (const mutation of [
    (review: NonNullable<InsightSupport["review"]>) => review.findings.pop(),
    (review: NonNullable<InsightSupport["review"]>) => {
      review.findings[1].findingId = "a";
    },
    (review: NonNullable<InsightSupport["review"]>) => {
      review.findings.push({ ...review.findings[0], findingId: "unknown" });
    },
    (review: NonNullable<InsightSupport["review"]>) => {
      review.findings[0].issues = [
        { claim: "Claim", explanation: "Issue", sourceIds: [] },
      ];
    },
  ]) {
    const support = available(["supported", "supported", "supported"]);
    mutation(support.review!);
    const result = partitionSupportFindings(findings, support);
    assert.equal(result.reviewed, false);
    assert.equal(result.supported.length, 0);
  }
});

test("an all-flagged review preserves every original without main cards", () => {
  const result = partitionSupportFindings(
    findings,
    available(["needs_review", "unsupported", "needs_review"]),
  );
  assert.equal(result.reviewed, true);
  assert.equal(result.supported.length, 0);
  assert.equal(result.pending.length, 3);
});

test("a flagged finding without an issue invalidates the review and keeps every draft unpromoted", () => {
  for (const verdict of ["needs_review", "unsupported"] as const) {
    const support = available(["supported", verdict, "supported"]);
    support.review!.findings[1].issues = [];
    const result = partitionSupportFindings(findings, support);
    assert.equal(result.reviewed, false);
    assert.deepEqual(result.supported, []);
    assert.deepEqual(
      result.pending,
      findings.map((finding) => ({ finding, result: null })),
    );
  }
});

test("consent is invalidated by each review identity, not by unrelated request ids", () => {
  const snapshot = {
    analysisId: "a",
    inputHash: "i",
    settingsHash: "s",
    reviewKey: "r",
  };
  const request: InsightReviewSupportInput = { ...snapshot, requestId: "one" };
  assert.equal(isCurrentSupportConsent(request, snapshot), true);
  for (const key of Object.keys(snapshot)) {
    assert.equal(
      isCurrentSupportConsent(request, { ...snapshot, [key]: "changed" }),
      false,
    );
  }
  assert.equal(isCurrentSupportConsent(request, null), false);
});

const renderSupport = (
  support: InsightSupport | null,
  sources: InsightPreviewSource[] = [],
  shownFindings = findings,
) =>
  renderToStaticMarkup(
    createElement(SupportReview, {
      insight: {
        analysis: { id: "analysis", findings: shownFindings },
        support,
        settingsHash: "settings",
        settings: {
          baseUrl: "https://example.test/v1",
          model: "reviewer",
          maxOutputTokens: 6000,
          timeoutSeconds: 90,
          reasoningEffort: "default",
        },
        input: {
          hash: "evidence",
          sources,
          coverage: {
            includedSources: 0,
            characters: 0,
            omittedSources: 0,
            limits: [],
          },
        },
      } as unknown as InsightReadSuccess,
      comparison: { title: "Task", attempts: [] } as unknown as RealComparison,
      canReview: false,
      actionBusy: false,
      onReview: async () => {},
      onSettings: () => {},
      onSelect: () => {},
    }),
  );

test("rendering keeps unreviewed drafts collapsed and disables browser review", () => {
  const html = renderSupport(null);
  assert.match(html, /Unreviewed draft/);
  assert.match(html, /<details class="support-pending">/);
  assert.doesNotMatch(html, /class="finding-card"/);
  assert.match(html, /disabled=""[^>]*>Review in desktop/);
  assert.match(html, /Compare evidence/);
});

test("rendering promotes only supported findings and retains flagged issue text", () => {
  const mixed = renderSupport(
    available(["supported", "needs_review", "unsupported"]),
  );
  assert.equal((mixed.match(/class="finding-card"/g) ?? []).length, 1);
  assert.match(mixed, /AI support review/);
  assert.match(mixed, /Needs review/);
  assert.match(mixed, /Outside the selected evidence/);
  const allFlagged = renderSupport(
    available(["needs_review", "unsupported", "needs_review"]),
  );
  assert.match(allFlagged, /3 findings need review/);
  assert.doesNotMatch(allFlagged, /class="finding-card"/);
});

test("a support response-limit failure explains the missing answer and preserves the unreviewed draft", () => {
  const html = renderSupport({
    state: "failed",
    reviewKey: "review",
    review: null,
    error: "provider_incomplete",
    diagnostics: {
      finishReason: "length",
      reasoningTokens: 23998,
      answerCharacters: 0,
    },
  });
  assert.match(html, /Response limit reached/);
  assert.match(html, /reported reasoning tokens but returned no answer text/);
  assert.match(html, /original draft is preserved/);
  assert.match(html, /No retry is started automatically/);
  assert.match(html, /may incur a charge/);
  assert.match(html, /Unreviewed draft/);
  assert.doesNotMatch(html, /class="finding-card"/);
});

test("supported findings keep exact claim passages behind a collapsed inspection section", () => {
  const support = available(["supported", "supported", "supported"]);
  support.review!.findings[0].claims = [
    {
      unitId: "f0:summary",
      field: "summary",
      text: "The captured block uses a guard.",
      verdict: "supported",
      reason: "The quoted line shows the guard in the captured block.",
      passages: [
        {
          sourceId: "source",
          attemptKey: "attempt-a",
          kind: "file",
          label: "Captured patch",
          quote: "if (size > limit) {",
        },
      ],
    },
  ];
  const html = renderSupport(support);
  assert.match(html, /<details class="support-claim-checks">/);
  assert.match(html, /Inspect claim checks/);
  assert.match(html, /The captured block uses a guard/);
  assert.match(html, /Quoted passage/);
  assert.match(html, /if \(size &gt; limit\) \{/);
  assert.match(html, /remains an AI assessment/);
  assert.equal((html.match(/class="finding-card"/g) ?? []).length, 3);
});

test("flagged claims show exact attempt-fact quotes without inventing a source-excerpt link", () => {
  const support = available(["unsupported", "supported", "supported"]);
  support.review!.findings[0].issues = [
    {
      claim: "Both attempts passed every independent check.",
      explanation: "The cited fact records only the supplied checks.",
      sourceIds: [],
      passages: [
        {
          sourceId: null,
          attemptKey: "attempt-a",
          kind: "attempt_facts",
          label: "Attempt A facts",
          quote: '"passed": 7',
        },
      ],
    },
  ];
  const html = renderSupport(support);
  assert.match(html, /Both attempts passed every independent check/);
  assert.match(html, /Quoted passages used for this concern/);
  assert.match(html, /Attempt facts/);
  assert.match(html, /attempt-a/);
  assert.match(html, /&quot;passed&quot;: 7/);
  assert.doesNotMatch(html, /<summary>Source excerpt<\/summary>/);
  assert.match(html, /Compare evidence/);
});

test("a passage quote is distinct from its complete selected source excerpt", () => {
  const support = available(["unsupported", "supported", "supported"]);
  support.review!.findings[0].issues = [
    {
      claim: "The entire implementation changed.",
      explanation: "Only a partial patch was captured.",
      sourceIds: ["source"],
      passages: [
        {
          sourceId: "source",
          attemptKey: "attempt-a",
          kind: "file",
          label: "Patch line",
          quote: "+ newGuard();",
        },
      ],
    },
  ];
  const html = renderSupport(support, [
    {
      id: "source",
      attemptKey: "attempt-a",
      label: "Selected patch",
      path: "source.ts",
      provenance: "Final Git diff",
      excerpt: "context before\n+ newGuard();\ncontext after",
    },
  ]);
  assert.match(html, /Quoted passage/);
  assert.match(html, /<pre>\+ newGuard\(\);<\/pre>/);
  assert.match(html, /<summary>Source excerpt<\/summary>/);
  assert.match(html, /context before\n\+ newGuard\(\);\ncontext after/);
  assert.match(html, /Final Git diff/);
});

test("consent exposes exact attempt-fact text with its provenance and escaping", () => {
  const html = renderToStaticMarkup(
    createElement(SupportAttemptFactsPreview, {
      facts: [
        {
          attemptKey: "a",
          label: "Attempt facts · Attempt A",
          text: '{"identity":"a","checks":[{"passed":7}],"note":"<script>do not run</script>"}',
        },
      ],
    }),
  );
  assert.match(html, /<details class="support-attempt-facts-preview">/);
  assert.match(html, /Attempt facts sent for review/);
  assert.match(html, /Attempt facts · Attempt A/);
  assert.match(
    html,
    /&quot;identity&quot;:&quot;a&quot;,&quot;checks&quot;:\[\{&quot;passed&quot;:7\}\]/,
  );
  assert.match(html, /&lt;script&gt;do not run&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("present claim assessments cannot contradict the finding verdict or be empty", () => {
  for (const verdict of ["needs_review", "unsupported"] as const) {
    const support = available(["supported", "supported", "supported"]);
    support.review!.findings[0].claims = [
      {
        unitId: "f0:summary",
        field: "summary",
        text: "Claim",
        verdict,
        reason: "Unsupported scope.",
        passages: [],
      },
    ];
    assert.equal(partitionSupportFindings(findings, support).reviewed, false);
    assert.deepEqual(partitionSupportFindings(findings, support).supported, []);
  }
  const empty = available(["supported", "supported", "supported"]);
  empty.review!.findings[0].claims = [];
  assert.equal(partitionSupportFindings(findings, empty).reviewed, false);
});

test("malformed exact passages cannot promote a reviewed finding", () => {
  const base = {
    sourceId: "source",
    attemptKey: "a",
    kind: "file",
    label: "Patch",
    quote: "visible line",
  };
  for (const passage of [
    null,
    { ...base, sourceId: null },
    { ...base, kind: "attempt_facts" },
    { ...base, quote: "" },
  ]) {
    const support = available(["supported", "supported", "supported"]);
    support.review!.findings[0].claims = [
      {
        unitId: "f0:summary",
        field: "summary",
        text: "Claim",
        verdict: "supported",
        reason: "A quoted observation.",
        passages: [passage as never],
      },
    ];
    const result = partitionSupportFindings(findings, support);
    assert.equal(result.reviewed, false);
    assert.deepEqual(result.supported, []);
  }
});

test("attempt-fact captions show provenance and identity once", () => {
  const support = available(["unsupported", "supported", "supported"]);
  support.review!.findings[0].issues = [
    {
      claim: "Claim",
      explanation: "Concern",
      sourceIds: [],
      passages: [
        {
          sourceId: null,
          attemptKey: "orion-code",
          kind: "attempt_facts",
          label: "Attempt facts · orion-code",
          quote: '"passed":7',
        },
      ],
    },
  ];
  const caption =
    renderSupport(support).match(/<figcaption>.*?<\/figcaption>/s)?.[0] ?? "";
  assert.equal((caption.match(/Attempt facts/g) ?? []).length, 1);
  assert.equal((caption.match(/orion-code/g) ?? []).length, 1);
});

test("source metadata passages are labeled as source details with the original excerpt only as context", () => {
  const support = available(["unsupported", "supported", "supported"]);
  support.review!.findings[0].issues = [
    {
      claim: "The whole file is shown.",
      explanation: "The source metadata identifies a truncated excerpt.",
      sourceIds: ["source"],
      passages: [
        {
          sourceId: "source",
          attemptKey: "orion-code",
          kind: "source_metadata",
          label: "Source details · Captured patch",
          quote: '{"truncated":true}',
        },
      ],
    },
  ];
  const html = renderSupport(support, [
    {
      id: "source",
      attemptKey: "orion-code",
      label: "Captured patch",
      path: "file.ts",
      provenance: "Final Git diff",
      excerpt: "+ visibleChange();",
    },
  ]);
  const caption = html.match(/<figcaption>.*?<\/figcaption>/s)?.[0] ?? "";
  assert.match(caption, /<strong>Source details<\/strong>/);
  assert.equal((caption.match(/Source details/g) ?? []).length, 1);
  assert.equal((caption.match(/Captured patch/g) ?? []).length, 1);
  assert.equal((caption.match(/orion-code/g) ?? []).length, 1);
  assert.doesNotMatch(caption, /Quoted passage|Attempt facts|Source excerpt/);
  assert.match(
    html,
    /<blockquote><pre>\{&quot;truncated&quot;:true\}<\/pre><\/blockquote>/,
  );
  assert.match(
    html,
    /<summary>Source excerpt<\/summary><pre>\+ visibleChange\(\);<\/pre>/,
  );
});

test("consent source-details disclosure preserves exact metadata separately from excerpts", () => {
  const html = renderToStaticMarkup(
    createElement(SupportSourceDetailsPreview, {
      details: [
        {
          sourceId: "source",
          label: "Captured patch",
          text: '{"provenance":"Final Git diff","truncated":true}',
        },
      ],
    }),
  );
  assert.match(html, /<details class="support-source-details-preview">/);
  assert.match(html, /Source details sent for review/);
  assert.match(html, /1 source/);
  assert.match(html, /<summary>Captured patch<\/summary>/);
  assert.match(
    html,
    /<pre>\{&quot;provenance&quot;:&quot;Final Git diff&quot;,&quot;truncated&quot;:true\}<\/pre>/,
  );
  assert.doesNotMatch(html, /Source excerpt|Attempt facts/);
});


test("task passages display as shared requirements and reject attempt attribution", () => {
  const support = available(["unsupported", "supported", "supported"]);
  const passage = { sourceId: null, attemptKey: "", kind: "task_context", label: "Task requirements", quote: "Preserve compatibility." };
  support.review!.findings[0].issues = [{claim: "Compatibility was not requested.", explanation: "The task explicitly requests it.", sourceIds: [], passages: [passage]}];
  const html = renderSupport(support);
  assert.match(html, /Task requirements/);
  assert.match(html, /Preserve compatibility/);
  assert.doesNotMatch(html, /<summary>Source excerpt<\/summary>/);
  passage.attemptKey = "attempt-a";
  assert.match(renderSupport(support), /Unreviewed draft/);
});

test("local withholding is labeled separately from the preserved AI assessment", () => {
  const support = available(["needs_review", "supported", "supported"]);
  support.review!.findings[0].claims = [{unitId:"f0:summary", field:"summary", text:"Claim", verdict:"needs_review", reason:"A complete file is unavailable.", passages:[],
    providerAssessment:{verdict:"supported", reason:"The original provider accepted this."},
    localCheck:{version:"import-facts-v1", kind:"named_import", status:"unknown", reason:"A complete file is unavailable.", factIds:[]}}];
  const html = renderSupport(support);
  assert.match(html, /Local evidence check · Needs review/);
  assert.match(html, /Original AI assessment: supported/);
  assert.match(html, /The original provider accepted this/);
  assert.equal((html.match(/class="finding-card"/g) ?? []).length, 2);
});

test("matched import facts expose their saved declaration and source identity on demand", () => {
  const support = available(["supported", "supported", "supported"]);
  support.review!.importFacts = {version:"import-facts-v1", facts:[{id:"fact-one", sourceId:"saved-file", sourceSha256:"frozen-hash", attemptKey:"north", path:"src/entry.ts", imported:"limit", local:"limit", module:"./policy", importKind:"value", line:4, declaration:'import { limit } from "./policy";'}]};
  support.review!.findings[0].claims = [{unitId:"f0:summary", field:"summary", text:"Claim", verdict:"supported", reason:"Provider assessment", passages:[],
    providerAssessment:{verdict:"supported", reason:"Provider assessment"},
    localCheck:{version:"import-facts-v1", kind:"named_import", status:"matched", reason:"Only import presence was matched.", factIds:["fact-one"]}}];
  const html = renderSupport(support);
  assert.match(html, /<details[^>]*><summary>Matched import facts<\/summary>/);
  assert.match(html, /src\/entry.ts:4 · north/);
  assert.match(html, /import \{ limit \}/);
  assert.match(html, /frozen-hash/);
});

test("claim observation labels follow attempt identity after display reordering", () => {
  const support = available(["needs_review"]);
  support.review!.findings[0].claims = [Object.assign({unitId:"f0:observation:0", field:"sides[0].observation", text:"South observation text", verdict:"needs_review" as const, reason:"Inspect this relationship", passages:[]}, {attemptKey:"south"})];
  const shown = [{...findings[0], sides:[
    {attemptKey:"north", model:"North model", observation:"North text", sources:[]},
    {attemptKey:"south", model:"South model", observation:"South text", sources:[]},
  ]}] as ComparisonFinding[];
  const html = renderSupport(support, [], shown);
  assert.match(html, /<span>South model observation<\/span>/);
  assert.doesNotMatch(html, /<span>North model observation<\/span>/);
});
