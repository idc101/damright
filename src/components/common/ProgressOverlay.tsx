import { Loader2 } from "lucide-react";
import { Progress } from "../../types";

interface ProgressOverlayProps {
  importing: boolean;
  progress: Progress | null;
  title?: string;
}

export function ProgressOverlay({ importing, progress, title = "Importing Photos..." }: ProgressOverlayProps) {
  if (!importing) return null;

  return (
    <div className="progress-overlay" data-testid="progress-overlay">
      <div className="progress-card">
        <Loader2 className="spinner" size={32} />
        <h3>{title}</h3>
        {progress ? (
          <>
            <p>{progress.message}</p>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                }}
              />
            </div>
            <span>
              {progress.current} / {progress.total}
            </span>
          </>
        ) : (
          <p>Preparing files...</p>
        )}
      </div>
    </div>
  );
}
