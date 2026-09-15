import { useEffect, useRef, useState } from "react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Command } from "cmdk";
import {
  ArrowRight,
  BookOpen,
  FileSearch,
  FileCode2,
  Info,
  Search,
  ShieldCheck,
} from "lucide-react";
import { RealComparisonView } from "./RealComparisonView";
import { Logo, Modal } from "./ui";
import {
  publicDestination,
  publicDestinations,
  type PublicDestination,
} from "./public-demo-data";
import "./insights.css";
import "./public-demo.css";

const icons = { case: BookOpen, evidence: FileSearch, about: Info };
export default function PublicDemoApp() {
  const [destination, setDestination] = useState(() =>
    publicDestination(location.hash),
  );
  const [search, setSearch] = useState(false);
  const main = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    document.body.classList.add("public-demo-mode");
    const change = () => {
      const next = publicDestination(location.hash);
      if (location.hash !== `#/${next}`)
        history.replaceState(null, "", `#/${next}`);
      setDestination(next);
    };
    change();
    window.addEventListener("hashchange", change);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      document.body.classList.remove("public-demo-mode");
      window.removeEventListener("hashchange", change);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    document.title = `${publicDestinations.find((d) => d.id === destination)!.label} · AgentLens`;
    main.current?.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [destination]);
  const navigate = (id: PublicDestination) => {
    location.hash = `/${id}`;
    setSearch(false);
  };
  return (
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delayDuration={250}>
        <div className="demo-shell">
          <a
            className="skip-link"
            href="#demo-main"
            onClick={(event) => {
              event.preventDefault();
              main.current?.focus();
            }}
          >
            Skip to content
          </a>
          <header className="demo-header">
            <a
              className="demo-brand"
              href="#/case"
              aria-label="AgentLens case study"
            >
              <Logo />
              <strong>AgentLens</strong>
            </a>
            <nav aria-label="Main navigation">
              {publicDestinations.map((d) => (
                <a
                  href={`#/${d.id}`}
                  key={d.id}
                  aria-current={destination === d.id ? "page" : undefined}
                >
                  {d.label}
                </a>
              ))}
            </nav>
            <div className="demo-header-actions">
              <button
                onClick={() => setSearch(true)}
                aria-label="Quick navigation"
              >
                <Search size={18} />
                <kbd>⌘ K</kbd>
              </button>
              <a
                href="https://github.com/Cmmatrubai/AgentLens"
                target="_blank"
                rel="noreferrer"
                aria-label="AgentLens on GitHub"
              >
                <FileCode2 size={19} />
              </a>
            </div>
          </header>
          <main ref={main} tabIndex={-1} id="demo-main" className="demo-main">
            <motion.div
              key={destination}
              initial={reduced ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {destination === "about" ? (
                <AboutAgentLens />
              ) : (
                <RealComparisonView publicView={destination} />
              )}
            </motion.div>
            <footer className="demo-footer">
              <span>
                <ShieldCheck size={14} /> Real recordings. Authored case notes.
              </span>
              <a href="#/about">
                How to read this demo <ArrowRight size={14} />
              </a>
            </footer>
          </main>
          <Modal
            open={search}
            onOpenChange={setSearch}
            title="Go to…"
            description="Explore the recorded case and its evidence."
            className="demo-command-modal"
          >
            <Command label="Quick navigation">
              <Command.Input autoFocus placeholder="Find a page…" />
              <Command.List>
                <Command.Empty>No matching page.</Command.Empty>
                {publicDestinations.map((d) => {
                  const Icon = icons[d.id];
                  return (
                    <Command.Item
                      key={d.id}
                      value={`${d.label} ${d.description}`}
                      onSelect={() => navigate(d.id)}
                    >
                      <Icon size={18} />
                      <span>
                        <strong>{d.label}</strong>
                        <small>{d.description}</small>
                      </span>
                      <ArrowRight size={15} />
                    </Command.Item>
                  );
                })}
              </Command.List>
            </Command>
          </Modal>
        </div>
      </Tooltip.Provider>
    </MotionConfig>
  );
}

function AboutAgentLens() {
  return (
    <article className="page demo-about">
      <div className="eyebrow">ABOUT AGENTLENS</div>
      <h1>A model comparison you can inspect.</h1>
      <p className="demo-about-lead">
        Two agents can pass the same tests and still take different approaches.
        AgentLens connects the result to the work behind it, so you can decide
        what matters for your task.
      </p>
      <section>
        <h2>Start with a real engineering task.</h2>
        <p>
          In this case, two models worked from the same historical AgentLens
          revision to stop oversized output from overwhelming the recorder. Both
          used high reasoning and had the same 15-minute limit.
        </p>
        <p>
          Each submission passed seven independent checks. The case notes
          compare implementation structure, test coverage and how the agents
          handled blocked validation. One pair does not establish a general
          model ranking.
        </p>
        <a className="demo-text-link" href="#/case">
          Explore the case <ArrowRight size={16} />
        </a>
      </section>
      <section>
        <h2>Three kinds of evidence, kept separate.</h2>
        <dl className="demo-evidence-types">
          <div>
            <dt>Recorded work</dt>
            <dd>
              Captured commands, their exit statuses, agent messages and final
              file changes.
            </dd>
          </div>
          <div>
            <dt>Independent checks</dt>
            <dd>
              A separate evaluator tested both submissions against the same
              conditions. Its results stay separate from what an agent said it
              tested.
            </dd>
          </div>
          <div>
            <dt>Authored interpretation</dt>
            <dd>
              The case notes link to excerpts from both attempts and state their
              limits. They are authored explanations, not live AI output.
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <h2>Built around traceable evidence.</h2>
        <p>
          The desktop workspace reads preserved recordings and compares
          attempts. Its insight engine accepts an OpenAI-compatible endpoint and
          checks whether generated claims cite supplied evidence. Citation
          validation is implemented; reliably judging every claim’s meaning
          remains work in progress.
        </p>
        <p>
          This browser demo uses a fixed, selected snapshot. It does not run
          agents, call an AI service or require your API key.
        </p>
      </section>
      <details className="demo-snapshot-details">
        <summary>What is included in this public snapshot?</summary>
        <p>
          Selected code changes and recorded events linked by the three case
          notes, plus all fourteen independent check results. The original
          recording totals are retained for context; the full recording archives
          are not included.
        </p>
        <p>
          Local workspace and temporary paths have been replaced. Exported
          source text has new hashes, and the manifest records original
          provenance separately. Private settings, credentials, generated drafts
          and review history are excluded.
        </p>
        <p>
          The independent regression suite includes one declared correction to a
          historical test that conflicted with the requested size limit. Open
          comparison details to see the controls and coverage limits.
        </p>
        <a
          href={`${import.meta.env.BASE_URL}demo/manifest.json`}
          target="_blank"
          rel="noreferrer"
        >
          View the content manifest
        </a>
      </details>
      <a
        className="demo-github-link"
        href="https://github.com/Cmmatrubai/AgentLens"
        target="_blank"
        rel="noreferrer"
      >
        <FileCode2 size={19} />
        <span>
          Explore the source code
          <small>Recorder, evaluation contracts and desktop workspace</small>
        </span>
        <ArrowRight size={17} />
      </a>
    </article>
  );
}
