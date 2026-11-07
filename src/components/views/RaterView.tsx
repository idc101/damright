import React, { useState, useEffect, useCallback, useMemo, memo } from "react";
import { Star, Sparkles, Check, ArrowRight, ArrowLeft, RefreshCw, Equal, LayoutGrid, Columns2, Filter } from "lucide-react";
import { Photo, RankingPair, RankingQuad, RankingStats } from "../../types";
import { ApiService } from "../../services/api";
import { PhotoPreview } from "../common/PhotoPreview";
import { loadAndCachePreview, getCachedPreviewUrl } from "../../utils/previewCache";
import "./RaterView.css";

type RaterMode = "quad" | "pair";

interface RaterViewProps {
  api: ApiService;
  searchQuery?: string;
  onPhotosUpdated?: () => void;
}

interface RaterCardProps {
  photo: Photo;
  api: ApiService;
  onVote: () => void;
  ariaLabel: string;
  testId: string;
  keyBadge?: string;
}

const renderStars = (rating: number, isSuggested: boolean = false) => {
  return (
    <span className={isSuggested ? "suggested-rating-badge" : "manual-rating-stars"}>
      {isSuggested && <Sparkles size={12} />}
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={12}
          fill={i < rating ? "currentColor" : "none"}
          color="currentColor"
        />
      ))}
    </span>
  );
};

const RaterCard: React.FC<RaterCardProps> = memo(({
  photo,
  api,
  onVote,
  ariaLabel,
  testId,
  keyBadge,
}) => {
  const cachedUrl = getCachedPreviewUrl(photo, false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(cachedUrl);

  useEffect(() => {
    let active = true;
    const cached = getCachedPreviewUrl(photo, false);
    if (cached) {
      setPreviewUrl(cached);
      return;
    }

    loadAndCachePreview(api, photo, false)
      .then((url) => {
        if (active) setPreviewUrl(url);
      })
      .catch((err) => {
        console.error(`Failed to load preview for photo ${photo.id}:`, err);
        if (active) setPreviewUrl(api.getAssetUrl(photo.path));
      });

    return () => {
      active = false;
    };
  }, [photo.id, photo.path, photo.exposure, photo.crop_top, photo.crop_left, photo.crop_bottom, photo.crop_right, photo.crop_angle, photo.portrait_blur, photo.orientation, api]);

  const effectiveSrc = previewUrl || cachedUrl || undefined;

  return (
    <button
      className="rater-card"
      onClick={onVote}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {keyBadge && <div className="rater-card-key-badge">{keyBadge}</div>}
      <div className="rater-image-wrapper">
        <PhotoPreview
          photo={photo}
          isThumbnail={false}
          src={effectiveSrc}
        />
      </div>
      <div className="rater-card-footer">
        <div className="rater-card-name" title={photo.path}>
          {photo.path.split(/[/\\]/).pop()}
        </div>
        <div className="rater-card-ratings">
          <div className="rating-badge">
            <span>Manual:</span>
            {renderStars(photo.rating)}
          </div>
          <div className="rating-badge">
            <span>Suggested:</span>
            {renderStars(
              photo.suggested_rating && photo.suggested_rating > 0
                ? photo.suggested_rating
                : 3,
              true
            )}
          </div>
        </div>
      </div>
    </button>
  );
});

export const RaterView: React.FC<RaterViewProps> = memo(({
  api,
  searchQuery,
  onPhotosUpdated,
}) => {
  const [mode, setModeState] = useState<RaterMode>(() => {
    const saved = localStorage.getItem("rater_mode");
    return saved === "pair" ? "pair" : "quad";
  });
  const [unratedOnly, setUnratedOnlyState] = useState<boolean>(() => {
    const saved = localStorage.getItem("rater_unrated_only");
    return saved !== null ? saved === "true" : true;
  });

  const [pair, setPair] = useState<RankingPair | null>(null);
  const [quad, setQuad] = useState<RankingQuad | null>(null);
  const [stats, setStats] = useState<RankingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const nextPairPromiseRef = React.useRef<Promise<RankingPair | null> | null>(null);
  const nextQuadPromiseRef = React.useRef<Promise<RankingQuad | null> | null>(null);

  const setMode = useCallback((newMode: RaterMode) => {
    setModeState(newMode);
    localStorage.setItem("rater_mode", newMode);
  }, []);

  const setUnratedOnly = useCallback((val: boolean) => {
    setUnratedOnlyState(val);
    localStorage.setItem("rater_unrated_only", String(val));
  }, []);

  const effectiveQuery = useMemo(() => {
    const base = searchQuery ? searchQuery.trim() : "";
    if (!unratedOnly) return base || undefined;
    if (/(\b|-)r(ating)?:/i.test(base)) {
      return base;
    }
    return base ? `${base} rating:0` : "rating:0";
  }, [searchQuery, unratedOnly]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await api.getRankingStats(effectiveQuery);
      setStats(s);
    } catch (err) {
      console.error("Failed to fetch ranking stats:", err);
    }
  }, [api, effectiveQuery]);

  // Pair Previews & Fetching
  const preloadPairPreviews = useCallback(async (p: RankingPair | null): Promise<RankingPair | null> => {
    if (!p) return null;
    try {
      await Promise.all([
        loadAndCachePreview(api, p.photo_a, false),
        loadAndCachePreview(api, p.photo_b, false),
      ]);
    } catch (err) {
      console.error("Failed to preload pair previews:", err);
    }
    return p;
  }, [api]);

  const prefetchNextPair = useCallback(() => {
    nextPairPromiseRef.current = (async () => {
      try {
        const p = await api.getRankingPair(effectiveQuery);
        return await preloadPairPreviews(p);
      } catch (err) {
        console.error("Failed to prefetch ranking pair:", err);
        return null;
      }
    })();
  }, [api, effectiveQuery, preloadPairPreviews]);

  const fetchPair = useCallback(async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) {
      setLoading(true);
    }
    try {
      let p: RankingPair | null = null;
      if (nextPairPromiseRef.current) {
        p = await nextPairPromiseRef.current;
        nextPairPromiseRef.current = null;
      } else {
        const rawPair = await api.getRankingPair(effectiveQuery);
        p = await preloadPairPreviews(rawPair);
      }
      setPair(p);
      if (p) {
        prefetchNextPair();
      }
    } catch (err) {
      console.error("Failed to fetch ranking pair:", err);
      setPair(null);
    } finally {
      setLoading(false);
    }
  }, [api, effectiveQuery, preloadPairPreviews, prefetchNextPair]);

  // Quad Previews & Fetching
  const preloadQuadPreviews = useCallback(async (q: RankingQuad | null): Promise<RankingQuad | null> => {
    if (!q) return null;
    try {
      await Promise.all(q.photos.map((photo) => loadAndCachePreview(api, photo, false)));
    } catch (err) {
      console.error("Failed to preload quad previews:", err);
    }
    return q;
  }, [api]);

  const prefetchNextQuad = useCallback(() => {
    nextQuadPromiseRef.current = (async () => {
      try {
        const q = await api.getRankingQuad(effectiveQuery);
        return await preloadQuadPreviews(q);
      } catch (err) {
        console.error("Failed to prefetch ranking quad:", err);
        return null;
      }
    })();
  }, [api, effectiveQuery, preloadQuadPreviews]);

  const fetchQuad = useCallback(async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) {
      setLoading(true);
    }
    try {
      let q: RankingQuad | null = null;
      if (nextQuadPromiseRef.current) {
        q = await nextQuadPromiseRef.current;
        nextQuadPromiseRef.current = null;
      } else {
        const rawQuad = await api.getRankingQuad(effectiveQuery);
        q = await preloadQuadPreviews(rawQuad);
      }
      setQuad(q);
      if (q) {
        prefetchNextQuad();
      }
    } catch (err) {
      console.error("Failed to fetch ranking quad:", err);
      setQuad(null);
    } finally {
      setLoading(false);
    }
  }, [api, effectiveQuery, preloadQuadPreviews, prefetchNextQuad]);

  useEffect(() => {
    if (mode === "quad") {
      nextQuadPromiseRef.current = null;
      setQuad(null);
      fetchQuad(true);
    } else {
      nextPairPromiseRef.current = null;
      setPair(null);
      fetchPair(true);
    }
    fetchStats();
  }, [mode, effectiveQuery, fetchQuad, fetchPair, fetchStats]);

  const handleVote = useCallback(async (winner: Photo, loser: Photo, isTie: boolean = false) => {
    if (voting || !pair) return;
    setVoting(true);

    try {
      await api.recordRankingMatch(winner.id, loser.id, isTie);
      await Promise.all([fetchPair(false), fetchStats()]);
      onPhotosUpdated?.();
    } catch (err) {
      console.error("Failed to record ranking match:", err);
    } finally {
      setVoting(false);
    }
  }, [voting, pair, api, fetchPair, fetchStats, onPhotosUpdated]);

  const handleQuadVote = useCallback(async (winnerIndex: number) => {
    if (voting || !quad || !quad.photos[winnerIndex]) return;
    setVoting(true);
    const winner = quad.photos[winnerIndex];
    const losers = quad.photos.filter((_, idx) => idx !== winnerIndex).map((p) => p.id);

    try {
      await api.recordRankingQuadMatch(winner.id, losers, false);
      await Promise.all([fetchQuad(false), fetchStats()]);
      onPhotosUpdated?.();
    } catch (err) {
      console.error("Failed to record ranking quad match:", err);
    } finally {
      setVoting(false);
    }
  }, [voting, quad, api, fetchQuad, fetchStats, onPhotosUpdated]);

  const handleQuadTie = useCallback(async () => {
    if (voting || !quad || quad.photos.length < 4) return;
    setVoting(true);
    const photoIds = quad.photos.map((p) => p.id);

    try {
      await api.recordRankingQuadMatch(null, photoIds, true);
      await Promise.all([fetchQuad(false), fetchStats()]);
      onPhotosUpdated?.();
    } catch (err) {
      console.error("Failed to record ranking quad tie:", err);
    } finally {
      setVoting(false);
    }
  }, [voting, quad, api, fetchQuad, fetchStats, onPhotosUpdated]);

  const handleApplyAll = useCallback(async () => {
    try {
      const count = await api.applySuggestedRatings();
      setFeedbackMessage(`Successfully applied suggested ratings to ${count} photo(s)!`);
      onPhotosUpdated?.();
      setTimeout(() => setFeedbackMessage(null), 4000);
    } catch (err) {
      console.error("Failed to apply suggested ratings:", err);
      alert(`Failed to apply suggested ratings: ${err}`);
    }
  }, [api, onPhotosUpdated]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (voting) return;

      if (mode === "quad") {
        if (!quad) return;
        if (e.key === "1") {
          e.preventDefault();
          handleQuadVote(0);
        } else if (e.key === "2") {
          e.preventDefault();
          handleQuadVote(1);
        } else if (e.key === "3") {
          e.preventDefault();
          handleQuadVote(2);
        } else if (e.key === "4") {
          e.preventDefault();
          handleQuadVote(3);
        } else if (e.key === "t" || e.key === "T" || e.key === "=") {
          e.preventDefault();
          handleQuadTie();
        } else if (e.key === " " || e.key === "s" || e.key === "S") {
          e.preventDefault();
          fetchQuad(false);
        }
      } else {
        if (!pair) return;
        if (e.key === "1" || e.key === "ArrowLeft") {
          e.preventDefault();
          handleVote(pair.photo_a, pair.photo_b, false);
        } else if (e.key === "2" || e.key === "ArrowRight") {
          e.preventDefault();
          handleVote(pair.photo_b, pair.photo_a, false);
        } else if (e.key === "t" || e.key === "T" || e.key === "=") {
          e.preventDefault();
          handleVote(pair.photo_a, pair.photo_b, true);
        } else if (e.key === " " || e.key === "s" || e.key === "S") {
          e.preventDefault();
          fetchPair(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, pair, quad, voting, handleVote, handleQuadVote, handleQuadTie, fetchPair, fetchQuad]);

  return (
    <div className="rater-view" data-testid="rater-view">
      <div className="rater-header">
        <div className="rater-title-row">
          <h2>
            <Sparkles size={22} color="#a855f7" /> Photo Force Ranker
          </h2>
          <div className="rater-actions-top">
            <button
              type="button"
              className={`rater-filter-btn ${unratedOnly ? "active" : ""}`}
              onClick={() => setUnratedOnly(!unratedOnly)}
              title={unratedOnly ? "Filtering unrated photos only (0 stars)" : "Showing all photos"}
              data-testid="filter-unrated-btn"
            >
              <Filter size={14} style={{ marginRight: 4 }} /> Unrated Only
            </button>

            <div className="rater-mode-toggle" role="group" aria-label="Ranking Mode">
              <button
                type="button"
                className={`rater-mode-btn ${mode === "quad" ? "active" : ""}`}
                onClick={() => setMode("quad")}
                title="Best of 4 (Triple speed)"
                data-testid="mode-quad-btn"
              >
                <LayoutGrid size={14} style={{ marginRight: 4 }} /> Best of 4
              </button>
              <button
                type="button"
                className={`rater-mode-btn ${mode === "pair" ? "active" : ""}`}
                onClick={() => setMode("pair")}
                title="1 vs 1 Head-to-Head"
                data-testid="mode-pair-btn"
              >
                <Columns2 size={14} style={{ marginRight: 4 }} /> 1 vs 1
              </button>
            </div>

            <button
              className="rater-btn apply-btn"
              onClick={handleApplyAll}
              title="Apply suggested ratings to all photos in library"
            >
              <Check size={16} /> Apply All Suggestions
            </button>
          </div>
        </div>

        {stats && stats.total_photos > 0 && (
          <div className="rater-progress-container">
            <div className="rater-progress-labels">
              <span>Ranking Progress: {stats.progress}%</span>
              <span>
                {stats.total_matches} duels completed ({stats.total_photos} photos{unratedOnly ? " unrated" : ""})
              </span>
            </div>
            <div className="rater-progress-bar">
              <div
                className="rater-progress-fill"
                style={{ width: `${stats.progress}%` }}
              />
            </div>
          </div>
        )}

        {feedbackMessage && (
          <div className="apply-banner">
            <Check size={14} /> {feedbackMessage}
          </div>
        )}
      </div>

      <div className="rater-content">
        {mode === "quad" ? (
          loading && !quad ? (
            <div className="rater-status">
              <RefreshCw size={28} className="spin" />
              <p>Finding candidate group...</p>
            </div>
          ) : quad && quad.photos.length >= 4 ? (
            <>
              <div className="rater-quad-container">
                {quad.photos.map((photo, idx) => (
                  <RaterCard
                    key={photo.id}
                    photo={photo}
                    api={api}
                    onVote={() => handleQuadVote(idx)}
                    ariaLabel={`Vote for photo ${idx + 1}`}
                    testId={`vote-photo-${idx + 1}`}
                    keyBadge={`${idx + 1}`}
                  />
                ))}
              </div>

              <div className="rater-controls-bar">
                <button
                  className="rater-btn"
                  onClick={handleQuadTie}
                  title="All 4 photos are equally good (records a 4-way draw)"
                  data-testid="vote-quad-tie"
                >
                  <Equal size={16} /> Equal / Tie <kbd>T</kbd>
                </button>
                <button
                  className="rater-btn"
                  onClick={() => fetchQuad(false)}
                  title="Skip this group without changing scores"
                >
                  <RefreshCw size={16} /> Skip <kbd>Space</kbd>
                </button>
              </div>
            </>
          ) : (
            <div className="rater-status">
              <p>
                {unratedOnly
                  ? "No unrated photos found in this selection."
                  : "Not enough photos in this selection for Best of 4."}
              </p>
              <p style={{ fontSize: "0.85rem" }}>
                {unratedOnly
                  ? "Turn off 'Unrated Only' to rank all photos, or import more unrated photos."
                  : "Import at least 4 photos into your library, or switch to 1 vs 1 mode above."}
              </p>
            </div>
          )
        ) : (
          loading && !pair ? (
            <div className="rater-status">
              <RefreshCw size={28} className="spin" />
              <p>Finding candidate pair...</p>
            </div>
          ) : pair ? (
            <>
              <div className="rater-duel-container">
                {/* Photo A */}
                <RaterCard
                  key={pair.photo_a.id}
                  photo={pair.photo_a}
                  api={api}
                  onVote={() => handleVote(pair.photo_a, pair.photo_b, false)}
                  ariaLabel="Vote for left photo"
                  testId="vote-photo-a"
                  keyBadge="1"
                />

                <div className="rater-vs-badge">VS</div>

                {/* Photo B */}
                <RaterCard
                  key={pair.photo_b.id}
                  photo={pair.photo_b}
                  api={api}
                  onVote={() => handleVote(pair.photo_b, pair.photo_a, false)}
                  ariaLabel="Vote for right photo"
                  testId="vote-photo-b"
                  keyBadge="2"
                />
              </div>

              <div className="rater-controls-bar">
                <button
                  className="rater-btn primary"
                  onClick={() => handleVote(pair.photo_a, pair.photo_b, false)}
                >
                  <ArrowLeft size={16} /> Vote Left <kbd>1</kbd>
                </button>
                <button
                  className="rater-btn"
                  onClick={() => handleVote(pair.photo_a, pair.photo_b, true)}
                  title="Both photos are equally good"
                >
                  <Equal size={16} /> Equal / Tie <kbd>T</kbd>
                </button>
                <button
                  className="rater-btn"
                  onClick={() => fetchPair(false)}
                  title="Skip this comparison without changing scores"
                >
                  <RefreshCw size={16} /> Skip <kbd>Space</kbd>
                </button>
                <button
                  className="rater-btn primary"
                  onClick={() => handleVote(pair.photo_b, pair.photo_a, false)}
                >
                  Vote Right <ArrowRight size={16} /> <kbd>2</kbd>
                </button>
              </div>
            </>
          ) : (
            <div className="rater-status">
              <p>
                {unratedOnly
                  ? "No unrated photos found in this selection."
                  : "Not enough photos in this selection to rank."}
              </p>
              <p style={{ fontSize: "0.85rem" }}>
                {unratedOnly
                  ? "Turn off 'Unrated Only' to rank all photos, or import more unrated photos."
                  : "Import at least 2 photos into your library to start force ranking."}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
});
