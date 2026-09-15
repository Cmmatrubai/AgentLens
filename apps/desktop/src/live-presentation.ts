import type { LiveState } from "./live-types";
export const liveTerminal = (state: LiveState) =>
  ["completed", "failed", "stopped", "timed_out", "interrupted"].includes(
    state,
  );
export const liveStateLabel: Record<LiveState, string> = {
  preparing: "Preparing workspace",
  running: "Recording",
  stopping: "Stopping safely",
  completed: "Recording complete",
  failed: "Needs attention",
  stopped: "Stopped",
  timed_out: "Time limit reached",
  interrupted: "Interrupted",
};
export const liveModelName = (model: string) =>
  model === "gpt-5.6-sol"
    ? "GPT Sol"
    : model === "gpt-5.6-terra"
      ? "GPT Terra"
      : model;
export function liveDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const messages: Record<string, string> = {
  workspace_storage_failed:
    "AgentLens could not save workspace updates. The agents were asked to stop. Check available disk space and folder permissions; existing evidence has been kept.",
  cleanup_unconfirmed:
    "The recorder stopped responding before process cleanup could be confirmed. Keep the app open and inspect the saved work. AgentLens will not claim this attempt stopped successfully.",
  invalid_git_project: "Choose a Git repository with at least one commit.",
  invalid_project: "Choose a project folder to continue.",
  invalid_project_selection: "Choose your project again before starting.",
  project_dirty:
    "This project has uncommitted changes. Commit the work you want both agents to start from, then choose the project again. AgentLens keeps your changes in place.",
  project_submodules:
    "This first release does not prepare Git submodules. Choose a project without submodules.",
  project_changed:
    "The project revision changed since you selected it. Choose it again to review the new starting point.",
  invalid_task: "Enter a shared task of up to 20,000 characters.",
  invalid_models: "Enter two valid Codex model IDs and reasoning settings.",
  invalid_identical_models:
    "Choose different models or reasoning settings so there is something to compare.",
  invalid_timeout: "Choose a time limit between 1 and 60 minutes per agent.",
  invalid_launch:
    "Review the launch details and acknowledge the two recorded runs.",
  codex_unavailable:
    "Codex CLI is not available to this app. Install Codex and reopen AgentLens from a terminal where codex works.",
  codex_update_required:
    "Update Codex CLI to a version with JSON recording, isolated configuration, and workspace sandbox support.",
  codex_login_required:
    "Sign in with codex login in your terminal, then check setup again.",
  recorder_runtime_unavailable:
    "The recorder runtime is unavailable. This development build needs Node and the AgentLens workspace dependencies installed.",
  comparison_busy:
    "Another comparison is starting or recording. Open the active workspace to follow it.",
  comparison_closing:
    "AgentLens is closing its recordings. Reopen the app before starting another comparison.",
  comparison_incomplete:
    "Both recordings must finish before opening a comparison. Partial activity remains available here.",
  invalid_job:
    "This saved workspace could not be found. Return to Your comparison and choose an available recording.",
  invalid_stop:
    "That attempt has already finished or is no longer the active recording.",
  recording_failed:
    "The recorder could not finish this attempt. Its working copy and any recorded evidence have been kept. Check Codex access and setup before starting a new comparison.",
  agent_failed:
    "The agent did not complete this run. Expand its recorded activity for details. The other agent can continue.",
  workspace_setup_failed:
    "AgentLens could not prepare both working copies. No comparison results were assumed; any created files have been kept.",
  recording_invalid:
    "The saved recording could not be verified against this starting revision.",
  app_interrupted:
    "The app closed before this attempt was finalized. Saved evidence is retained; this attempt has not been restarted.",
};
export const liveError = (code: string) =>
  messages[code] ??
  "AgentLens could not complete that operation. Your existing recordings have not been replaced. Try again or reopen this workspace.";
