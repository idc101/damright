import React, { useState, useRef, useCallback } from "react";
import { TimelineYear } from "../../utils/timeline";
import "./TimelineScrubber.css";

interface TimelineScrubberProps {
  years: TimelineYear[];
  onScrub: (index: number) => void;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  years,
  onScrub,
}) => {
  const railRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [indicatorTop, setIndicatorTop] = useState<number>(0);

  // Filter out undated if empty or handle properly
  const validYears = years.filter((y) => y.count > 0);

  const calculateTarget = useCallback(
    (clientY: number) => {
      if (!railRef.current || validYears.length === 0) return;
      const rect = railRef.current.getBoundingClientRect();
      const relativeY = clientY - rect.top;
      const clampedY = Math.max(0, Math.min(relativeY, rect.height));
      const percentage = clampedY / rect.height;

      // Index in validYears
      const yearIdx = Math.min(
        Math.floor(percentage * validYears.length),
        validYears.length - 1
      );
      const targetYear = validYears[yearIdx];

      if (targetYear) {
        setActiveLabel(targetYear.label);
        setActiveCount(targetYear.count);
        setIndicatorTop(clampedY);
        onScrub(targetYear.startIndex);
      }
    },
    [validYears, onScrub]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsScrubbing(true);
    calculateTarget(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isScrubbing) return;
    e.preventDefault();
    calculateTarget(e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isScrubbing) return;
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
    setIsScrubbing(false);
    setActiveLabel(null);
    setActiveCount(null);
  };

  if (validYears.length <= 1) {
    return null;
  }

  return (
    <div
      ref={railRef}
      className={`timeline-scrubber-rail ${isScrubbing ? "scrubbing" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      title="Drag to fast-scrub timeline"
    >
      <div className="timeline-scrubber-track">
        {validYears.map((y, idx) => {
          const isFirstOrLast = idx === 0 || idx === validYears.length - 1;
          const showFullLabel = validYears.length <= 8 || isFirstOrLast || idx % 2 === 0;
          const displayLabel = y.year !== null
            ? showFullLabel
              ? String(y.year).slice(-2)
              : "•"
            : "?";

          return (
            <div
              key={y.label}
              className={`timeline-scrubber-node ${showFullLabel ? "has-label" : "is-dot"}`}
            >
              <span>{displayLabel}</span>
            </div>
          );
        })}
      </div>

      {isScrubbing && activeLabel && (
        <div
          className="timeline-scrubber-bubble"
          style={{ top: `${indicatorTop}px` }}
        >
          <span className="bubble-year">{activeLabel}</span>
          {activeCount !== null && (
            <span className="bubble-count">
              {activeCount.toLocaleString()} {activeCount === 1 ? "item" : "items"}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
