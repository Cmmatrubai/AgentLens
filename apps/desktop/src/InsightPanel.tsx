import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  FileInput,
  History,
  Info,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  ComparisonFindings,
  FindingEvidenceDialog,
} from "./ComparisonFindings";
import type { ComparisonFinding, RealComparison } from "./comparison-types";
import type {
  InsightReadSuccess,
  InsightResponse,
  InsightState,
  InsightSettings,
} from "./insight-types";
import { Button, Modal } from "./ui";
import "./insights.css";

const POLL_MS = 1600;

const errorText: Record<string, string> = {
  analysis_not_configured:
    "Save a model ID, API key, and remote-analysis consent first.",
  analysis_start_failed: "The analysis job could not be started.",
  analysis_timeout:
    "The provider did not finish within the analysis time limit.",
  analysis_validation_failed:
    "The provider response could not be tied safely to the selected evidence.",
  api_key_required:
    "Enter an API key, or select that this endpoint requires no key.",
  credential_store_unavailable:
    "OS-backed credential encryption is unavailable.",
  desktop_required:
    "Open this comparison in the AgentLens desktop app to change analysis settings.",
  evidence_changed:
    "The comparison evidence changed. Review the new source preview before generating.",
  insufficient_evidence:
    "This comparison does not have enough eligible captured evidence.",
  invalid_key: "Enter a valid API key without spaces.",
  invalid_endpoint:
    "Use an HTTPS API base URL, or HTTP on localhost. Leave credentials, query parameters and fragments out of the URL.",
  endpoint_key_required:
    "Enter a key for this endpoint, or select that it does not require one. Your previously saved key will not be sent here.",
  settings_changed:
    "The analysis destination or settings changed. Review the current destination before generating.",
  provider_unsupported_request:
    "The endpoint rejected this request format or model. Check the base URL and model, or choose a different compatibility format in Settings.",
  invalid_comparison_bundle:
    "The selected file is not a supported comparison bundle.",
  ineligible_comparison_bundle:
    "This pair needs two compatible completed recordings with unique evidence identities.",
  invalid_comparison_disclosures:
    "Control notes and coverage limits must contain text entries.",
  analysis_input_too_large:
    "The selected evidence and metadata exceed the request size limit. No provider call was made.",
  invalid_request:
    "The generation request was rejected before a provider call.",
  invalid_settings: "Enter a valid provider model ID.",
  provider_authentication: "The provider rejected the saved API key.",
  provider_error: "The provider could not complete this analysis.",
  provider_incomplete: "The provider returned an incomplete analysis.",
  provider_invalid_response:
    "The provider response did not match the evidence-bound format.",
  provider_rate_limit: "The provider rate limit was reached.",
  provider_refused: "The provider declined to analyze this evidence.",
  provider_unreachable: "The provider could not be reached.",
  insight_operation_failed: "The desktop operation could not be completed.",
};

const explainError = (error: string | null | undefined) =>
  (error && errorText[error]) ||
  "Insight status is unavailable. Try reading it again.";

const formatDate = (value: number | null | undefined) =>
  Number.isFinite(value)
    ? new Date(value as number).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Time unavailable";

const formatState = (state: string) =>
  state.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

const shortHash = (hash: string) => (hash ? hash.slice(0, 12) : "unavailable");

const formatElapsed = (milliseconds: number | null) =>
  milliseconds === null
    ? "Elapsed unavailable"
    : `${Math.floor(milliseconds / 60000)}m ${Math.floor((milliseconds % 60000) / 1000)}s elapsed`;

function AnalysisMetadata({ insight }: { insight: InsightReadSuccess }) {
  const analysis = insight.analysis;
  if (!analysis) return null;
  const usage = analysis.usage
    ? Object.entries(analysis.usage)
        .filter(([, value]) => ["string", "number"].includes(typeof value))
        .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`)
        .join(" · ")
    : "Provider usage unavailable";
  return (
    <details className="insight-metadata">
      <summary>Analysis revision details</summary>
      <dl>
        <dt>Revision</dt>
        <dd>{analysis.id}</dd>
        <dt>Analysis model</dt>
        <dd>{analysis.model}</dd>
        <dt>API endpoint</dt>
        <dd>{analysis.baseUrl || "Legacy OpenAI endpoint"}</dd>
        <dt>Request format</dt>
        <dd>
          {analysis.apiFormat || "Responses"} ·{" "}
          {analysis.outputFormat || "JSON schema"}
        </dd>
        <dt>Created</dt>
        <dd>{formatDate(analysis.createdAt)}</dd>
        <dt>Evidence digest</dt>
        <dd>{shortHash(analysis.inputHash)}</dd>
        <dt>Analyzer</dt>
        <dd>{analysis.analyzerVersion || "Unavailable"}</dd>
        <dt>Prompt</dt>
        <dd>{analysis.promptVersion || "Unavailable"}</dd>
        <dt>Usage</dt>
        <dd>{usage}</dd>
      </dl>
    </details>
  );
}

function RevisionHistory({ insight }: { insight: InsightReadSuccess }) {
  if (!insight.history.length) return null;
  return (
    <details className="insight-history">
      <summary>
        <History size={13} /> Analysis history · {insight.history.length}
      </summary>
      <div>
        {insight.history.map((revision) => (
          <div className="insight-history-row" key={revision.id}>
            <span>{revision.model || "Model unavailable"}</span>
            <span>{formatState(revision.state)}</span>
            <span title={revision.id}>{shortHash(revision.id)}</span>
            <time dateTime={new Date(revision.createdAt).toISOString()}>
              {formatDate(revision.createdAt)}
            </time>
          </div>
        ))}
      </div>
    </details>
  );
}

function CoverageLimits({ insight }: { insight: InsightReadSuccess }) {
  if (
    !insight.input.coverage.limits.length &&
    !insight.input.coverage.omittedSources
  )
    return null;
  return (
    <div className="insight-limits">
      <Info size={14} />
      <div>
        <strong>Evidence limits</strong>
        {insight.input.coverage.omittedSources > 0 && (
          <p>
            {insight.input.coverage.omittedSources} of{" "}
            {insight.input.coverage.totalSources} candidate sources were omitted
            by the source or character limit.
          </p>
        )}
        {insight.input.coverage.limits.map((limit) => (
          <p key={limit}>{limit}</p>
        ))}
      </div>
    </div>
  );
}

export function InsightPanel({
  comparison,
  onComparisonChange,
}: {
  comparison: RealComparison;
  onComparisonChange: () => void | Promise<void>;
}) {
  const [insight, setInsight] = useState<InsightReadSuccess | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consented, setConsented] = useState(false);
  const [consentInput, setConsentInput] = useState<{
    inputHash: string;
    settingsHash: string;
  } | null>(null);
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiFormat, setApiFormat] =
    useState<InsightSettings["apiFormat"]>("responses");
  const [outputFormat, setOutputFormat] =
    useState<InsightSettings["outputFormat"]>("json_schema");
  const [authMode, setAuthMode] =
    useState<InsightSettings["authMode"]>("bearer");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [selectedFinding, setSelectedFinding] =
    useState<ComparisonFinding | null>(null);
  const requestGeneration = useRef(0);
  const comparisonEpoch = useRef(0);
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const comparisonKey = `${comparison.id}:${comparison.manifestHash}:${comparison.fetchedAt}:${comparison.attempts
    .map(
      (attempt) =>
        `${attempt.key}:${attempt.run?.id ?? ""}:${attempt.snapshotHash ?? ""}`,
    )
    .join("|")}`;

  const accept = useCallback(
    (response: InsightResponse) => {
      if (!response.ok) throw new Error(response.error);
      if (response.input.comparisonId !== comparison.id)
        throw new Error("evidence_changed");
      setInsight(response);
      setReadError(null);
      setSelectedFinding((current) =>
        current &&
        response.analysis?.findings.some((finding) => finding.id === current.id)
          ? (response.analysis.findings.find(
              (finding) => finding.id === current.id,
            ) ?? null)
          : null,
      );
      return response;
    },
    [comparison.id],
  );

  const read = useCallback(
    async (showLoading = false) => {
      const generation = ++requestGeneration.current;
      clearTimeout(poll.current);
      if (showLoading) setLoading(true);
      try {
        const response: InsightResponse = window.agentlens
          ? await window.agentlens.readInsights()
          : await fetch("/api/insights", {
              headers: { "X-AgentLens-Read": "1" },
              cache: "no-store",
            }).then((result) => result.json());
        if (generation !== requestGeneration.current) return;
        const current = accept(response);
        if (current.state === "running")
          poll.current = setTimeout(() => void read(), POLL_MS);
      } catch (error) {
        if (generation !== requestGeneration.current) return;
        setInsight(null);
        setSelectedFinding(null);
        setSettingsOpen(false);
        setConsentOpen(false);
        setApiKey("");
        setReadError(
          error instanceof Error ? error.message : "insight_state_unavailable",
        );
      } finally {
        if (generation === requestGeneration.current) setLoading(false);
      }
    },
    [accept],
  );

  useEffect(() => {
    comparisonEpoch.current += 1;
    requestGeneration.current += 1;
    clearTimeout(poll.current);
    setInsight(null);
    setSelectedFinding(null);
    setSettingsOpen(false);
    setConsentOpen(false);
    setApiKey("");
    setConsented(false);
    setActionBusy(false);
    setActionError(null);
    void read(true);
    return () => {
      comparisonEpoch.current += 1;
      requestGeneration.current += 1;
      clearTimeout(poll.current);
    };
  }, [comparisonKey, read]);

  const openSettings = () => {
    setBaseUrl(insight?.settings.baseUrl ?? "https://api.openai.com/v1");
    setApiFormat(insight?.settings.apiFormat ?? "responses");
    setOutputFormat(insight?.settings.outputFormat ?? "json_schema");
    setAuthMode(insight?.settings.authMode ?? "bearer");
    setModelId(insight?.settings.model ?? "");
    setEnabled(insight?.settings.enabled ?? false);
    setApiKey("");
    setActionError(null);
    setSettingsOpen(true);
  };

  useEffect(() => {
    setConsentOpen(false);
    setConsented(false);
    setConsentInput(null);
  }, [insight?.settingsHash, insight?.input.hash]);

  const closeSettings = () => {
    setApiKey("");
    setActionError(null);
    setSettingsOpen(false);
  };

  const saveSettings = async () => {
    if (!window.agentlens) return;
    const context = comparisonEpoch.current;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await window.agentlens.configureInsights({
        baseUrl: baseUrl.trim(),
        apiFormat,
        outputFormat,
        authMode,
        model: modelId.trim(),
        enabled,
        ...(apiKey && authMode === "bearer" ? { apiKey } : {}),
      });
      if (context !== comparisonEpoch.current) return;
      const current = accept(response);
      requestGeneration.current += 1;
      clearTimeout(poll.current);
      if (current.state === "running")
        poll.current = setTimeout(() => void read(), POLL_MS);
      setApiKey("");
      setModelId(current.settings.model);
      setEnabled(current.settings.enabled);
      setSettingsOpen(false);
    } catch (error) {
      if (context !== comparisonEpoch.current) return;
      setApiKey("");
      setActionError(
        explainError(error instanceof Error ? error.message : null),
      );
    } finally {
      if (context === comparisonEpoch.current) setActionBusy(false);
    }
  };

  const removeKey = async () => {
    if (!window.agentlens) return;
    const context = comparisonEpoch.current;
    setActionBusy(true);
    setActionError(null);
    try {
      const result = await window.agentlens.forgetInsightKey();
      if (context !== comparisonEpoch.current) return;
      const response = accept(result);
      requestGeneration.current += 1;
      clearTimeout(poll.current);
      if (response.state === "running")
        poll.current = setTimeout(() => void read(), POLL_MS);
      setApiKey("");
      setEnabled(response.settings.enabled);
    } catch (error) {
      if (context !== comparisonEpoch.current) return;
      setActionError(
        explainError(error instanceof Error ? error.message : null),
      );
    } finally {
      if (context === comparisonEpoch.current) setActionBusy(false);
    }
  };

  const beginGeneration = (regenerate = false) => {
    if (actionBusy) return;
    setActionError(null);
    if (!insight || insight.settings.desktopRequired || !window.agentlens) {
      setActionError("Generation is available in the AgentLens desktop app.");
      return;
    }
    if (
      !insight.settings.enabled ||
      (insight.settings.authMode !== "none" && !insight.settings.hasKey) ||
      !insight.settings.model
    ) {
      openSettings();
      return;
    }
    if (!insight.input.eligible) return;
    setConsented(false);
    setConsentInput({
      inputHash: insight.input.hash,
      settingsHash: insight.settingsHash,
    });
    setConsentOpen(true);
    pendingRegenerate.current = regenerate;
  };

  const pendingRegenerate = useRef(false);
  const generate = async () => {
    if (
      !window.agentlens ||
      !insight ||
      !consented ||
      !consentInput ||
      actionBusy
    )
      return;
    const context = comparisonEpoch.current;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await window.agentlens.generateInsights({
        settingsHash: consentInput.settingsHash,
        inputHash: consentInput.inputHash,
        requestId: crypto.randomUUID(),
        regenerate: pendingRegenerate.current,
      });
      if (context !== comparisonEpoch.current) return;
      const current = accept(response);
      requestGeneration.current += 1;
      clearTimeout(poll.current);
      setConsentOpen(false);
      setConsented(false);
      if (current.state === "running")
        poll.current = setTimeout(() => void read(), POLL_MS);
    } catch (error) {
      if (context !== comparisonEpoch.current) return;
      const code = error instanceof Error ? error.message : null;
      setActionError(explainError(code));
      setConsentOpen(false);
      setConsented(false);
      if (code === "evidence_changed" || code === "settings_changed") {
        setInsight(null);
        setSelectedFinding(null);
        await onComparisonChange();
      }
    } finally {
      if (context === comparisonEpoch.current) setActionBusy(false);
    }
  };

  const switchComparison = async (action: "open" | "original") => {
    if (!window.agentlens) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const response =
        action === "open"
          ? await window.agentlens.openInsightPair()
          : await window.agentlens.useOriginalComparison();
      if (!response.ok) throw new Error(response.error);
      if (response.cancelled) return;
      requestGeneration.current += 1;
      clearTimeout(poll.current);
      setInsight(null);
      setSelectedFinding(null);
      setSettingsOpen(false);
      setConsentOpen(false);
      setApiKey("");
      await onComparisonChange();
    } catch (error) {
      setActionError(
        explainError(error instanceof Error ? error.message : null),
      );
    } finally {
      setActionBusy(false);
    }
  };

  const generatedReview = useMemo<RealComparison["review"] | null>(
    () =>
      insight?.analysis
        ? {
            state: "available",
            id: insight.analysis.id,
            method: "Generated analysis",
            findings: insight.analysis.findings,
          }
        : null,
    [insight?.analysis],
  );

  const state: InsightState | "unavailable" = insight?.state ?? "unavailable";
  const desktopGeneration =
    !!window.agentlens && !insight?.settings.desktopRequired;
  const canGenerate =
    !!insight?.input.eligible &&
    state !== "running" &&
    desktopGeneration &&
    !actionBusy;

  return (
    <section className="insight-panel" aria-labelledby="insight-heading">
      <div className="insight-panel-heading">
        <div>
          <span className="insight-kicker">
            <Sparkles size={13} /> EVIDENCE-BOUND AI ANALYSIS
          </span>
          <h2 id="insight-heading">Generated insights</h2>
          <p>
            Interpretation stays separate from recorded facts and independent
            checks.
          </p>
        </div>
        <div className="insight-heading-actions">
          {window.agentlens && (
            <Button
              small
              variant="ghost"
              onClick={() => void switchComparison("open")}
              disabled={actionBusy}
            >
              <FileInput size={13} /> Open pair
            </Button>
          )}
          {window.agentlens && comparison.imported && (
            <Button
              small
              variant="ghost"
              onClick={() => void switchComparison("original")}
              disabled={actionBusy}
            >
              Use C01
            </Button>
          )}
          <Button small variant="ghost" onClick={openSettings}>
            <Settings2 size={13} /> Settings
          </Button>
        </div>
      </div>

      {loading && !insight ? (
        <div className="insight-state" role="status">
          <LoaderCircle className="spin" size={20} />
          <div>
            <h3>Reading saved analysis</h3>
            <p>No provider request is made by this read.</p>
          </div>
        </div>
      ) : readError || !insight ? (
        <div className="insight-state warning" role="alert">
          <AlertCircle size={20} />
          <div>
            <h3>Generated analysis is unavailable</h3>
            <p>{explainError(readError)}</p>
          </div>
          <Button small onClick={() => void read(true)}>
            Try again
          </Button>
        </div>
      ) : state === "running" ? (
        <div className="insight-state" role="status">
          <LoaderCircle className="spin" size={20} />
          <div>
            <h3>Analysis is running</h3>
            <p>
              {insight.settings.model} is reviewing the selected bounded
              excerpts. Recorded facts remain available below.
            </p>
          </div>
        </div>
      ) : state === "available" && generatedReview ? (
        <>
          <div className="insight-ready-line">
            <span>
              <Check size={14} /> Generated{" "}
              {formatDate(insight.analysis?.createdAt)}
            </span>
            <Button
              small
              variant="ghost"
              onClick={() => beginGeneration(true)}
              disabled={!desktopGeneration}
            >
              Regenerate
            </Button>
          </div>
          <ComparisonFindings
            review={generatedReview}
            onSelect={(id) =>
              setSelectedFinding(
                insight.analysis?.findings.find(
                  (finding) => finding.id === id,
                ) ?? null,
              )
            }
          />
          <AnalysisMetadata insight={insight} />
          <CoverageLimits insight={insight} />
        </>
      ) : state === "no_findings" ? (
        <div className="insight-result-stack">
          <div className="insight-state quiet">
            <Check size={20} />
            <div>
              <h3>No supported differences found</h3>
              <p>
                {insight.analysis?.abstentionReason ||
                  "The saved analysis abstained from making a comparative finding."}
              </p>
            </div>
            <Button
              small
              variant="ghost"
              onClick={() => beginGeneration(true)}
              disabled={!desktopGeneration}
            >
              Regenerate
            </Button>
          </div>
          <AnalysisMetadata insight={insight} />
          <CoverageLimits insight={insight} />
        </div>
      ) : state === "insufficient_evidence" ? (
        <div className="insight-state warning">
          <Info size={20} />
          <div>
            <h3>Not enough eligible evidence</h3>
            <p>
              {insight.input.reason ||
                "Both completed, compatible recordings are required."}
            </p>
          </div>
        </div>
      ) : state === "stale" ? (
        <div className="insight-state warning">
          <RefreshCw size={20} />
          <div>
            <h3>The saved analysis is stale</h3>
            <p>
              The evidence or analysis model changed. The prior revision remains
              in history; review the current sources before generating again.
            </p>
          </div>
          <Button
            small
            onClick={() => beginGeneration(true)}
            disabled={!canGenerate}
          >
            Generate current
          </Button>
        </div>
      ) : state === "failed" || state === "interrupted" ? (
        <div className="insight-state warning" role="alert">
          <AlertCircle size={20} />
          <div>
            <h3>
              {state === "interrupted"
                ? "Analysis was interrupted"
                : "Analysis did not complete"}
            </h3>
            <p>
              {state === "interrupted"
                ? "The saved job is no longer running. Starting again is a new explicit provider request."
                : explainError(insight.error)}
            </p>
          </div>
          <Button
            small
            onClick={() => beginGeneration(true)}
            disabled={!canGenerate}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="insight-state quiet">
          <Sparkles size={20} />
          <div>
            <h3>This pair has not been analyzed</h3>
            <p>
              {desktopGeneration
                ? "Review the evidence and destination before starting analysis."
                : "Open this comparison in AgentLens desktop to review evidence and generate insights."}
            </p>
          </div>
          <Button
            small
            variant="primary"
            onClick={() => beginGeneration(false)}
            disabled={!canGenerate}
          >
            {desktopGeneration ? "Preview & generate" : "Desktop required"}
          </Button>
        </div>
      )}

      {actionError && (
        <p className="insight-action-error" role="alert">
          {actionError}
        </p>
      )}
      {insight && <RevisionHistory insight={insight} />}

      <FindingEvidenceDialog
        finding={selectedFinding}
        onClose={() => setSelectedFinding(null)}
        analysisLabel="Generated analysis"
      />

      <Modal
        open={settingsOpen}
        onOpenChange={(open) =>
          open ? setSettingsOpen(true) : closeSettings()
        }
        title="Insight settings"
        description="API keys are encrypted locally with OS-backed protection."
        className="insight-settings-modal"
      >
        {insight?.settings.desktopRequired || !window.agentlens ? (
          <div className="dialog-inner insight-desktop-required">
            <Info size={19} />
            <div>
              <h3>Desktop app required</h3>
              <p>
                The browser preview can read saved results. Open AgentLens
                desktop to save a provider key, select another pair, or generate
                analysis.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="dialog-inner insight-settings-form">
              <div className="insight-provider-row">
                <span>Provider</span>
                <strong>OpenAI-compatible API</strong>
              </div>
              <label>
                <span>API base URL</span>
                <input
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    setApiKey("");
                    if (
                      event.target.value.replace(/\/+$/, "") !==
                      insight?.settings.baseUrl
                    )
                      setApiFormat("chat_completions");
                  }}
                  placeholder="https://your-provider.example/v1"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <small className="insight-field-help">
                  Include the API prefix, such as /v1. HTTPS for remote servers;
                  localhost can use HTTP.
                </small>
              </label>
              <label>
                <span>Analysis model ID</span>
                <input
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="Enter a model ID"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <label className="insight-enable-row">
                <input
                  type="checkbox"
                  checked={authMode === "none"}
                  onChange={(event) => {
                    setAuthMode(event.target.checked ? "none" : "bearer");
                    setApiKey("");
                  }}
                />
                <span>This endpoint does not require an API key</span>
              </label>
              <label>
                <span>
                  API key{" "}
                  {insight?.settings.hasKey &&
                    baseUrl.trim().replace(/\/+$/, "") ===
                      insight.settings.baseUrl &&
                    authMode === "bearer" && (
                      <em>Saved key will be kept if left blank</em>
                    )}
                </span>
                <input
                  type="password"
                  disabled={authMode === "none"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    authMode === "none"
                      ? "No key will be sent"
                      : insight?.settings.hasKey &&
                          baseUrl.trim().replace(/\/+$/, "") ===
                            insight.settings.baseUrl
                        ? "Encrypted key saved locally"
                        : "Enter API key"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <details className="insight-compatibility">
                <summary>API compatibility</summary>
                <label>
                  <span>Request API</span>
                  <select
                    value={apiFormat}
                    onChange={(event) =>
                      setApiFormat(
                        event.target.value as InsightSettings["apiFormat"],
                      )
                    }
                  >
                    <option value="chat_completions">Chat Completions</option>
                    <option value="responses">Responses</option>
                  </select>
                </label>
                <label>
                  <span>JSON output support</span>
                  <select
                    value={outputFormat}
                    onChange={(event) =>
                      setOutputFormat(
                        event.target.value as InsightSettings["outputFormat"],
                      )
                    }
                  >
                    <option value="json_schema">JSON schema</option>
                    <option value="json_object">JSON object</option>
                    <option value="prompted_json">
                      Prompted JSON (basic compatibility)
                    </option>
                  </select>
                </label>
                <p>
                  Use the format your server supports. AgentLens validates every
                  result and evidence link in all modes.
                </p>
              </details>
              <label className="insight-enable-row">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <span>
                  <strong>Enable analysis at this endpoint</strong>
                  <small>
                    The task, recorded facts, and selected excerpts are sent
                    only when you press Generate.
                  </small>
                </span>
              </label>
              <p className="insight-privacy-note">
                <KeyRound size={13} /> Saving these settings does not contact
                the provider. The key is encrypted locally with OS-backed
                protection and never stored in browser storage.
              </p>
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
            </div>
            <div className="dialog-footer insight-settings-footer">
              {insight?.settings.hasKey && (
                <Button
                  small
                  variant="ghost"
                  onClick={() => void removeKey()}
                  disabled={actionBusy}
                >
                  Remove saved key
                </Button>
              )}
              <span />
              <Button small variant="ghost" onClick={closeSettings}>
                Close
              </Button>
              <Button
                small
                variant="primary"
                onClick={() => void saveSettings()}
                disabled={actionBusy || !modelId.trim()}
              >
                {actionBusy ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={consentOpen}
        onOpenChange={(open) => {
          setConsentOpen(open);
          if (!open) setConsented(false);
        }}
        title="Review evidence sent for analysis"
        description={`Send the task, recorded facts and selected excerpts to ${insight?.settings.baseUrl || "your configured endpoint"} using ${insight?.settings.model || "your configured model"}.`}
        className="insight-consent-modal"
      >
        {insight && (
          <>
            <div className="insight-consent-body">
              <section className="insight-task-preview">
                <span>TASK PROVIDED TO THE ANALYZER</span>
                <h3>{comparison.title}</h3>
                <p>
                  {comparison.taskPrompt || "Task description unavailable."}
                </p>
                <details className="insight-input-identities">
                  <summary>Shared comparison identities</summary>
                  <dl>
                    <dt>Declared starting revision</dt>
                    <dd>{comparison.baseCommit}</dd>
                    <dt>Declared manifest</dt>
                    <dd>{comparison.manifestHash}</dd>
                    <dt>Task prompt SHA-256</dt>
                    <dd>{comparison.promptHash}</dd>
                    <dt>Independent check bundle</dt>
                    <dd>{comparison.checkBundleHash || "Not supplied"}</dd>
                    <dt>Declared time limit</dt>
                    <dd>
                      {comparison.timeoutMs
                        ? `${Math.round(comparison.timeoutMs / 60000)} minutes each`
                        : "Not supplied"}
                    </dd>
                  </dl>
                </details>
              </section>
              <div className="insight-facts-preview">
                {comparison.attempts.map((attempt) => (
                  <section key={attempt.key}>
                    <span>RECORDED ATTEMPT FACTS</span>
                    <h4>{attempt.model || attempt.key}</h4>
                    <p>
                      {attempt.reasoningEffort || "Reasoning unavailable"} ·{" "}
                      {formatElapsed(attempt.elapsedMs)} ·{" "}
                      {attempt.run?.commandCount ?? "Unknown"} commands ·{" "}
                      {attempt.run?.failedCommandCount ?? "Unknown"} failed
                    </p>
                    <p>
                      {attempt.checks.length
                        ? attempt.checks
                            .map((check) => `${check.title}: ${check.outcome}`)
                            .join(" · ")
                        : "No independent checks supplied"}
                    </p>
                    {!!attempt.controlNotes.length && (
                      <p>
                        Declared controls and provenance:{" "}
                        {attempt.controlNotes.join(" ")}
                      </p>
                    )}
                  </section>
                ))}
              </div>
              <div className="insight-preview-summary">
                <span>
                  {insight.input.coverage.includedSources} selected excerpts
                </span>
                <span>
                  {insight.input.coverage.characters.toLocaleString()}{" "}
                  characters
                </span>
                <span>
                  {insight.input.coverage.omittedSources} omitted candidates
                </span>
              </div>
              <div className="insight-source-preview">
                {insight.input.sources.length ? (
                  insight.input.sources.map((source) => {
                    const attempt = comparison.attempts.find(
                      (item) => item.key === source.attemptKey,
                    );
                    return (
                      <details key={source.id}>
                        <summary>
                          <span>
                            <strong>{source.provenance}</strong>
                            {source.label}
                          </span>
                          <span>{attempt?.model || source.attemptKey}</span>
                        </summary>
                        {source.path && (
                          <div className="insight-source-path">
                            {source.path}
                          </div>
                        )}
                        <pre>{source.excerpt}</pre>
                      </details>
                    );
                  })
                ) : (
                  <p className="insight-no-sources">
                    No source excerpts were selected.
                  </p>
                )}
              </div>
              <CoverageLimits insight={insight} />
              <label className="insight-consent-check">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                <span>
                  I reviewed these excerpts and want to send them for this
                  analysis request.
                </span>
              </label>
              <p className="insight-privacy-note">
                <Info size={13} /> Redacted capture does not guarantee that
                selected source text contains no proprietary information.
              </p>
            </div>
            <div className="dialog-footer">
              <Button
                small
                variant="ghost"
                onClick={() => {
                  setConsentOpen(false);
                  setConsented(false);
                }}
              >
                Back
              </Button>
              <Button
                small
                variant="primary"
                onClick={() => void generate()}
                disabled={!consented || actionBusy}
              >
                {actionBusy ? (
                  <>
                    <LoaderCircle size={13} className="spin" /> Starting…
                  </>
                ) : (
                  <>
                    Generate insights <ArrowRight size={13} />
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}
