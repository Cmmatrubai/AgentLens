import test from "node:test";
import assert from "node:assert/strict";
import { analyzeOpenAI } from "../server/insights/provider.mjs";
const bundle = {
  inputHash: "hash",
  task: { title: "Task" },
  attempts: [],
  sources: [
    {
      id: "ev-1",
      excerpt: "safe selected excerpt",
      fullSource: "not selected private remainder",
    },
  ],
  coverage: {},
};
test("provider sends only selected evidence, no tools and no response storage", async () => {
  const r = await analyzeOpenAI({
    bundle,
    model: "user-model",
    apiKey: "test-secret",
    fetchImpl: async (url, opts) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const b = JSON.parse(opts.body);
      assert.equal(b.store, false);
      assert.deepEqual(b.tools, []);
      assert.equal(b.model, "user-model");
      assert.equal(b.text.format.strict, true);
      assert.equal(opts.redirect, "error");
      assert.ok(!opts.body.includes("not selected private remainder"));
      return new Response(
        JSON.stringify({
          id: "resp-1",
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: '{"findings":[],"abstentionReason":"No supported differences."}',
                },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
      );
    },
  });
  assert.equal(r.output.abstentionReason, "No supported differences.");
  assert.equal(r.usage.total_tokens, 30);
});
test("provider refusal, incomplete output and errors cannot become findings or leak response text", async () => {
  for (const response of [
    new Response("test-secret provider details", { status: 401 }),
    new Response(JSON.stringify({ status: "incomplete", output: [] })),
    new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "private" }],
          },
        ],
      }),
    ),
    new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "not JSON" }],
          },
        ],
      }),
    ),
  ]) {
    await assert.rejects(
      analyzeOpenAI({
        bundle,
        model: "user-model",
        apiKey: "test-secret",
        fetchImpl: async () => response,
      }),
      (e) =>
        !String(e).includes("test-secret") && !String(e).includes("private"),
    );
  }
});
test("large source metadata is bounded before any network request", async () => {
  let calls = 0;
  await assert.rejects(
    analyzeOpenAI({
      bundle: { ...bundle, task: { prompt: "x".repeat(220000) } },
      model: "user-model",
      apiKey: "test-secret",
      fetchImpl: async () => {
        calls++;
        return new Response("{}");
      },
    }),
    /analysis_input_too_large/,
  );
  assert.equal(calls, 0);
});

test("every provider mode requests short findings without changing selected evidence", async () => {
  for (const apiFormat of ["responses", "chat_completions"]) {
    for (const outputFormat of [
      "json_schema",
      "json_object",
      "prompted_json",
    ]) {
      let sentBody;
      await analyzeOpenAI({
        bundle,
        model: "user-model",
        apiFormat,
        outputFormat,
        fetchImpl: async (_url, opts) => {
          sentBody = JSON.parse(opts.body);
          const isChat = apiFormat === "chat_completions";
          const answer =
            '{"findings":[],"abstentionReason":"No supported differences."}';
          return new Response(
            JSON.stringify(
              isChat
                ? {
                    choices: [
                      { finish_reason: "stop", message: { content: answer } },
                    ],
                  }
                : {
                    status: "completed",
                    output: [
                      {
                        type: "message",
                        content: [{ type: "output_text", text: answer }],
                      },
                    ],
                  },
            ),
          );
        },
      });
      const isChat = apiFormat === "chat_completions";
      const instructions = isChat
        ? sentBody.messages[0].content
        : sentBody.instructions;
      const suppliedSchema =
        outputFormat === "json_schema"
          ? isChat
            ? sentBody.response_format.json_schema.schema
            : sentBody.text.format.schema
          : JSON.parse(
              instructions.slice(instructions.indexOf('{"type":"object"')),
            );
      assert.equal(
        suppliedSchema.properties.findings.items.properties.summary.maxLength,
        280,
      );
      const evidence = JSON.parse(
        isChat ? sentBody.messages[1].content : sentBody.input[0].content,
      );
      assert.deepEqual(evidence.sources, [
        { id: "ev-1", excerpt: "safe selected excerpt" },
      ]);
      assert.equal(evidence.inputHash, bundle.inputHash);
    }
  }
});
