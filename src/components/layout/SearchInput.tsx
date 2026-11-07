import { Search, X, SlidersHorizontal, Globe, Folder, Image, Video, FileText, Eye, EyeOff, Trash2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { MediaTypeFilter } from "../../types";
import "./SearchInput.css";

interface SearchInputProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
  
  mediaType: MediaTypeFilter;
  onMediaTypeChange: (type: MediaTypeFilter) => void;
  rejectedFilter: "hide" | "show_all" | "only_rejected";
  onRejectedFilterChange: (filter: "hide" | "show_all" | "only_rejected") => void;
  searchScope: "global" | "local";
  onSearchScopeChange: (scope: "global" | "local") => void;
  hasActiveSelection: boolean;
  activeSelectionLabel: string | null;
}

export function SearchInput({
  onSearch,
  placeholder = "Search (is:edited is:cropped tag:nature ...)",
  initialValue = "",
  mediaType,
  onMediaTypeChange,
  rejectedFilter,
  onRejectedFilterChange,
  searchScope,
  onSearchScopeChange,
  hasActiveSelection,
  activeSelectionLabel,
}: SearchInputProps) {
  const [value, setValue] = useState(initialValue);
  const [debouncedValue, setDebouncedValue] = useState(initialValue);
  const isFirstRender = useRef(true);
  const onSearchRef = useRef(onSearch);
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, 300);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onSearchRef.current(debouncedValue);
  }, [debouncedValue]);

  // Click outside to close popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Determine if any filters are active
  const isFilterActive =
    (searchScope === "local" && hasActiveSelection) ||
    mediaType !== "all" ||
    rejectedFilter !== "hide";

  return (
    <div className="search-container">
      <div className="search-input-wrapper">
        <Search size={18} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        
        <div className="search-input-right-actions">
          {/* Active filters summary */}
          {!isOpen && isFilterActive && (
            <div className="filter-summary-badge" onClick={() => setIsOpen(true)} title="Active filters (click to edit)">
              {searchScope === "local" && hasActiveSelection && (
                <span className="filter-summary-icon" title={`Searching: ${activeSelectionLabel}`}>
                  <Folder size={12} />
                </span>
              )}
              {mediaType === "images" && (
                <span className="filter-summary-icon" title="Images only">
                  <Image size={12} />
                </span>
              )}
              {mediaType === "videos" && (
                <span className="filter-summary-icon" title="Videos only">
                  <Video size={12} />
                </span>
              )}
              {mediaType === "markdown" && (
                <span className="filter-summary-icon" title="Posts only">
                  <FileText size={12} />
                </span>
              )}
              {rejectedFilter === "show_all" && (
                <span className="filter-summary-icon" title="Showing rejected photos">
                  <Eye size={12} />
                </span>
              )}
              {rejectedFilter === "only_rejected" && (
                <span className="filter-summary-icon" title="Showing only rejected photos">
                  <EyeOff size={12} />
                </span>
              )}
            </div>
          )}

          {value && (
            <button className="clear-search search-action-btn" onClick={() => setValue("")} title="Clear Search">
              <X size={16} />
            </button>
          )}

          <button
            className={`search-action-btn ${isOpen ? "active" : ""} ${isFilterActive ? "filter-active" : ""}`}
            onClick={() => setIsOpen(!isOpen)}
            title="Toggle search filters"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div ref={popoverRef} className="search-filter-popover">
          <div className="popover-section">
            <span className="popover-label">Search Scope</span>
            <div className="popover-segmented-control">
              <button
                className={`popover-segment-btn ${searchScope === "global" ? "active" : ""}`}
                onClick={() => onSearchScopeChange("global")}
                title="Search all photos globally"
              >
                <Globe size={14} />
                <span>Everywhere</span>
              </button>
              <button
                className={`popover-segment-btn ${searchScope === "local" ? "active" : ""}`}
                onClick={() => onSearchScopeChange("local")}
                disabled={!hasActiveSelection}
                title={hasActiveSelection ? `Search only inside ${activeSelectionLabel}` : "Select a folder or tag to restrict search"}
              >
                <Folder size={14} />
                <span>{hasActiveSelection ? activeSelectionLabel : "Current View"}</span>
              </button>
            </div>
          </div>

          <div className="popover-section">
            <span className="popover-label">Media Type</span>
            <div className="popover-segmented-control">
              <button
                className={`popover-segment-btn ${mediaType === "all" ? "active" : ""}`}
                onClick={() => onMediaTypeChange("all")}
              >
                All
              </button>
              <button
                className={`popover-segment-btn ${mediaType === "images" ? "active" : ""}`}
                onClick={() => onMediaTypeChange("images")}
                title="Show only images"
              >
                <Image size={14} />
                <span>Images</span>
              </button>
              <button
                className={`popover-segment-btn ${mediaType === "videos" ? "active" : ""}`}
                onClick={() => onMediaTypeChange("videos")}
                title="Show only videos"
              >
                <Video size={14} />
                <span>Videos</span>
              </button>
              <button
                className={`popover-segment-btn ${mediaType === "markdown" ? "active" : ""}`}
                onClick={() => onMediaTypeChange("markdown")}
                title="Show only posts"
              >
                <FileText size={14} />
                <span>Posts</span>
              </button>
            </div>
          </div>

          <div className="popover-section">
            <span className="popover-label">Rejections</span>
            <div className="popover-segmented-control">
              <button
                className={`popover-segment-btn ${rejectedFilter === "hide" ? "active" : ""}`}
                onClick={() => onRejectedFilterChange("hide")}
                title="Hide rejected photos"
              >
                <EyeOff size={14} />
                <span>Hide Rejected</span>
              </button>
              <button
                className={`popover-segment-btn ${rejectedFilter === "show_all" ? "active" : ""}`}
                onClick={() => onRejectedFilterChange("show_all")}
                title="Show all photos including rejected"
              >
                <Eye size={14} />
                <span>Show All</span>
              </button>
              <button
                className={`popover-segment-btn ${rejectedFilter === "only_rejected" ? "active" : ""}`}
                onClick={() => onRejectedFilterChange("only_rejected")}
                title="Show only rejected photos"
              >
                <Trash2 size={14} />
                <span>Only Rejected</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
