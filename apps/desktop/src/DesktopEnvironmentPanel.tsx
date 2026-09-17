import { useEffect, useState } from "react";
import type { DesktopEnvironment } from "./live-types";
import { Button } from "./ui";
export function DesktopEnvironmentPanel() {
  const api =
    typeof window !== "undefined"
      ? window.agentlens?.readDesktopEnvironment
      : undefined;
  const [value, setValue] = useState<DesktopEnvironment | null>(null),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!api) return;
    let active = true;
    setLoading(true);
    setError(false);
    api()
      .then((r) => {
        if (!active) return;
        if (r.ok) setValue(r.environment);
        else setError(true);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);
  if (!api) return null;
  return (
    <section className="desktop-environment" aria-label="Desktop setup">
      <h3>On this device</h3>
      {loading && <p role="status">Checking local setup…</p>}
      {error && (
        <p role="alert">
          Setup details could not be read. Your existing data has not been
          changed.
        </p>
      )}
      {value && (
        <>
          <p className="environment-build">
            {value.packaged ? "Installed application" : "Development build"}
          </p>
          <h4>Saved data</h4>
          <p>
            {value.storage.mode === "existing-location"
              ? "Using your existing data folder to preserve recordings and working copies. Keep this folder available."
              : "Recordings, checks, and analysis are stored in the application data folder."}
          </p>
          <code className="environment-path">{value.storage.root}</code>
          <details>
            <summary>Required tools</summary>
            <p>
              Detected versions do not confirm model access or sign-in. Use
              Check setup before starting a comparison.
            </p>
            <ul>
              {value.tools.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>{t.label}</strong>
                    <span>
                      {t.status === "detected"
                        ? t.version
                        : t.status === "unsupported"
                          ? "Version needs attention"
                          : "Not available"}
                    </span>
                  </div>
                  <p>{t.purpose}</p>
                  {t.status !== "detected" && <p>{t.help}</p>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <Button
        small
        variant="ghost"
        disabled={loading}
        onClick={() => setRevision((v) => v + 1)}
      >
        Check again
      </Button>
    </section>
  );
}
