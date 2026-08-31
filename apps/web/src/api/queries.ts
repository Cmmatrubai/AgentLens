import { createContext, createElement, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AgentLensApiClient, RunListQueryV1 } from "./client.js";
import { queryKeys } from "./queryKeys.js";

const ApiClientContext = createContext<AgentLensApiClient | null>(null);

export function ApiClientProvider(props: Readonly<{
  client: AgentLensApiClient;
  children: ReactNode;
}>) {
  return createElement(ApiClientContext.Provider, { value: props.client }, props.children);
}

export function useAgentLensApi(): AgentLensApiClient {
  const client = useContext(ApiClientContext);
  if (client === null) throw new Error("AgentLens API client is unavailable.");
  return client;
}

export function useRunList(query: RunListQueryV1) {
  const client = useAgentLensApi();
  return useQuery({
    queryKey: queryKeys.runs(query),
    queryFn: ({ signal }) => client.listRuns(query, signal)
  });
}
