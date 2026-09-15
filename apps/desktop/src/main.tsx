import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import "./first-use.css";
import "./live-workspace.css";
import "./model-picker.css";
import "./live-checks.css";
import "./insights.css";
const { default: App } = import.meta.env.MODE === 'demo'
  ? await import('./PublicDemoApp')
  : await import('./App');
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
