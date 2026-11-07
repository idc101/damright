import React, { useState, useMemo, useEffect } from "react";
import { Tv, Copy, Check, Play, Calendar, Tag, Sparkles, Moon } from "lucide-react";
import { Modal } from "./Modal";
import { TagWithCount, PersonWithCount } from "../../types";
import { SlideshowConfig, buildSlideshowUrl } from "../../utils/slideshowParams";
import "./SlideshowModal.css";

interface SlideshowModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTags: TagWithCount[];
  allPeople?: PersonWithCount[];
  initialConfig?: Partial<SlideshowConfig>;
  onStartSlideshow: (config: SlideshowConfig) => void;
  serverOrigin?: string;
}

export const SlideshowModal: React.FC<SlideshowModalProps> = ({
  isOpen,
  onClose,
  allTags = [],
  allPeople: _allPeople = [],
  initialConfig,
  onStartSlideshow,
  serverOrigin,
}) => {
  const [dateMode, setDateMode] = useState<"all" | "after" | "before" | "year" | "range">(
    initialConfig?.after
      ? "after"
      : initialConfig?.before
      ? "before"
      : initialConfig?.year
      ? "year"
      : "all"
  );
  const [afterDate, setAfterDate] = useState<string>(initialConfig?.after || "2009");
  const [beforeDate, setBeforeDate] = useState<string>(initialConfig?.before || "");
  const [yearVal, setYearVal] = useState<string>(initialConfig?.year || "");

  const [includedTags, setIncludedTags] = useState<string[]>(initialConfig?.includedTags || []);
  const [excludedTags, setExcludedTags] = useState<string[]>(initialConfig?.excludedTags || []);

  const [interval, setIntervalVal] = useState<number>(initialConfig?.interval || 15);
  const [kenBurns, setKenBurns] = useState<boolean>(
    initialConfig?.kenBurns !== undefined ? initialConfig.kenBurns : true
  );
  const [shuffle, setShuffle] = useState<boolean>(
    initialConfig?.shuffle !== undefined ? initialConfig.shuffle : true
  );
  const [sleepMode, setSleepMode] = useState<boolean>(
    initialConfig?.sleepMode !== undefined ? initialConfig.sleepMode : false
  );
  const [sleepStart, setSleepStart] = useState<string>(
    initialConfig?.sleepStart || "21:00"
  );
  const [sleepEnd, setSleepEnd] = useState<string>(
    initialConfig?.sleepEnd || "06:30"
  );

  const [tagInput, setTagInput] = useState<string>("");
  const [excludeTagInput, setExcludeTagInput] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && initialConfig) {
      if (initialConfig.after) {
        setDateMode("after");
        setAfterDate(initialConfig.after);
      } else if (initialConfig.before) {
        setDateMode("before");
        setBeforeDate(initialConfig.before);
      } else if (initialConfig.year) {
        setDateMode("year");
        setYearVal(initialConfig.year);
      }
      if (initialConfig.includedTags) setIncludedTags(initialConfig.includedTags);
      if (initialConfig.excludedTags) setExcludedTags(initialConfig.excludedTags);
      if (initialConfig.interval) setIntervalVal(initialConfig.interval);
      if (initialConfig.kenBurns !== undefined) setKenBurns(initialConfig.kenBurns);
      if (initialConfig.shuffle !== undefined) setShuffle(initialConfig.shuffle);
      if (initialConfig.sleepMode !== undefined) setSleepMode(initialConfig.sleepMode);
      if (initialConfig.sleepStart) setSleepStart(initialConfig.sleepStart);
      if (initialConfig.sleepEnd) setSleepEnd(initialConfig.sleepEnd);
    }
  }, [isOpen, initialConfig]);

  // Available tag suggestions
  const includeSuggestions = useMemo(() => {
    const q = tagInput.toLowerCase();
    return allTags
      .filter(
        (t) =>
          !includedTags.includes(t.name) &&
          !excludedTags.includes(t.name) &&
          (q ? t.name.toLowerCase().includes(q) : true)
      )
      .slice(0, 10);
  }, [allTags, tagInput, includedTags, excludedTags]);

  const excludeSuggestions = useMemo(() => {
    const q = excludeTagInput.toLowerCase();
    return allTags
      .filter(
        (t) =>
          !excludedTags.includes(t.name) &&
          !includedTags.includes(t.name) &&
          (q ? t.name.toLowerCase().includes(q) : true)
      )
      .slice(0, 10);
  }, [allTags, excludeTagInput, includedTags, excludedTags]);

  const currentConfig = useMemo<SlideshowConfig>(() => {
    const after = dateMode === "after" || dateMode === "range" ? afterDate : undefined;
    const before = dateMode === "before" || dateMode === "range" ? beforeDate : undefined;
    const year = dateMode === "year" ? yearVal : undefined;

    const queryTokens: string[] = [];
    if (after) queryTokens.push(`after:${after}`);
    if (before) queryTokens.push(`before:${before}`);
    if (year) queryTokens.push(`year:${year}`);
    includedTags.forEach((t) => queryTokens.push(`tag:${t}`));
    excludedTags.forEach((t) => queryTokens.push(`-tag:${t}`));

    return {
      interval,
      kenBurns,
      shuffle,
      story: true,
      after,
      before,
      year,
      includedTags,
      excludedTags,
      includedPeople: [],
      excludedPeople: [],
      searchQuery: queryTokens.join(" ").trim(),
      sleepMode,
      sleepStart,
      sleepEnd,
    };
  }, [dateMode, afterDate, beforeDate, yearVal, includedTags, excludedTags, interval, kenBurns, shuffle, sleepMode, sleepStart, sleepEnd]);

  const effectiveOrigin =
    serverOrigin ||
    (typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "http://damright.local:8010");

  const kioskUrl = useMemo(() => {
    return buildSlideshowUrl(currentConfig, effectiveOrigin);
  }, [currentConfig, effectiveOrigin]);

  const handleCopyKioskUrl = async () => {
    try {
      await navigator.clipboard.writeText(kioskUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      prompt("Copy Kiosk URL:", kioskUrl);
    }
  };

  const footer = (
    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
      <button className="secondary-button" onClick={onClose}>
        Cancel
      </button>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          className={`slideshow-copy-btn ${copied ? "copied" : ""}`}
          onClick={handleCopyKioskUrl}
          type="button"
          title="Copy URL for Raspberry Pi Kiosk Mode"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          <span>{copied ? "Copied URL!" : "Copy Kiosk URL"}</span>
        </button>
        <button
          className="primary-button"
          onClick={() => {
            onStartSlideshow(currentConfig);
            onClose();
          }}
          type="button"
        >
          <Play size={16} /> Start Slideshow
        </button>
      </div>
    </div>
  );

  return (
    <Modal title="Slideshow & Kiosk Configuration" isOpen={isOpen} onClose={onClose} footer={footer}>
      <div className="slideshow-modal-content">
        {/* Date Filter Section */}
        <div className="slideshow-modal-section">
          <label>
            <Calendar size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
            Date Range
          </label>
          <div className="slideshow-modal-row">
            <select
              className="slideshow-modal-select"
              value={dateMode}
              onChange={(e) => setDateMode(e.target.value as any)}
            >
              <option value="all">All Time (No Date Filter)</option>
              <option value="after">Only After Year / Date (e.g. 2009)</option>
              <option value="before">Only Before Year / Date</option>
              <option value="year">Specific Year</option>
              <option value="range">Date Range (From - To)</option>
            </select>

            {(dateMode === "after" || dateMode === "range") && (
              <input
                className="slideshow-modal-input"
                type="text"
                placeholder="e.g. 2009 or 2009-06-01"
                value={afterDate}
                onChange={(e) => setAfterDate(e.target.value)}
                style={{ width: "160px" }}
              />
            )}

            {(dateMode === "before" || dateMode === "range") && (
              <input
                className="slideshow-modal-input"
                type="text"
                placeholder="e.g. 2024 or 2024-12-31"
                value={beforeDate}
                onChange={(e) => setBeforeDate(e.target.value)}
                style={{ width: "160px" }}
              />
            )}

            {dateMode === "year" && (
              <input
                className="slideshow-modal-input"
                type="text"
                placeholder="e.g. 2021"
                value={yearVal}
                onChange={(e) => setYearVal(e.target.value)}
                style={{ width: "120px" }}
              />
            )}
          </div>
        </div>

        {/* Include Tags */}
        <div className="slideshow-modal-section">
          <label>
            <Tag size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
            Include Tags
          </label>
          <div className="slideshow-modal-pills">
            {includedTags.map((t) => (
              <span key={t} className="slideshow-tag-pill include">
                {t}
                <button type="button" onClick={() => setIncludedTags(includedTags.filter((x) => x !== t))}>
                  ✕
                </button>
              </span>
            ))}
            {includedTags.length === 0 && (
              <span style={{ color: "var(--text-muted)", fontSize: "12px", padding: "4px" }}>
                All photos included (or select tags below)
              </span>
            )}
          </div>
          <input
            className="slideshow-modal-input"
            type="text"
            placeholder="Search or add tag to include..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput.trim()) {
                if (!includedTags.includes(tagInput.trim())) {
                  setIncludedTags([...includedTags, tagInput.trim()]);
                }
                setTagInput("");
              }
            }}
          />
          {includeSuggestions.length > 0 && (
            <div className="slideshow-tag-suggestions">
              {includeSuggestions.map((t) => (
                <span
                  key={t.name}
                  className="slideshow-tag-suggestion"
                  onClick={() => {
                    setIncludedTags([...includedTags, t.name]);
                    setTagInput("");
                  }}
                >
                  + {t.name} ({t.count})
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Exclude Tags */}
        <div className="slideshow-modal-section">
          <label style={{ color: "#f87171" }}>Exclude Tags</label>
          <div className="slideshow-modal-pills exclude">
            {excludedTags.map((t) => (
              <span key={t} className="slideshow-tag-pill exclude">
                - {t}
                <button type="button" onClick={() => setExcludedTags(excludedTags.filter((x) => x !== t))}>
                  ✕
                </button>
              </span>
            ))}
            {excludedTags.length === 0 && (
              <span style={{ color: "var(--text-muted)", fontSize: "12px", padding: "4px" }}>
                No tags excluded
              </span>
            )}
          </div>
          <input
            className="slideshow-modal-input"
            type="text"
            placeholder="Search or add tag to exclude..."
            value={excludeTagInput}
            onChange={(e) => setExcludeTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && excludeTagInput.trim()) {
                if (!excludedTags.includes(excludeTagInput.trim())) {
                  setExcludedTags([...excludedTags, excludeTagInput.trim()]);
                }
                setExcludeTagInput("");
              }
            }}
          />
          {excludeSuggestions.length > 0 && (
            <div className="slideshow-tag-suggestions">
              {excludeSuggestions.map((t) => (
                <span
                  key={t.name}
                  className="slideshow-tag-suggestion"
                  onClick={() => {
                    setExcludedTags([...excludedTags, t.name]);
                    setExcludeTagInput("");
                  }}
                >
                  - {t.name} ({t.count})
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Transitions & Options */}
        <div className="slideshow-modal-section">
          <label>
            <Sparkles size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
            Display & Timing
          </label>
          <div className="slideshow-modal-row">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Slide Duration:</span>
              <select
                className="slideshow-modal-select"
                value={interval}
                onChange={(e) => setIntervalVal(parseInt(e.target.value, 10))}
              >
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={300}>5 minutes</option>
              </select>
            </div>

            <label className="slideshow-modal-toggle">
              <input
                type="checkbox"
                checked={kenBurns}
                onChange={(e) => setKenBurns(e.target.checked)}
              />
              Face-Aware Ken Burns
            </label>

            <label className="slideshow-modal-toggle">
              <input
                type="checkbox"
                checked={shuffle}
                onChange={(e) => setShuffle(e.target.checked)}
              />
              Shuffle (Smart Recency)
            </label>
          </div>
        </div>

        {/* Night / Sleep Mode */}
        <div className="slideshow-modal-section">
          <label>
            <Moon size={14} style={{ display: "inline", marginRight: "4px", verticalAlign: "-2px" }} />
            Night Sleep Mode
          </label>
          <div className="slideshow-modal-row" style={{ flexWrap: "wrap", gap: "12px" }}>
            <label className="slideshow-modal-toggle">
              <input
                type="checkbox"
                checked={sleepMode}
                onChange={(e) => setSleepMode(e.target.checked)}
              />
              Enable Sleep Schedule (Blank screen & pause rotation)
            </label>

            {sleepMode && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>From:</span>
                <input
                  className="slideshow-modal-input"
                  type="time"
                  value={sleepStart}
                  onChange={(e) => setSleepStart(e.target.value)}
                  style={{ width: "110px", padding: "4px 8px" }}
                />
                <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>To:</span>
                <input
                  className="slideshow-modal-input"
                  type="time"
                  value={sleepEnd}
                  onChange={(e) => setSleepEnd(e.target.value)}
                  style={{ width: "110px", padding: "4px 8px" }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Raspberry Pi Kiosk Box */}
        <div className="slideshow-kiosk-box">
          <div className="slideshow-kiosk-header">
            <span className="slideshow-kiosk-title">
              <Tv size={16} /> Raspberry Pi Kiosk URL
            </span>
          </div>
          <div className="slideshow-kiosk-url">{kioskUrl}</div>
          <div className="slideshow-pi-hint">
            Launch on your Raspberry Pi connected to TV:
            <br />
            <code>chromium-browser --kiosk "{kioskUrl}"</code>
          </div>
        </div>
      </div>
    </Modal>
  );
};
