// Versioned analysis for one preserved pair; not an automatic model judge.
export default {
  id: "C01-analysis-v1",
  comparisonId: "C01-20260906-sol-terra-high",
  manifestHash:
    "8f7aa61872a532d98fb593375fe40703f4070a211e4d542acb19d2386015d6aa",
  method: "AI-assisted analysis of this pair",
  attempts: [
    {
      key: "sol",
      runId: "8ab28f60-f273-4b9d-a2f2-96c59026aa82",
      snapshotHash:
        "93e9457ccab361ac442be7a2a70f13e27ec85fe1142c078c7ea8223bdc99f3d9",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      checks: [
        {
          id: "stdout-64mib",
          outcome: "pass",
          artifactSha256:
            "c961b91bc05cff501da16ccc6aaa42a12b317632ab64323d9cde7498b83087ba",
        },
        {
          id: "stderr-64mib",
          outcome: "pass",
          artifactSha256:
            "c961b91bc05cff501da16ccc6aaa42a12b317632ab64323d9cde7498b83087ba",
        },
        {
          id: "byte-limit-crlf",
          outcome: "pass",
          artifactSha256:
            "c961b91bc05cff501da16ccc6aaa42a12b317632ab64323d9cde7498b83087ba",
        },
        {
          id: "utf8-tail",
          outcome: "pass",
          artifactSha256:
            "c961b91bc05cff501da16ccc6aaa42a12b317632ab64323d9cde7498b83087ba",
        },
        {
          id: "backpressure",
          outcome: "pass",
          artifactSha256:
            "c961b91bc05cff501da16ccc6aaa42a12b317632ab64323d9cde7498b83087ba",
        },
        {
          id: "inherited-suite-with-declared-supplement",
          outcome: "pass",
          artifactSha256:
            "25c5b6775445384757752afe184b8e47f2bd048b09b0c114bb572a039a087925",
        },
        {
          id: "typecheck",
          outcome: "pass",
          artifactSha256:
            "0a4914d65b6aedd699a82a4f398eda6ca9e8c2a2646380b7f2c27f86cb2da458",
        },
      ],
    },
    {
      key: "terra",
      runId: "6e2db9e4-d6a1-44a8-b9bb-ec39e3caf181",
      snapshotHash:
        "80d11fc206988c921aabaf2f6e60cc42070dcc3d5845527e33774644bb90dcb2",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      checks: [
        {
          id: "stdout-64mib",
          outcome: "pass",
          artifactSha256:
            "682c87384132b164cdb6ba3cfecaa0597891920e9912336dce613f250801beea",
        },
        {
          id: "stderr-64mib",
          outcome: "pass",
          artifactSha256:
            "682c87384132b164cdb6ba3cfecaa0597891920e9912336dce613f250801beea",
        },
        {
          id: "byte-limit-crlf",
          outcome: "pass",
          artifactSha256:
            "682c87384132b164cdb6ba3cfecaa0597891920e9912336dce613f250801beea",
        },
        {
          id: "utf8-tail",
          outcome: "pass",
          artifactSha256:
            "682c87384132b164cdb6ba3cfecaa0597891920e9912336dce613f250801beea",
        },
        {
          id: "backpressure",
          outcome: "pass",
          artifactSha256:
            "682c87384132b164cdb6ba3cfecaa0597891920e9912336dce613f250801beea",
        },
        {
          id: "inherited-suite-with-declared-supplement",
          outcome: "pass",
          artifactSha256:
            "519215a2dbb4f2a899b014d405fc286b4041dd6976681d0bf6d4930b3af3839b",
        },
        {
          id: "typecheck",
          outcome: "pass",
          artifactSha256:
            "0a4914d65b6aedd699a82a4f398eda6ca9e8c2a2646380b7f2c27f86cb2da458",
        },
      ],
    },
  ],
  findings: [
    {
      id: "implementation",
      category: "Implementation",
      title: "Same result. Different structure.",
      summary:
        "Sol adapted the existing stream handler. Terra reorganized how records are read.",
      interpretation:
        "Sol keeps the familiar callback structure, with explicit queue and pause/resume handling. Terra expresses the read-and-wait sequence in one loop. These are different structures for a maintainer to review.",
      limitations:
        "Both passed the independent backpressure check. This code review does not establish which design is more maintainable or uses less memory.",
      sides: [
        {
          attemptKey: "sol",
          observation:
            "Paused incoming data while the queued record callbacks finished, then resumed the stream.",
          sources: [
            {
              id: "sol-stream-handling",
              kind: "file",
              path: "apps/cli/src/processRunner.ts",
              label: "Stream handling",
              artifactId:
                "650d9b2a38ae44e0aef0223fdb45b62f875f7bdfc9e2fce50e6436addd18d7b2",
              sha256:
                "831b5dd3e5ab45323ed98d3572b925989c94f8a2f54d7798a7483ff68e009b80",
              fromLine: 98,
              toLine: 112,
            },
          ],
        },
        {
          attemptKey: "terra",
          observation:
            "Used an async iterator and waited for each record before continuing through the stream.",
          sources: [
            {
              id: "terra-stream-handling",
              kind: "file",
              path: "apps/cli/src/processRunner.ts",
              label: "Stream handling",
              artifactId:
                "a6c57f3060c1b5c1239590ed130ada33184e15caf753667b33514a4a0a398b4a",
              sha256:
                "e708ac196d760a777017e24a6615a845f49e2f546e9b5da88e771456bdfe5284",
              fromLine: 102,
              toLine: 109,
            },
          ],
        },
      ],
    },
    {
      id: "testing",
      category: "Testing strategy",
      title: "Different kinds of test coverage.",
      summary:
        "Sol exercised a child process. Terra fed precise text boundaries directly into the reader.",
      interpretation:
        "Terra’s direct test controls exactly where a character is split across chunks. Sol’s test exercises the child-process path, where the OS may combine writes. The tests supply different kinds of evidence.",
      limitations:
        "These are agent-authored tests, separate from the shared independent evaluator. More tests or a different test style alone does not establish better code.",
      sides: [
        {
          attemptKey: "sol",
          observation:
            "Added a framing test that launches the child-process fixture and checks size limits, text, blank lines and final records.",
          sources: [
            {
              id: "sol-framing-test",
              kind: "file",
              path: "apps/cli/test/processRunner.test.ts",
              label: "Framing test",
              artifactId:
                "650d9b2a38ae44e0aef0223fdb45b62f875f7bdfc9e2fce50e6436addd18d7b2",
              sha256:
                "8fea673cd0fe0837cb5c2fad7c3945c8970e442b6e5307a487630a18b9ab5f99",
              fromLine: 50,
              toLine: 78,
            },
            {
              id: "sol-event-67",
              kind: "event",
              eventId: "d631fc82-169a-4cbc-884d-85d6a732dcb0",
              sequence: 67,
              label: "Recorded test run",
              sha256:
                "cc0c4a47a71b3cddb2ad360d3067f547ceeadc2177efb581db3a8568b5371627",
              fromLine: 1,
              toLine: 18,
            },
          ],
        },
        {
          attemptKey: "terra",
          observation:
            "Added a direct reader test with explicit slices inside a UTF-8 character and across a line ending.",
          sources: [
            {
              id: "terra-framing-test",
              kind: "file",
              path: "apps/cli/test/processRunner.test.ts",
              label: "Framing test",
              artifactId:
                "a6c57f3060c1b5c1239590ed130ada33184e15caf753667b33514a4a0a398b4a",
              sha256:
                "0cb8537c9d086f1bd1c281f0a4d01fdf8e4311d953c3f4ef59a8b99e15f670f1",
              fromLine: 25,
              toLine: 44,
            },
            {
              id: "terra-event-62",
              kind: "event",
              eventId: "67f4dee8-07f9-40ba-a720-8d3118143e06",
              sequence: 62,
              label: "Recorded test run",
              sha256:
                "b8d6e192d85a6be8ad2422a4dc112f94605a7b11f88da977a4acf842eaddf754",
              fromLine: 1,
              toLine: 14,
            },
          ],
        },
      ],
    },
    {
      id: "validation",
      category: "Handling a blocker",
      title: "A blocked check changed the workflow.",
      summary:
        "Sol got one recorder check running. Terra finished focused checks and disclosed the integration block.",
      interpretation:
        "Sol isolated an OS dependency in its new recorder test so that check could run in the restricted environment. Terra’s final report kept the integration limitation explicit. This shows how each attempt handled missing validation.",
      limitations:
        "The separate independent evaluator later passed both submissions. The agent-side command failures remain failures; these notes do not replace their exit status.",
      sides: [
        {
          attemptKey: "sol",
          observation:
            "After a blocked integration run, its focused recorder check passed with a test double for OS process identity.",
          sources: [
            {
              id: "sol-event-52",
              kind: "event",
              eventId: "e3a52dc5-2eb7-4013-badb-f7aab3bf2b0f",
              sequence: 52,
              label: "Focused recorder check",
              sha256:
                "e3ea896d5e0d59f7ed8dfb8d4c7063693feaf67454e5f23efc4300b93d1b5fa6",
              fromLine: 1,
              toLine: 12,
            },
            {
              id: "sol-test-dependency",
              kind: "file",
              path: "apps/cli/test/recordRun.integration.test.ts",
              label: "Test dependency",
              artifactId:
                "650d9b2a38ae44e0aef0223fdb45b62f875f7bdfc9e2fce50e6436addd18d7b2",
              sha256:
                "2841b4b9430cbba1eb42aab10fd609b3d6f1bc2ca528b5e9e5c3cf0726948294",
              fromLine: 17,
              toLine: 30,
            },
            {
              id: "sol-event-36",
              kind: "event",
              eventId: "725e2961-662c-4b4f-a08d-bab4fa50fce9",
              sequence: 36,
              label: "Blocked integration run",
              sha256:
                "1d3ba46ce97f7f26361d82bd8e55c046d48caba9409a1339a45927ab4bd2abec",
              fromLine: 4,
              toLine: 23,
            },
          ],
        },
        {
          attemptKey: "terra",
          observation:
            "Reported that recorder integration checks were blocked, while its focused process-runner and decoder checks passed.",
          sources: [
            {
              id: "terra-event-67",
              kind: "event",
              eventId: "d5301420-382a-40fb-99da-fa5c9ba370ec",
              sequence: 67,
              label: "Final agent report",
              sha256:
                "a49b9764475ee52dfbba77a834e60587586406791867c60d190dc00f941c2e99",
              fromLine: 1,
              toLine: 14,
            },
            {
              id: "terra-event-62",
              kind: "event",
              eventId: "67f4dee8-07f9-40ba-a720-8d3118143e06",
              sequence: 62,
              label: "Focused test run",
              sha256:
                "b8d6e192d85a6be8ad2422a4dc112f94605a7b11f88da977a4acf842eaddf754",
              fromLine: 1,
              toLine: 14,
            },
            {
              id: "terra-event-35",
              kind: "event",
              eventId: "3c16cf78-eef3-418e-a2ca-1f0950090038",
              sequence: 35,
              label: "Blocked integration run",
              sha256:
                "1ff2e776d3c85bcea6a93c5732b1405afe7759fb245efdf5c5e4f6c99806dc41",
              fromLine: 4,
              toLine: 23,
            },
          ],
        },
      ],
    },
  ],
};
