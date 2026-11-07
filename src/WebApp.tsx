import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { FixedSizeGrid as Grid, areEqual } from "react-window";
import {
  Search,
  X,
  Folder as FolderIcon,
  Tag as TagIcon,
  Users as UsersIcon,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Tv,
  FileText,
} from "lucide-react";
import { Photo, TagWithCount, PersonWithCount } from "./types";
import { useLibraryState, LibraryTab } from "./hooks/useLibraryState";
import { useApi, ApiProvider } from "./services/ApiProvider";
import { SlideshowView } from "./components/views/SlideshowView";
import { SlideshowModal } from "./components/common/SlideshowModal";
import { PhotoLightbox } from "./components/common/PhotoLightbox";
import { TimelineYearsView } from "./components/views/TimelineYearsView";
import { TimelineMonthsView } from "./components/views/TimelineMonthsView";
import { TimelineScrubber } from "./components/views/TimelineScrubber";
import { buildTimelineIndex, formatPhotoDateHeader } from "./utils/timeline";
import { parseSlideshowParams, buildSlideshowUrl, SlideshowConfig } from "./utils/slideshowParams";
import "./WebApp.css";

const normalizePath = (p: string) => p.replace(/\\/g, "/");

interface WebPhotoCellData {
  photos: Photo[];
  columnCount: number;
  openViewer: (photo: Photo) => void;
  getAssetUrl: (path: string, isThumbnail?: boolean, version?: string) => string;
}

const WebPhotoCell = React.memo(({ columnIndex, rowIndex, style, data }: any) => {
  const { photos, columnCount, openViewer, getAssetUrl } = data as WebPhotoCellData;
  const index = rowIndex * columnCount + columnIndex;
  const photo = photos[index];

  if (!photo) return null;

  const isVideo = photo.mime_type.startsWith("video/");
  const isMarkdown = photo.mime_type === "text/markdown" || photo.path.toLowerCase().endsWith(".md") || photo.path.toLowerCase().endsWith(".markdown");
  const displayTitle = photo.title || photo.path.split(/[/\\]/).pop()?.replace(/\.(md|markdown)$/i, "").replace(/[-_]/g, " ") || "Post";
  const version = [
    photo.exposure,
    photo.crop_top,
    photo.crop_left,
    photo.crop_bottom,
    photo.crop_right,
    photo.crop_angle,
    photo.portrait_blur,
    photo.orientation,
  ]
    .filter((v) => v !== undefined && v !== null && v !== 0)
    .join("_");

  return (
    <div style={style} className="web-grid-cell">
      <div className="web-grid-item" onClick={() => openViewer(photo)}>
        {isMarkdown ? (
          <div className="web-grid-markdown-card">
            <div className="web-grid-markdown-badge">
              <FileText size={11} />
              <span>Post</span>
            </div>
            <div className="web-grid-markdown-title">{displayTitle}</div>
            {photo.description && (
              <div className="web-grid-markdown-desc">{photo.description}</div>
            )}
          </div>
        ) : (
          <img
            className="web-grid-image"
            src={getAssetUrl(photo.thumb_path || photo.path, true, version || undefined)}
            alt={photo.title || photo.path.split(/[/\\]/).pop() || "Photo"}
            loading="lazy"
          />
        )}
        {isVideo && (
          <div className="web-grid-video-badge">
            <ImageIcon size={14} />
          </div>
        )}
      </div>
    </div>
  );
}, areEqual);

function WebAppContent() {
  const api = useApi();
  const lib = useLibraryState({ syncUrl: true, defaultTab: "photos" });

  const [viewMode, setViewMode] = useState<"grid" | "slideshow">("grid");
  const [slideshowInterval, setSlideshowInterval] = useState<number>(300);
  const [slideshowKenBurns, setSlideshowKenBurns] = useState<boolean>(false);
  const [slideshowShuffle, setSlideshowShuffle] = useState<boolean>(true);
  const [slideshowSleepMode, setSlideshowSleepMode] = useState<boolean>(false);
  const [slideshowSleepStart, setSlideshowSleepStart] = useState<string>("21:00");
  const [slideshowSleepEnd, setSlideshowSleepEnd] = useState<string>("06:30");
  const [isSlideshowModalOpen, setIsSlideshowModalOpen] = useState<boolean>(false);
  const [timelineScale, setTimelineScale] = useState<"years" | "months" | "all">("all");
  const [currentTimelineTitle, setCurrentTimelineTitle] = useState<string | null>(null);

  // Search input state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchVal, setSearchVal] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<Grid>(null);
  const hasAutoScrolledRef = useRef(false);
  const prevTabRef = useRef(lib.activeTab);

  // Compute chronological index of filtered photos
  const timelineIndex = useMemo(
    () => buildTimelineIndex(lib.filteredPhotos),
    [lib.filteredPhotos]
  );

  // Handle URL route for slideshow
  useEffect(() => {
    if (typeof window === "undefined") return;
    const config = parseSlideshowParams(window.location.search);

    const pathname = window.location.pathname;
    if (pathname.startsWith("/slideshow")) {
      setSlideshowInterval(config.interval);
      setSlideshowKenBurns(config.kenBurns);
      setSlideshowShuffle(config.shuffle);
      setSlideshowSleepMode(Boolean(config.sleepMode));
      if (config.sleepStart) setSlideshowSleepStart(config.sleepStart);
      if (config.sleepEnd) setSlideshowSleepEnd(config.sleepEnd);
      setViewMode("slideshow");
    }
  }, []);

  // Sync searchVal with lib.searchQuery
  useEffect(() => {
    setSearchVal(lib.searchQuery);
    if (lib.searchQuery) {
      setIsSearchOpen(true);
    }
  }, [lib.searchQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lib.handleSearch(searchVal);
    lib.setActiveTab("photos");
  };

  const handleClearSearch = useCallback(() => {
    setSearchVal("");
    lib.clearSearch();
    setIsSearchOpen(false);
  }, [lib]);

  // Slideshow helpers
  const startSlideshowWithConfig = useCallback(
    (config: SlideshowConfig) => {
      setSlideshowInterval(config.interval);
      setSlideshowKenBurns(config.kenBurns);
      setSlideshowShuffle(config.shuffle);
      setSlideshowSleepMode(Boolean(config.sleepMode));
      if (config.sleepStart) setSlideshowSleepStart(config.sleepStart);
      if (config.sleepEnd) setSlideshowSleepEnd(config.sleepEnd);
      if (config.searchQuery) {
        lib.handleSearch(config.searchQuery);
      }
      setViewMode("slideshow");
      if (typeof window !== "undefined" && window.history) {
        const url = buildSlideshowUrl(config);
        window.history.pushState({}, "", url);
      }
    },
    [lib]
  );

  const stopSlideshow = useCallback(() => {
    setViewMode("grid");
    if (typeof window !== "undefined" && window.history) {
      const isSlideshowRoute = window.location.pathname.startsWith("/slideshow");
      if (isSlideshowRoute) {
        window.history.pushState({}, "", "/" + (window.location.search.includes("query=") ? window.location.search : ""));
      }
    }
  }, []);

  // Grid Dimensions for virtualization
  const [gridDimensions, setGridDimensions] = useState({
    width: typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 800,
    height: typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight - 120 : 600,
  });
  const gridContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gridContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setGridDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(gridContainerRef.current);
    return () => observer.disconnect();
  }, [lib.activeTab, lib.selectedPath, lib.selectedTag, lib.selectedPerson, lib.currentLevelItems.subfolders.length, timelineScale]);

  const isMobile = gridDimensions.width < 640;
  const targetWidth = isMobile ? 120 : 170;
  const columnCount = Math.floor(gridDimensions.width / targetWidth) || 1;
  const effectiveColumnWidth = gridDimensions.width / columnCount;

  // Jump to specific index in virtualized grid
  const scrollToPhotoIndex = useCallback(
    (index: number) => {
      if (gridRef.current && columnCount > 0) {
        const rowIndex = Math.floor(index / columnCount);
        gridRef.current.scrollToItem({
          rowIndex,
          align: "start",
        });
      }
    },
    [columnCount]
  );

  const handleScrub = useCallback(
    (targetIndex: number) => {
      scrollToPhotoIndex(targetIndex);
    },
    [scrollToPhotoIndex]
  );

  // Dynamic header title based on top visible photo when scrolling
  const handleItemsRendered = useCallback(
    ({ visibleRowStartIndex }: { visibleRowStartIndex: number }) => {
      if (columnCount <= 0 || lib.filteredPhotos.length === 0) return;
      const visibleIdx = Math.min(
        visibleRowStartIndex * columnCount,
        lib.filteredPhotos.length - 1
      );
      const photo = lib.filteredPhotos[visibleIdx];
      if (photo) {
        const title = formatPhotoDateHeader(photo);
        setCurrentTimelineTitle((prev) => (prev === title ? prev : title));
      }
    },
    [columnCount, lib.filteredPhotos]
  );

  // Reset auto-scroll flag when switching tabs or scale
  useEffect(() => {
    if (prevTabRef.current !== lib.activeTab) {
      prevTabRef.current = lib.activeTab;
      hasAutoScrolledRef.current = false;
    }
  }, [lib.activeTab]);

  // Trigger auto-scroll to bottom by default when in Photos tab with All scale
  useEffect(() => {
    if (
      lib.activeTab === "photos" &&
      timelineScale === "all" &&
      !lib.searchQuery &&
      lib.filteredPhotos.length > 0 &&
      columnCount > 0 &&
      gridDimensions.height > 0
    ) {
      if (!hasAutoScrolledRef.current) {
        hasAutoScrolledRef.current = true;
        const rowCount = Math.ceil(lib.filteredPhotos.length / columnCount);
        if (gridRef.current && rowCount > 0) {
          requestAnimationFrame(() => {
            gridRef.current?.scrollToItem({
              rowIndex: rowCount - 1,
              align: "end",
            });
          });
        }
      }
    }
  }, [
    lib.activeTab,
    timelineScale,
    lib.searchQuery,
    lib.filteredPhotos.length,
    columnCount,
    gridDimensions.height,
  ]);

  // Fullscreen Viewer State
  const [viewingPhotoIndex, setViewingPhotoIndex] = useState<number | null>(null);

  const openViewer = useCallback(
    (photo: Photo) => {
      const idx = lib.activeViewPhotos.findIndex((p) => p.id === photo.id);
      if (idx !== -1) {
        setViewingPhotoIndex(idx);
      }
    },
    [lib.activeViewPhotos]
  );

  const closeViewer = useCallback(() => {
    setViewingPhotoIndex(null);
  }, []);

  const itemData = useMemo(
    () => ({
      photos: lib.activeViewPhotos,
      columnCount,
      openViewer,
      getAssetUrl: (path: string, isThumbnail?: boolean, version?: string) =>
        api.getAssetUrl(path, isThumbnail, version),
    }),
    [lib.activeViewPhotos, columnCount, openViewer, api]
  );

  // Tab click handler (iOS standard behavior: tap again to reset navigation or scroll to bottom)
  const handleTabClick = (tab: LibraryTab) => {
    if (tab === lib.activeTab) {
      if (tab === "folders" && lib.selectedPath) lib.setSelectedPath(null);
      if (tab === "tags" && lib.selectedTag) lib.setSelectedTag(null);
      if (tab === "people" && lib.selectedPerson) lib.setSelectedPerson(null);
      if (tab === "photos") {
        if (searchVal || lib.searchQuery) handleClearSearch();
        else if (timelineScale !== "all") setTimelineScale("all");
        else {
          // Tap Photos tab again scrolls to bottom (newest photos)
          const rowCount = Math.ceil(lib.filteredPhotos.length / columnCount);
          if (gridRef.current && rowCount > 0) {
            gridRef.current.scrollToItem({
              rowIndex: rowCount - 1,
              align: "end",
            });
          }
        }
      }
    } else {
      lib.setActiveTab(tab);
      if (isSearchOpen && !searchVal) setIsSearchOpen(false);
    }
  };

  const currentViewingPhoto = viewingPhotoIndex !== null ? lib.activeViewPhotos[viewingPhotoIndex] : null;

  // Header Title computation (dynamic month/year when on Photos tab)
  const displayHeaderTitle = useMemo(() => {
    if (lib.activeTab === "photos" && !lib.searchQuery) {
      if (timelineScale === "years") {
        return "Years";
      }
      if (timelineScale === "months") {
        return "Months";
      }
      if (currentTimelineTitle) {
        return currentTimelineTitle;
      }
      if (lib.filteredPhotos.length > 0) {
        return formatPhotoDateHeader(lib.filteredPhotos[lib.filteredPhotos.length - 1]);
      }
      return "Photos";
    }
    return lib.headerTitle;
  }, [lib.activeTab, lib.searchQuery, timelineScale, currentTimelineTitle, lib.filteredPhotos, lib.headerTitle]);

  return (
    <div className="web-app">
      {/* Contextual Top Navigation Bar */}
      <header className="web-header">
        {isSearchOpen ? (
          <form className="web-header-search-form" onSubmit={handleSearchSubmit}>
            <div className="web-search-bar">
              <Search size={18} className="web-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search library..."
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                autoFocus
              />
              {searchVal && (
                <button
                  type="button"
                  className="web-clear-btn"
                  onClick={() => {
                    setSearchVal("");
                    lib.clearSearch();
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              className="web-search-cancel-btn"
              onClick={() => {
                setIsSearchOpen(false);
                if (searchVal) handleClearSearch();
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="web-header-row">
            <div className="web-header-left">
              {lib.headerBackButton ? (
                <button onClick={lib.headerBackButton.onClick} className="web-nav-back-btn">
                  <ChevronLeft size={22} />
                  <span>{lib.headerBackButton.label}</span>
                </button>
              ) : (
                <h1 className="web-header-title">{displayHeaderTitle}</h1>
              )}
            </div>

            {lib.activeTab === "photos" && !lib.searchQuery ? (
              <div className="web-header-center">
                <div className="web-segmented-control" role="group" aria-label="Timeline zoom scale">
                  <button
                    type="button"
                    className={`web-segmented-btn ${timelineScale === "years" ? "active" : ""}`}
                    onClick={() => setTimelineScale("years")}
                  >
                    Years
                  </button>
                  <button
                    type="button"
                    className={`web-segmented-btn ${timelineScale === "months" ? "active" : ""}`}
                    onClick={() => setTimelineScale("months")}
                  >
                    Months
                  </button>
                  <button
                    type="button"
                    className={`web-segmented-btn ${timelineScale === "all" ? "active" : ""}`}
                    onClick={() => setTimelineScale("all")}
                  >
                    All
                  </button>
                </div>
              </div>
            ) : lib.headerBackButton ? (
              <div className="web-header-center">
                <span className="web-header-subtitle">{displayHeaderTitle}</span>
              </div>
            ) : null}

            <div className="web-header-right">
              <button
                className="web-header-action-btn"
                onClick={() => {
                  setIsSearchOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
                title="Search"
              >
                <Search size={18} />
              </button>
              <button
                className="web-header-action-btn"
                onClick={() => setIsSlideshowModalOpen(true)}
                title="Configure & Start Slideshow"
              >
                <Tv size={18} />
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main
        className={`web-content ${
          lib.activeTab === "photos" ||
          (lib.activeTab === "folders" && lib.selectedPath !== null) ||
          (lib.activeTab === "tags" && lib.selectedTag !== null) ||
          (lib.activeTab === "people" && lib.selectedPerson !== null)
            ? "web-content-photos"
            : ""
        }`}
      >
        {/* Tab 1: Photos */}
        {lib.activeTab === "photos" && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
            {lib.filteredPhotos.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
                No photos found.
              </div>
            ) : timelineScale === "years" && !lib.searchQuery ? (
              <TimelineYearsView
                years={timelineIndex.years}
                onSelectYear={(_year) => setTimelineScale("months")}
                onSelectMonth={(month) => {
                  setTimelineScale("all");
                  setTimeout(() => scrollToPhotoIndex(month.startIndex), 50);
                }}
                getAssetUrl={(path, isThumb, ver) => api.getAssetUrl(path, isThumb, ver)}
              />
            ) : timelineScale === "months" && !lib.searchQuery ? (
              <TimelineMonthsView
                years={timelineIndex.years}
                onSelectMonth={(month) => {
                  setTimelineScale("all");
                  setTimeout(() => scrollToPhotoIndex(month.startIndex), 50);
                }}
                getAssetUrl={(path, isThumb, ver) => api.getAssetUrl(path, isThumb, ver)}
              />
            ) : (
              <div ref={gridContainerRef} className="web-grid-container">
                {gridDimensions.width > 0 && gridDimensions.height > 0 && (
                  <>
                    <Grid
                      ref={gridRef}
                      className="web-grid"
                      columnCount={columnCount}
                      columnWidth={effectiveColumnWidth}
                      height={gridDimensions.height}
                      rowCount={Math.ceil(lib.filteredPhotos.length / columnCount)}
                      rowHeight={effectiveColumnWidth}
                      width={gridDimensions.width}
                      itemData={itemData}
                      onItemsRendered={handleItemsRendered}
                    >
                      {WebPhotoCell}
                    </Grid>
                    {!lib.searchQuery && (
                      <TimelineScrubber
                        years={timelineIndex.years}
                        onScrub={handleScrub}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Folders */}
        {lib.activeTab === "folders" && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {lib.selectedPath === null ? (
              /* Root Sources List */
              <div className="web-list-section">
                {lib.sources.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
                    No source folders configured.
                  </div>
                ) : (
                  lib.sources.map((s) => {
                    const normSrc = normalizePath(s.path);
                    const count = lib.photos.filter((p) => !p.rejected && normalizePath(p.path).startsWith(normSrc)).length;
                    return (
                      <div key={s.path} className="web-list-item" onClick={() => lib.selectFolder(normSrc)}>
                        <div className="web-list-item-left">
                          <div className="web-list-item-icon">
                            <FolderIcon size={22} />
                          </div>
                          <span className="web-list-item-title">{s.name}</span>
                        </div>
                        <div className="web-list-item-right">
                          <span className="web-list-item-count">{count}</span>
                          <ChevronRight size={18} color="var(--text-muted)" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* Drilled-in Folder View */
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {lib.currentLevelItems.subfolders.length > 0 && (
                  <div className="web-subfolders-section">
                    <span className="web-subfolders-section-title">Folders</span>
                    <div className="web-subfolders-grid">
                      {lib.currentLevelItems.subfolders.map((sub) => (
                        <div key={sub.path} className="web-subfolder-card" onClick={() => lib.selectFolder(sub.path)}>
                          <div className="web-subfolder-card-icon">
                            <FolderIcon size={22} />
                          </div>
                          <span className="web-subfolder-card-name">{sub.name}</span>
                          <span className="web-subfolder-card-count">{sub.photoCount} items</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {lib.currentLevelItems.photos.length === 0 ? (
                  lib.currentLevelItems.subfolders.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
                      Folder is empty.
                    </div>
                  ) : null
                ) : (
                  <div ref={gridContainerRef} className="web-grid-container">
                    {gridDimensions.width > 0 && gridDimensions.height > 0 && (
                      <Grid
                        className="web-grid"
                        columnCount={columnCount}
                        columnWidth={effectiveColumnWidth}
                        height={gridDimensions.height}
                        rowCount={Math.ceil(lib.currentLevelItems.photos.length / columnCount)}
                        rowHeight={effectiveColumnWidth}
                        width={gridDimensions.width}
                        itemData={itemData}
                      >
                        {WebPhotoCell}
                      </Grid>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Tags */}
        {lib.activeTab === "tags" && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {lib.selectedTag === null ? (
              /* Tags List */
              <div className="web-list-section">
                {lib.tags.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
                    No tags found.
                  </div>
                ) : (
                  lib.tags.map((tag: TagWithCount) => (
                    <div key={tag.name} className="web-list-item" onClick={() => lib.selectTag(tag.name)}>
                      <div className="web-list-item-left">
                        <div className="web-list-item-icon">
                          <TagIcon size={20} />
                        </div>
                        <span className="web-list-item-title">{tag.name}</span>
                      </div>
                      <div className="web-list-item-right">
                        <span className="web-list-item-count">{tag.count}</span>
                        <ChevronRight size={18} color="var(--text-muted)" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Drilled-in Tag Photos */
              <div ref={gridContainerRef} className="web-grid-container">
                {lib.activeViewPhotos.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
                    No photos with this tag.
                  </div>
                ) : (
                  gridDimensions.width > 0 &&
                  gridDimensions.height > 0 && (
                    <Grid
                      className="web-grid"
                      columnCount={columnCount}
                      columnWidth={effectiveColumnWidth}
                      height={gridDimensions.height}
                      rowCount={Math.ceil(lib.activeViewPhotos.length / columnCount)}
                      rowHeight={effectiveColumnWidth}
                      width={gridDimensions.width}
                      itemData={itemData}
                    >
                      {WebPhotoCell}
                    </Grid>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: People */}
        {lib.activeTab === "people" && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {lib.selectedPerson === null ? (
              /* People List */
              <div className="web-list-section">
                {lib.people.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
                    No people tagged.
                  </div>
                ) : (
                  lib.people.map((person: PersonWithCount) => (
                    <div key={person.name} className="web-list-item" onClick={() => lib.selectPerson(person.name)}>
                      <div className="web-list-item-left">
                        <div className="web-list-item-icon">
                          <UsersIcon size={20} />
                        </div>
                        <span className="web-list-item-title">{person.name}</span>
                      </div>
                      <div className="web-list-item-right">
                        <span className="web-list-item-count">{person.count}</span>
                        <ChevronRight size={18} color="var(--text-muted)" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Drilled-in Person Photos */
              <div ref={gridContainerRef} className="web-grid-container">
                {lib.activeViewPhotos.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)" }}>
                    No photos found for this person.
                  </div>
                ) : (
                  gridDimensions.width > 0 &&
                  gridDimensions.height > 0 && (
                    <Grid
                      className="web-grid"
                      columnCount={columnCount}
                      columnWidth={effectiveColumnWidth}
                      height={gridDimensions.height}
                      rowCount={Math.ceil(lib.activeViewPhotos.length / columnCount)}
                      rowHeight={effectiveColumnWidth}
                      width={gridDimensions.width}
                      itemData={itemData}
                    >
                      {WebPhotoCell}
                    </Grid>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Fullscreen Shared Photo Lightbox */}
      {currentViewingPhoto && (
        <PhotoLightbox
          photo={currentViewingPhoto}
          photos={lib.activeViewPhotos}
          currentIndex={viewingPhotoIndex ?? 0}
          isOpen={viewingPhotoIndex !== null}
          onClose={closeViewer}
          onNavigate={setViewingPhotoIndex}
          onTagClick={(tag) => {
            closeViewer();
            lib.setActiveTab("tags");
            lib.selectTag(tag);
          }}
          onPersonClick={(person) => {
            closeViewer();
            lib.setActiveTab("people");
            lib.selectPerson(person);
          }}
        />
      )}

      {/* Bottom Sticky Tab Navigation */}
      <nav className="web-nav">
        <button
          className={`web-nav-item ${lib.activeTab === "photos" ? "active" : ""}`}
          onClick={() => handleTabClick("photos")}
        >
          <ImageIcon size={22} />
          <span>Photos</span>
        </button>
        <button
          className={`web-nav-item ${lib.activeTab === "folders" ? "active" : ""}`}
          onClick={() => handleTabClick("folders")}
        >
          <FolderIcon size={22} />
          <span>Folders</span>
        </button>
        <button
          className={`web-nav-item ${lib.activeTab === "tags" ? "active" : ""}`}
          onClick={() => handleTabClick("tags")}
        >
          <TagIcon size={22} />
          <span>Tags</span>
        </button>
        <button
          className={`web-nav-item ${lib.activeTab === "people" ? "active" : ""}`}
          onClick={() => handleTabClick("people")}
        >
          <UsersIcon size={22} />
          <span>People</span>
        </button>
      </nav>

      <SlideshowModal
        isOpen={isSlideshowModalOpen}
        onClose={() => setIsSlideshowModalOpen(false)}
        allTags={lib.tags}
        allPeople={lib.people}
        initialConfig={{
          interval: slideshowInterval,
          kenBurns: slideshowKenBurns,
          shuffle: slideshowShuffle,
          sleepMode: slideshowSleepMode,
          sleepStart: slideshowSleepStart,
          sleepEnd: slideshowSleepEnd,
          includedTags: lib.selectedTag ? [lib.selectedTag] : [],
        }}
        onStartSlideshow={startSlideshowWithConfig}
      />

      {viewMode === "slideshow" && (
        <SlideshowView
          photos={lib.activeViewPhotos}
          interval={slideshowInterval}
          kenBurns={slideshowKenBurns}
          shuffle={slideshowShuffle}
          sleepMode={slideshowSleepMode}
          sleepStart={slideshowSleepStart}
          sleepEnd={slideshowSleepEnd}
          onClose={stopSlideshow}
          onRefreshPhotos={() => lib.fetchPhotos(lib.searchQuery)}
        />
      )}
    </div>
  );
}

function WebApp() {
  return (
    <ApiProvider>
      <WebAppContent />
    </ApiProvider>
  );
}

export default WebApp;
