# Connect an OpenAI-compatible endpoint

In the Electron desktop app, open **Comparison → Generated insights → Settings**.

1. Set **API base URL** to the server's API prefix, for example `https://your-provider.example/v1` or `http://127.0.0.1:1234/v1`. These are examples, not configured services. Do not append `/chat/completions` or `/responses`; AgentLens appends the selected route.
2. Enter the exact **Analysis model ID** served by that endpoint.
3. Enter that provider's **API key**, or select **This endpoint does not require an API key**. The latter omits the Authorization header.
4. Expand **API compatibility**. Changing the base URL selects **Chat Completions**; choose **Responses** if that is the API your server implements.
5. Select the server's **JSON output support**: **JSON schema** requests strict structured output; **JSON object** requests JSON mode; **Prompted JSON** sends the schema in the prompt without a response-format field. AgentLens validates the same output shape and evidence references in every mode.
6. Enable analysis and save. Review the destination and selected evidence with **Preview & generate**, then explicitly start the request.

An OpenAI-issued key is not required for another provider. Remote endpoints must use HTTPS. HTTP is accepted only for localhost, 127.0.0.1 and ::1. Redirects are rejected. URL credentials, query strings and fragments are rejected.

Keys are encrypted using the desktop OS's protection and associated with the complete normalized base URL. Changing the endpoint requires its own key when authentication is enabled; a key saved for another destination is not reused. Selecting no-key mode removes the saved key. Settings saves do not contact the server.

The endpoint, request format, JSON mode and analysis model are recorded with each new analysis. Changes to provider settings invalidate cached results and require a new evidence review. Unsupported requests are shown as errors; AgentLens does not silently retry with another API or formatting mode. A server may still reject a particular model, parameter or schema despite advertising an OpenAI-compatible API. No model list is fetched automatically.

The Chat Completions adapter uses non-streaming requests and a 6,000-token output limit. Responses requests also set `store: false`; provider retention behavior is governed by the selected service. Analysis results and recordings remain saved locally, and the reviewed evidence is sent to the configured endpoint only when generation is started.

Request formats were checked against the [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Different implementations expose different capabilities; see, for example, [Ollama's compatibility documentation](https://docs.ollama.com/api/openai-compatibility). AgentLens's adapter has been verified with mock responses and an actual loopback HTTP test server. Live compatibility and finding quality with individual providers remain to be evaluated.

September 7 live test: TokenRouter authentication and one small structured completion succeeded. Its GLM-5.3 route did not finish the full C01 analysis within the tested token allowances, so full analysis compatibility is not yet accepted. See [the test report](../qa/insight-engine/TOKENROUTER-LIVE.md).
