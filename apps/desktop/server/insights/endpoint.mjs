export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw Error("invalid_endpoint");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw Error("invalid_endpoint");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    value.includes("?") ||
    value.includes("#")
  )
    throw Error("invalid_endpoint");
  return url.href.replace(/\/+$/, "");
}
export function providerSettings(config) {
  const result = {
    baseUrl: normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL),
    apiFormat: config.apiFormat ?? "responses",
    outputFormat: config.outputFormat ?? "json_schema",
    authMode: config.authMode ?? "bearer",
    reasoningEffort:
      config.reasoningEffort === undefined ? "default" : config.reasoningEffort,
    maxOutputTokens:
      config.maxOutputTokens === undefined ? 6000 : config.maxOutputTokens,
    timeoutSeconds:
      config.timeoutSeconds === undefined ? 90 : config.timeoutSeconds,
  };
  if (
    !["responses", "chat_completions"].includes(result.apiFormat) ||
    !["json_schema", "json_object", "prompted_json"].includes(
      result.outputFormat,
    ) ||
    !["bearer", "none"].includes(result.authMode) ||
    !["default", "none", "low", "medium", "high", "max"].includes(
      result.reasoningEffort,
    ) ||
    !Number.isSafeInteger(result.maxOutputTokens) ||
    result.maxOutputTokens < 1000 ||
    result.maxOutputTokens > 32000 ||
    !Number.isSafeInteger(result.timeoutSeconds) ||
    result.timeoutSeconds < 30 ||
    result.timeoutSeconds > 300
  )
    throw Error("invalid_settings");
  return result;
}
