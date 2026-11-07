import React from "react";
import { TimelineYear, TimelineMonth } from "../../utils/timeline";
import { Photo } from "../../types";

interface TimelineMonthsViewProps {
  years: TimelineYear[];
  onSelectMonth: (month: TimelineMonth) => void;
  getAssetUrl: (path: string, isThumbnail?: boolean, version?: string) => string;
}

export const TimelineMonthsView: React.FC<TimelineMonthsViewProps> = ({
  years,
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

  const renderMonthCover = (coverPhotos: Photo[]) => {
    if (coverPhotos.length === 0) {
      return <div className="timeline-cover-placeholder" />;
    }

    if (coverPhotos.length === 1) {
      const p = coverPhotos[0];
      return (
        <img
          src={getAssetUrl(p.thumb_path || p.path, true)}
          alt={p.path}
          loading="lazy"
          className="timeline-cover-img"
        />
      );
    }

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
    <div className="timeline-months-container">
      {years.map((yearItem) => (
        <div key={yearItem.label} className="timeline-year-section">
          <div className="timeline-year-section-header">
            <h2 className="timeline-year-section-title">{yearItem.label}</h2>
            <span className="timeline-year-section-count">
              {yearItem.count.toLocaleString()} {yearItem.count === 1 ? "photo" : "photos"}
            </span>
          </div>

          <div className="timeline-months-grid">
            {yearItem.months.length === 0 ? (
              <div
                className="timeline-month-card"
                onClick={() =>
                  onSelectMonth({
                    key: yearItem.label,
                    year: yearItem.year || 0,
                    month: 0,
                    label: yearItem.label,
                    shortLabel: yearItem.label,
                    count: yearItem.count,
                    coverPhotos: yearItem.coverPhotos,
                    startIndex: yearItem.startIndex,
                  })
                }
              >
                <div className="timeline-month-media-wrapper">
                  {renderMonthCover(yearItem.coverPhotos)}
                  <div className="timeline-month-gradient-overlay" />
                  <div className="timeline-month-info">
                    <span className="timeline-month-title">{yearItem.label}</span>
                    <span className="timeline-month-count">{yearItem.count} items</span>
                  </div>
                </div>
              </div>
            ) : (
              yearItem.months.map((m) => (
                <div
                  key={m.key}
                  className="timeline-month-card"
                  onClick={() => onSelectMonth(m)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${m.label}, ${m.count} photos`}
                >
                  <div className="timeline-month-media-wrapper">
                    {renderMonthCover(m.coverPhotos)}
                    <div className="timeline-month-gradient-overlay" />
                    <div className="timeline-month-info">
                      <span className="timeline-month-title">{m.label}</span>
                      <span className="timeline-month-count">{m.count} items</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
