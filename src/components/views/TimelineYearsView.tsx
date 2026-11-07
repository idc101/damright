import React from "react";
import { TimelineYear, TimelineMonth } from "../../utils/timeline";
import { Photo } from "../../types";

interface TimelineYearsViewProps {
  years: TimelineYear[];
  onSelectYear: (year: TimelineYear) => void;
  onSelectMonth: (month: TimelineMonth) => void;
  getAssetUrl: (path: string, isThumbnail?: boolean, version?: string) => string;
}

export const TimelineYearsView: React.FC<TimelineYearsViewProps> = ({
  years,
  onSelectYear,
  onSelectMonth,
  getAssetUrl,
}) => {
  if (years.length === 0) {
    return (
      <div className="timeline-empty-state">
        <p>No photos in your library.</p>
      </div>
    );
  }

  const renderCoverCollage = (coverPhotos: Photo[]) => {
    if (coverPhotos.length === 0) {
      return <div className="timeline-cover-placeholder" />;
    }

    if (coverPhotos.length === 1) {
      const p = coverPhotos[0];
      return (
        <div className="timeline-cover-single">
          <img
            src={getAssetUrl(p.thumb_path || p.path, true)}
            alt={p.path}
            loading="lazy"
            className="timeline-cover-img"
          />
        </div>
      );
    }

    // 2, 3, or 4 photos collage
    const displayPhotos = coverPhotos.slice(0, 4);
    return (
      <div className={`timeline-cover-grid grid-${displayPhotos.length}`}>
        {displayPhotos.map((p) => (
          <img
            key={p.id}
            src={getAssetUrl(p.thumb_path || p.path, true)}
            alt={p.path}
            loading="lazy"
            className="timeline-cover-img"
          />
        ))}
      </div>
    );
  };

  return (
    <div className="timeline-years-container">
      <div className="timeline-years-grid">
        {years.map((yearItem) => (
          <div
            key={yearItem.label}
            className="timeline-year-card"
            onClick={() => onSelectYear(yearItem)}
            role="button"
            tabIndex={0}
            aria-label={`Year ${yearItem.label}, ${yearItem.count} photos`}
          >
            <div className="timeline-year-media-wrapper">
              {renderCoverCollage(yearItem.coverPhotos)}
              <div className="timeline-year-gradient-overlay" />
              <div className="timeline-year-header-badge">
                <span className="timeline-year-title">{yearItem.label}</span>
                <span className="timeline-year-count">
                  {yearItem.count.toLocaleString()} {yearItem.count === 1 ? "photo" : "photos"}
                </span>
              </div>
            </div>

            {yearItem.months.length > 0 && (
              <div className="timeline-year-months-strip">
                {yearItem.months.map((m) => (
                  <button
                    key={m.key}
                    className="timeline-month-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectMonth(m);
                    }}
                    title={`${m.label} (${m.count} photos)`}
                  >
                    {m.shortLabel}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
