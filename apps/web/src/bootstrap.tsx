import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource-variable/geist-mono/wght.css";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/run-list.css";
import "./styles/trajectory.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { createAgentLensApiClient } from "./api/client.js";
import { App } from "./app/App.js";

export function boot(bearerToken: string | null): void {
  const rootElement = document.getElementById("root");
  if (rootElement === null) return;
  if (bearerToken === null) {
    createRoot(rootElement).render(
      <StrictMode>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <App client={null} />
        </BrowserRouter>
      </StrictMode>
    );
    return;
  }

  const client = createAgentLensApiClient({
    origin: window.location.origin,
    bearerToken
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof Error && error.name === "AgentLensClientError") return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: false
      }
    }
  });
  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <QueryClientProvider client={queryClient}>
          <App client={client} />
        </QueryClientProvider>
      </BrowserRouter>
    </StrictMode>
  );
}
