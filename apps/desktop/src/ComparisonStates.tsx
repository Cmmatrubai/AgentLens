import { FileInput, Info } from "lucide-react";
import { Button } from "./ui";

export function MissingCheckResults({
  canImport,
  busy,
  onImport,
  onVerify,
}: {
  canImport: boolean;
  busy: boolean;
  onImport: () => void;
  onVerify?: () => void;
}) {
  return (
    <div className="comparison-missing-checks">
      <Info size={18} aria-hidden="true" />
      <div>
        <h3>No check results yet</h3>
        <p>
          These recordings show what the agents did. To assess the result,
          evaluate both attempts against the same success conditions.
        </p>
        {onVerify && <Button small variant="primary" onClick={onVerify}>Run a check on both attempts</Button>}
        {canImport ? (
          <>
            <Button small disabled={busy} onClick={onImport}>
              <FileInput size={15} /> Open evaluated comparison
            </Button>
            <p className="comparison-import-note">
              Already have results? Choose an AgentLens comparison bundle with
              its check evidence. This opens the supplied comparison; your
              original recordings stay saved.
            </p>
          </>
        ) : (
          <p>
            Open an evaluated comparison bundle in the desktop app to inspect
            supplied check evidence.
          </p>
        )}
      </div>
    </div>
  );
}
