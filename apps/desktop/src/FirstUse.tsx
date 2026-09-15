import { useState } from "react";
import {
  ArrowRight,
  FileInput,
  GitCompareArrows,
  ScanSearch,
  Check,
  Info,
} from "lucide-react";
import { Button, Logo } from "./ui";
import { LiveSetup } from "./LiveSetup";

export function Welcome({
  onExample,
  onOwn,
}: {
  onExample: () => void;
  onOwn: () => void;
}) {
  return (
    <div className="first-use welcome-page">
      <div className="welcome-mark">
        <Logo />
      </div>
      <div className="eyebrow">WELCOME TO AGENTLENS</div>
      <h1>
        See what makes
        <br />
        agents different.
      </h1>
      <p className="first-use-lead">
        Give two coding agents the same task. Understand how their results and
        approaches compare, with evidence you can explore.
      </p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={onExample}>
          Explore an example <ArrowRight size={17} />
        </Button>
        <Button variant="ghost" onClick={onOwn}>
          Compare your own agents
        </Button>
      </div>
      <p className="welcome-reassurance">
        A real recorded task. No setup or API key needed.
      </p>
      <div className="welcome-preview" aria-label="What you will explore">
        <div className="welcome-preview-heading">
          <span>
            <GitCompareArrows size={17} /> Inside the example
          </span>
          <span>Sol + Terra</span>
        </div>
        <h2>
          Both passed the checks.
          <br />
          They got there differently.
        </h2>
        <p>
          See how two agents solved the same problem, what they tested, and how
          they handled a blocked check.
        </p>
        <ol className="welcome-steps">
          <li>
            <span>1</span>Understand the result
          </li>
          <li>
            <span>2</span>Explore a difference
          </li>
          <li>
            <span>3</span>See the evidence
          </li>
        </ol>
      </div>
    </div>
  );
}

export function OwnComparison({
  onExample,
  onOpen,
  onLive,
}: {
  onExample: () => void;
  onOpen: () => void;
  onLive: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = typeof window !== "undefined" && !!window.agentlens;
  async function open() {
    if (!window.agentlens || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.agentlens.openInsightPair();
      if (!result.ok) throw Error("invalid");
      if (!result.cancelled) onOpen();
    } catch {
      setError(
        "We couldn’t open that comparison. Choose an AgentLens comparison JSON file with two saved attempts.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="first-use own-comparison-page">
      <div className="eyebrow">YOUR COMPARISON</div>
      <h1>New comparison</h1>
      <p className="first-use-lead">
        Choose a project and a task. Watch two agents work independently, then
        compare their results.
      </p>
      <LiveSetup onStarted={onLive} />
      <details className="first-use-help live-import">
        <summary>Already have recorded work?</summary>
        <div className="own-comparison-card">
          <FileInput size={27} />
          <h2>Open a saved comparison</h2>
          <p>
            Choose an AgentLens comparison JSON file containing both attempts
            and their recorded evidence. Opening it makes it the current
            comparison in this workspace.
          </p>
          {desktop ? (
            <Button
              variant="primary"
              onClick={() => void open()}
              disabled={busy}
            >
              {busy ? "Opening comparison…" : "Choose comparison file"}{" "}
              <ArrowRight size={16} />
            </Button>
          ) : (
            <p className="first-use-notice">
              <Info size={17} /> File import is available in the AgentLens
              desktop app. You can explore the example here without setup.
            </p>
          )}
          {error && (
            <p className="first-use-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="ghost" onClick={onOpen} disabled={busy}>
            Open current workspace <ArrowRight size={15} />
          </Button>
          <div className="own-comparison-benefits">
            <p>
              <Check size={15} /> View recorded results without an API key.
            </p>
            <p>
              <ScanSearch size={15} /> Add AI analysis later using your own
              compatible provider.
            </p>
          </div>
        </div>
      </details>
      <Button variant="ghost" onClick={onExample}>
        Explore the example first <ArrowRight size={16} />
      </Button>
    </div>
  );
}
