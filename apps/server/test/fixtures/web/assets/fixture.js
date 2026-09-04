export function boot(token) {
  globalThis.__AGENTLENS_TEST_BOOT__?.(token);
}
