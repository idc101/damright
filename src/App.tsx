import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ChevronRight, ChevronLeft, Tv, Images, Copy, AlertTriangle, Cloud, Settings, Sparkles } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import Sidebar from "./components/Sidebar";
import { SearchInput } from "./components/layout/SearchInput";
import { Photo, DirEntry } from "./types";
import { useLibraryState, LibraryTab } from "./hooks/useLibraryState";
import { useImport } from "./hooks/useImport";
import { useSelection } from "./hooks/useSelection";
import { ActivityBadge } from "./components/ActivityBadge";
import { PhotoGrid } from "./components/views/PhotoGrid";
import { FilmstripView } from "./components/views/FilmstripView";
import { CropView } from "./components/views/CropView";
import { RaterView } from "./components/views/RaterView";
import { MetadataPanel } from "./components/layout/MetadataPanel";
import { Resizer } from "./components/layout/Resizer";
import { MovePhotosModal } from "./components/common/MovePhotosModal";
import { MoveFolderModal } from "./components/common/MoveFolderModal";
import { TagModal } from "./components/common/TagModal";
import { EditCaptureDateModal } from "./components/common/EditCaptureDateModal";
import { ExportModal, ExportConfig } from "./components/common/ExportModal";
import { FolderSyncModal } from "./components/FolderSyncModal";
import { ApiProvider, useApi } from "./services/ApiProvider";
import { useIsMobile } from "./hooks/useIsMobile";
import { BottomNavBar } from "./components/layout/BottomNavBar";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useExport } from "./hooks/useExport";
import { SlideshowView } from "./components/views/SlideshowView";
import { SlideshowModal } from "./components/common/SlideshowModal";
import { ICloudSyncView } from "./components/views/ICloudSyncView";
import { DuplicatesView } from "./components/views/DuplicatesView";
import { getCachedPreviewUrl, loadAndCachePreview, prefetchAdjacentPreviews } from "./utils/previewCache";
import { parseSlideshowParams, SlideshowConfig } from "./utils/slideshowParams";
import "./App.css";

function AppContent() {
  const api = useApi();
  const lib = useLibraryState({ syncUrl: true, defaultTab: "folders" });

  const [viewMode, setViewMode] = useState<"grid" | "filmstrip" | "crop" | "slideshow">("grid");
  const [previousViewMode, setPreviousViewMode] = useState<"grid" | "filmstrip">("grid");
  const [slideshowInterval, setSlideshowInterval] = useState<number>(300);
  const [slideshowKenBurns, setSlideshowKenBurns] = useState<boolean>(false);
  const [slideshowShuffle, setSlideshowShuffle] = useState<boolean>(true);
  const [slideshowSleepMode, setSlideshowSleepMode] = useState<boolean>(false);
  const [slideshowSleepStart, setSlideshowSleepStart] = useState<string>("21:00");
  const [slideshowSleepEnd, setSlideshowSleepEnd] = useState<string>("06:30");
  const [isSlideshowModalOpen, setIsSlideshowModalOpen] = useState<boolean>(false);

  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"library" | "albums" | "search">("library");

  const [lastLibraryTab, setLastLibraryTab] = useState<"folders" | "tags" | "people" | "quick">(() => {
    const saved = localStorage.getItem("selectedSidebarTab");
    if (saved === "folders" || saved === "tags" || saved === "people" || saved === "quick") {
      return saved;
    }
    return "folders";
  });

  const handleSidebarTabChange = useCallback((tab: LibraryTab) => {
    lib.setActiveTab(tab);
    if (tab === "folders" || tab === "tags" || tab === "people" || tab === "quick") {
      setLastLibraryTab(tab);
    }
  }, [lib]);

  const handleNavModeChange = useCallback((mode: "library" | "duplicates" | "validation" | "icloud" | "rank") => {
    if (mode === "library") {
      handleSidebarTabChange(lastLibraryTab);
    } else {
      handleSidebarTabChange(mode);
    }
  }, [handleSidebarTabChange, lastLibraryTab]);

  const handleFixAllValidationIssues = useCallback(async () => {
    try {
      const fixedCount = await api.fixAllValidationIssues();
      alert(`Successfully fixed ${fixedCount} validation issues!`);
      await lib.fetchPhotos();
    } catch (err) {
      console.error("Failed to fix validation issues:", err);
      alert(`Failed to fix validation issues: ${err}`);
    }
  }, [api, lib]);

  const enterCropMode = useCallback(() => {
    if (viewMode !== "crop") {
      setPreviousViewMode(viewMode as "grid" | "filmstrip");
      setViewMode("crop");
    }
  }, [viewMode]);

  const getActiveSelectionLabel = () => {
    if (lib.sidebarTab === "folders" && lib.selectedPath) {
      return lib.selectedPath.split(/[/\\]/).pop() || lib.selectedPath;
    }
    if (lib.sidebarTab === "tags" && lib.selectedTag) {
      return `tag "${lib.selectedTag}"`;
    }
    if (lib.sidebarTab === "people" && lib.selectedPerson) {
      return `person "${lib.selectedPerson}"`;
    }
    return null;
  };
  const activeSelectionLabel = getActiveSelectionLabel();
  const hasActiveSelection = activeSelectionLabel !== null;

  const {
    selectedIds,
    handleSelect,
    selectAll,
    setSelectedItem,
    selectedItem: selectedPhoto,
  } = useSelection(lib.filteredPhotos);

  const refreshAllTrees = useCallback(async () => {
    for (const source of lib.sources) {
      lib.fetchTree(source.path);
    }
  }, [lib.sources, lib.fetchTree]);

  const onPhotosImported = useCallback((_newPhotos: Photo[]) => {
    lib.fetchPhotos(lib.searchQuery);
    lib.fetchAllTags();
    lib.fetchAllPeople();
    refreshAllTrees();
    api.updateInboxBadge?.();
  }, [lib.fetchPhotos, lib.searchQuery, lib.fetchAllTags, lib.fetchAllPeople, refreshAllTrees, api]);

  useEffect(() => {
    api.updateInboxBadge?.();
  }, [api]);

  const {
    importing,
    progress,
    importFolder,
    refreshFolder,
  } = useImport(onPhotosImported);

  const {
    exporting,
    exportProgress,
    exportPhotos,
  } = useExport();

  const handleRefreshFolder = useCallback(async (path: string) => {
    await refreshFolder(path);
    await lib.fetchPhotos(lib.searchQuery);
    await lib.fetchAllTags();
    await lib.fetchAllPeople();
    await refreshAllTrees();
  }, [refreshFolder, lib.fetchPhotos, lib.searchQuery, lib.fetchAllTags, lib.fetchAllPeople, refreshAllTrees]);

  const handlePhotosUpdated = useCallback(() => {
    lib.fetchPhotos(lib.searchQuery);
  }, [lib.fetchPhotos, lib.searchQuery]);

  const [largeImageUrl, setLargeImageUrl] = useState<string | null>(null);
  const [largeImageUrlUncropped, setLargeImageUrlUncropped] = useState<string | null>(null);

  const currentCachedPreview = (viewMode === "filmstrip" && selectedPhoto)
    ? getCachedPreviewUrl(selectedPhoto, false)
    : null;
  const currentCachedPreviewUncropped = (viewMode === "crop" && selectedPhoto)
    ? getCachedPreviewUrl(selectedPhoto, true)
    : null;
  const effectiveLargeImageUrl = currentCachedPreview || largeImageUrl;
  const effectiveLargeImageUrlUncropped = currentCachedPreviewUncropped || largeImageUrlUncropped;

  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [folderToMove, setFolderToMove] = useState<DirEntry | null>(null);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);

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
    },
    [lib]
  );

  // Panel States
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("sidebarWidth");
    return saved ? parseInt(saved, 10) : 250;
  });
  const [metadataWidth, setMetadataWidth] = useState(() => {
    const saved = localStorage.getItem("metadataWidth");
    return saved ? parseInt(saved, 10) : 350;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [metadataCollapsed, setMetadataCollapsed] = useState(false);

  const [gridDimensions, setGridDimensions] = useState({ width: 800, height: 600 });
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const filmstripScrollRef = useRef<HTMLDivElement>(null);

  const handleAddSource = useCallback(() => {
    lib.addSource((path) => importFolder(path));
  }, [lib.addSource, importFolder]);

  // Handle URL route for slideshow and fetch tree for loaded sources
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

  useEffect(() => {
    for (const source of lib.sources) {
      lib.fetchTree(source.path);
    }
  }, [lib.sources, lib.fetchTree]);

  // Listen for native menu events
  useEffect(() => {
    const unlistenImport = listen("import", () => {
      if (!importing) {
        handleAddSource();
      }
    });

    const unlistenFixVal = listen("fix_validation", () => {
      handleFixAllValidationIssues();
    });

    return () => {
      unlistenImport.then((u) => u());
      unlistenFixVal.then((u) => u());
    };
  }, [importing, handleAddSource, handleFixAllValidationIssues]);

  // Resize Observer
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
  }, [isMobile, mobileTab, viewMode]);

  const columnWidth = 220;
  const columnCount = isMobile ? 3 : Math.floor(gridDimensions.width / columnWidth) || 1;
  const effectiveColumnWidth = isMobile ? gridDimensions.width / 3 : columnWidth;
  const gridWidth = isMobile ? gridDimensions.width : columnCount * columnWidth;

  const handleSidebarResize = useCallback((clientX: number) => {
    const w = Math.max(150, Math.min(clientX, 500));
    setSidebarWidth(w);
    localStorage.setItem("sidebarWidth", String(w));
  }, []);

  const handleMetadataResize = useCallback((clientX: number) => {
    const newWidth = window.innerWidth - clientX;
    const w = Math.max(200, Math.min(newWidth, 600));
    setMetadataWidth(w);
    localStorage.setItem("metadataWidth", String(w));
  }, []);

  const handleMoveSelectedPhotos = useCallback(
    async (destFolder: string, autoRenameOnMove: boolean = false) => {
      try {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        const count = await lib.movePhotos(ids, destFolder);

        if (autoRenameOnMove) {
          for (const id of ids) {
            const photo = lib.photos.find((p) => p.id === id);
            if (photo) {
              const filename = photo.path.split(/[/\\]/).pop();
              if (filename) {
                const separator = destFolder.includes("\\") ? "\\" : "/";
                const newPath = destFolder.endsWith(separator)
                  ? `${destFolder}${filename}`
                  : `${destFolder}${separator}${filename}`;
                await lib.autoRename(newPath, id);
              }
            }
          }
        }

        setIsMoveModalOpen(false);
        await refreshAllTrees();
        console.log(`Successfully moved ${count} photo(s) to ${destFolder}${autoRenameOnMove ? " and auto-renamed" : ""}`);
      } catch (err) {
        console.error("Failed to move photos:", err);
      }
    },
    [selectedIds, lib.photos, lib.movePhotos, lib.autoRename, refreshAllTrees]
  );

  const handleMoveFolder = useCallback(
    async (srcPath: string, destPath: string) => {
      try {
        await lib.moveFolder(srcPath, destPath);

        // Update selectedPath if it was inside the moved folder
        const normSrc = srcPath.replace(/\\/g, "/");
        const normDest = destPath.replace(/\\/g, "/");
        const normSelected = lib.selectedPath ? lib.selectedPath.replace(/\\/g, "/") : null;

        if (normSelected) {
          if (normSelected === normSrc) {
            lib.setSelectedPath(destPath);
          } else if (normSelected.startsWith(normSrc + "/")) {
            const rel = normSelected.slice(normSrc.length);
            lib.setSelectedPath(normDest + rel);
          }
        }

        setFolderToMove(null);
        await refreshAllTrees();
        await lib.fetchPhotos();
      } catch (err) {
        console.error("Failed to move/rename folder:", err);
        throw err;
      }
    },
    [lib, refreshAllTrees]
  );

  const selectedPhotosForTags = useMemo(() => {
    if (selectedIds.size === 0) {
      return selectedPhoto ? [selectedPhoto] : [];
    }
    return lib.photos.filter((p) => selectedIds.has(p.id));
  }, [selectedIds, selectedPhoto, lib.photos]);

  const { initialTags, partialTags } = useMemo(() => {
    if (selectedPhotosForTags.length === 0) {
      return { initialTags: [], partialTags: [] };
    }
    const tagCounts = new Map<string, { name: string; count: number }>();
    for (const photo of selectedPhotosForTags) {
      if (!photo.tags) continue;
      const tags = photo.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const seenInPhoto = new Set<string>();
      for (const tag of tags) {
        const lower = tag.toLowerCase();
        if (!seenInPhoto.has(lower)) {
          seenInPhoto.add(lower);
          const current = tagCounts.get(lower);
          if (current) {
            current.count += 1;
          } else {
            tagCounts.set(lower, { name: tag, count: 1 });
          }
        }
      }
    }

    const allInitial: string[] = [];
    const partial: string[] = [];
    const total = selectedPhotosForTags.length;

    for (const entry of tagCounts.values()) {
      allInitial.push(entry.name);
      if (total > 1 && entry.count < total) {
        partial.push(entry.name);
      }
    }

    return { initialTags: allInitial, partialTags: partial };
  }, [selectedPhotosForTags]);

  const handleSaveTags = useCallback(
    async (newTags: string[], delta?: { added: string[]; removed: string[] }) => {
      try {
        const ids = selectedIds.size > 0
          ? Array.from(selectedIds)
          : selectedPhoto
          ? [selectedPhoto.id]
          : [];
        if (ids.length === 0) return;

        const added = delta ? delta.added : newTags.filter((t) => !initialTags.includes(t));
        const removed = delta ? delta.removed : initialTags.filter((t) => !newTags.includes(t));

        await lib.batchUpdateMetadata(ids, undefined, undefined, undefined, undefined, added, removed);
        setIsTagModalOpen(false);
        await lib.fetchAllTags();
      } catch (err) {
        console.error("Failed to save tags:", err);
      }
    },
    [selectedIds, selectedPhoto, initialTags, lib.batchUpdateMetadata, lib.fetchAllTags]
  );

  const handleUpdateCaptureDate = useCallback(
    async (updates: { id: string; captureTime: string }[]) => {
      try {
        await lib.batchUpdateCaptureTime(updates);
        setIsDateModalOpen(false);
      } catch (err) {
        console.error("Failed to update capture dates:", err);
      }
    },
    [lib.batchUpdateCaptureTime]
  );

  const handleToggleQuickCollection = useCallback(
    async (ids?: string[]) => {
      const targetIds =
        ids && ids.length > 0
          ? ids
          : selectedIds.size > 0
          ? Array.from(selectedIds)
          : selectedPhoto
          ? [selectedPhoto.id]
          : [];
      if (targetIds.length === 0) return;
      try {
        await invoke("toggle_quick_collection", { ids: targetIds });
        await lib.fetchPhotos();
      } catch (err) {
        console.error("Failed to toggle quick collection:", err);
      }
    },
    [selectedIds, selectedPhoto, lib.fetchPhotos]
  );

  const handleExportPhotos = useCallback(
    async (config: ExportConfig) => {
      try {
        const count = await exportPhotos(config);
        await message(`Successfully exported ${count} ${count === 1 ? "photo" : "photos"}.`, {
          title: "Export Complete",
          kind: "info",
        });
      } catch (err) {
        console.error("Export failed:", err);
        await message(`Export failed: ${err}`, { title: "Export Error", kind: "error" });
      }
    },
    [exportPhotos]
  );

  const handlePhotosDeleted = useCallback(async () => {
    await lib.fetchPhotos(lib.searchQuery);
    await lib.fetchAllTags();
    await lib.fetchAllPeople();
    await refreshAllTrees();
  }, [lib.fetchPhotos, lib.searchQuery, lib.fetchAllTags, lib.fetchAllPeople, refreshAllTrees]);

  const handleDeleteSelected = useCallback(async () => {
    const idsToDelete =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : selectedPhoto
        ? [selectedPhoto.id]
        : [];
    if (idsToDelete.length === 0) return;

    const count = idsToDelete.length;
    const isBatch = count > 1;
    let confirmed = false;
    const confirmMessage = isBatch
      ? `Are you sure you want to permanently delete these ${count} files? This will delete the image files, XMP sidecars, and thumbnails from disk.`
      : `Are you sure you want to permanently delete this file? This will delete the image file, XMP sidecars, and thumbnails from disk.`;
    const confirmTitle = isBatch ? "Confirm Delete Files" : "Confirm Delete File";

    try {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      confirmed = await confirm(confirmMessage, {
        title: confirmTitle,
        kind: "warning",
      });
    } catch {
      confirmed = window.confirm(confirmMessage);
    }

    if (!confirmed) return;

    try {
      for (const id of idsToDelete) {
        await api.deletePhoto(id);
      }
      await handlePhotosDeleted();
    } catch (err) {
      console.error("Failed to delete photo:", err);
    }
  }, [selectedIds, selectedPhoto, api, handlePhotosDeleted]);

  useKeyboardShortcuts({
    selectedPhoto,
    selectedIds,
    filteredPhotos: lib.filteredPhotos,
    viewMode,
    columnCount,
    isMoveModalOpen,
    isTagModalOpen,
    isDateModalOpen,
    isExportModalOpen,
    handleSelect,
    selectAll,
    toggleQuickCollection: handleToggleQuickCollection,
    toggleRejected: lib.toggleRejected,
    deleteSelectedPhotos: handleDeleteSelected,
    batchUpdateMetadata: lib.batchUpdateMetadata,
    setIsMoveModalOpen,
    setIsTagModalOpen,
    setIsExportModalOpen,
    setViewMode,
  });

  useEffect(() => {
    let active = true;

    if ((viewMode === "filmstrip" || viewMode === "crop") && selectedPhoto) {
      const isUncropped = viewMode === "crop";
      const cached = getCachedPreviewUrl(selectedPhoto, isUncropped);

      if (cached) {
        if (isUncropped) {
          setLargeImageUrlUncropped(cached);
        } else {
          setLargeImageUrl(cached);
        }
      } else {
        if (isUncropped) {
          setLargeImageUrlUncropped(null);
        } else {
          setLargeImageUrl(null);
        }
      }

      loadAndCachePreview(api, selectedPhoto, isUncropped)
        .then((url) => {
          if (!active) return;
          if (isUncropped) {
            setLargeImageUrlUncropped(url);
          } else {
            setLargeImageUrl(url);
          }
        })
        .catch((err) => {
          console.error("Failed to fetch large image for photo ID:", selectedPhoto.id, "Error:", err);
          if (active) {
            if (isUncropped) {
              setLargeImageUrlUncropped(null);
            } else {
              setLargeImageUrl(null);
            }
          }
        });

      if (viewMode === "filmstrip") {
        const timer = setTimeout(() => {
          if (!active) return;
          const currentIndex = lib.filteredPhotos.findIndex((p) => p.id === selectedPhoto.id);
          if (currentIndex !== -1) {
            prefetchAdjacentPreviews(api, lib.filteredPhotos, currentIndex, 3);
          }
        }, 100);

        return () => {
          active = false;
          clearTimeout(timer);
        };
      }
    } else {
      setLargeImageUrl(null);
      setLargeImageUrlUncropped(null);
    }
    return () => {
      active = false;
    };
  }, [selectedPhoto, viewMode, api, lib.filteredPhotos]);

  const handleDoubleClickPhoto = useCallback(
    (p: Photo) => {
      setSelectedItem(p);
      setViewMode("filmstrip");
    },
    [setSelectedItem, setViewMode]
  );

  const handleShowInFolder = useCallback(
    (p: Photo) => {
      const lastSeparatorIdx = Math.max(p.path.lastIndexOf("/"), p.path.lastIndexOf("\\"));
      const parentPath = lastSeparatorIdx !== -1 ? p.path.substring(0, lastSeparatorIdx) : "";
      if (parentPath) {
        lib.setSidebarTab("folders");
        lib.setSelectedPath(parentPath);
        setSidebarCollapsed(false);
        if (isMobile) {
          setMobileTab("library");
        }
      }
    },
    [isMobile, lib]
  );

  // Auto-select first photo when list changes in filmstrip mode
  useEffect(() => {
    if (viewMode === "filmstrip" && lib.filteredPhotos.length > 0 && !selectedPhoto) {
      setSelectedItem(lib.filteredPhotos[0]);
    }
  }, [viewMode, lib.filteredPhotos, selectedPhoto, setSelectedItem]);

  return (
    <div className="container">
      <header>
        <div className="header-left">
          {sidebarCollapsed && (
            <button className="panel-toggle" onClick={() => setSidebarCollapsed(false)} title="Show Sidebar">
              <ChevronRight size={20} />
            </button>
          )}
          <img src="/damright-logo.svg" alt="DamRight Logo" style={{ height: "36px", width: "36px" }} />

          {!isMobile && (
            <nav className="header-nav" aria-label="Main Navigation">
              <button
                className={`header-nav-btn ${
                  lib.sidebarTab !== "duplicates" && lib.sidebarTab !== "validation" && lib.sidebarTab !== "icloud" && lib.sidebarTab !== "rank"
                    ? "active"
                    : ""
                }`}
                onClick={() => handleNavModeChange("library")}
                title="Photo Library"
              >
                <Images size={16} />
                <span>Library</span>
              </button>
              <button
                className={`header-nav-btn ${lib.sidebarTab === "duplicates" ? "active" : ""}`}
                onClick={() => handleNavModeChange("duplicates")}
                title="Duplicates"
              >
                <Copy size={16} />
                <span>Duplicates</span>
              </button>
              <button
                className={`header-nav-btn ${lib.sidebarTab === "validation" ? "active" : ""}`}
                onClick={() => handleNavModeChange("validation")}
                title="Validation"
              >
                <AlertTriangle size={16} />
                <span>Validation</span>
              </button>
              <button
                className={`header-nav-btn ${lib.sidebarTab === "icloud" ? "active" : ""}`}
                onClick={() => handleNavModeChange("icloud")}
                title="iCloud Sync"
              >
                <Cloud size={16} />
                <span>iCloud</span>
              </button>
              <button
                className={`header-nav-btn ${lib.sidebarTab === "rank" ? "active" : ""}`}
                onClick={() => handleNavModeChange("rank")}
                title="Photo Force Ranker"
                data-testid="nav-rank-btn"
              >
                <Sparkles size={16} />
                <span>Rank</span>
              </button>
            </nav>
          )}
        </div>

        <SearchInput
          onSearch={lib.handleSearch}
          initialValue={lib.searchQuery}
          mediaType={lib.mediaTypeFilter}
          onMediaTypeChange={lib.setMediaTypeFilter}
          rejectedFilter={lib.rejectedFilter}
          onRejectedFilterChange={lib.setRejectedFilter}
          searchScope={lib.searchScope}
          onSearchScopeChange={lib.setSearchScope}
          hasActiveSelection={hasActiveSelection}
          activeSelectionLabel={activeSelectionLabel}
        />

        <div className="header-actions">
          <ActivityBadge
            importing={importing}
            importProgress={progress}
            exporting={exporting}
            exportProgress={exportProgress}
          />
          <button
            className="panel-toggle"
            onClick={() => setIsSlideshowModalOpen(true)}
            title="Configure & Start Slideshow"
            style={{ marginRight: "8px" }}
          >
            <Tv size={20} />
          </button>
          {metadataCollapsed && (
            <button className="panel-toggle" onClick={() => setMetadataCollapsed(false)} title="Show Metadata">
              <ChevronLeft size={20} />
            </button>
          )}
          <button
            className="panel-toggle"
            onClick={() => setIsFolderModalOpen(true)}
            title="Manage Folders & Sync"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <div className={`app-layout ${isMobile ? "mobile" : ""}`}>
        {!isMobile && (
          <>
            <Sidebar
              sources={lib.sources}
              trees={lib.trees}
              onSelectFolder={lib.setSelectedPath}
              selectedPath={lib.selectedPath}
              onRefreshFolder={handleRefreshFolder}
              onPhotosDeleted={handlePhotosDeleted}
              onAutoRename={async (path, id) => {
                const count = await lib.autoRename(path, id);
                if (count > 0) await refreshAllTrees();
                return count;
              }}
              onMoveFolder={(node) => setFolderToMove(node)}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
              width={sidebarWidth}
              activeTab={lib.sidebarTab}
              onTabChange={handleSidebarTabChange}
              tags={lib.tags}
              selectedTag={lib.selectedTag}
              onSelectTag={lib.setSelectedTag}
              people={lib.people}
              selectedPerson={lib.selectedPerson}
              onSelectPerson={lib.setSelectedPerson}
              photos={lib.photos}
              validationFilter={lib.validationFilter}
              onValidationFilterChange={lib.setValidationFilter}
              onFixAllValidationIssues={handleFixAllValidationIssues}
              selectedCount={selectedIds.size}
            />
            {!sidebarCollapsed && <Resizer onResize={handleSidebarResize} />}
          </>
        )}

        <main className={isMobile ? "mobile-main" : ""}>
          {isMobile && mobileTab === "albums" && viewMode === "grid" ? (
            <Sidebar
              sources={lib.sources}
              trees={lib.trees}
              onSelectFolder={(path) => {
                lib.setSelectedPath(path);
                setMobileTab("library");
              }}
              selectedPath={lib.selectedPath}
              onRefreshFolder={handleRefreshFolder}
              onPhotosDeleted={handlePhotosDeleted}
              onAutoRename={async (path, id) => {
                const count = await lib.autoRename(path, id);
                if (count > 0) await refreshAllTrees();
                return count;
              }}
              onMoveFolder={(node) => setFolderToMove(node)}
              collapsed={false}
              onToggle={() => {}}
              width={gridDimensions.width}
              activeTab={lib.sidebarTab}
              onTabChange={handleSidebarTabChange}
              tags={lib.tags}
              selectedTag={lib.selectedTag}
              onSelectTag={(tag) => {
                lib.setSelectedTag(tag);
                setMobileTab("library");
              }}
              people={lib.people}
              selectedPerson={lib.selectedPerson}
              onSelectPerson={(person) => {
                lib.setSelectedPerson(person);
                setMobileTab("library");
              }}
              isMobile={true}
              photos={lib.photos}
              validationFilter={lib.validationFilter}
              onValidationFilterChange={lib.setValidationFilter}
              onFixAllValidationIssues={handleFixAllValidationIssues}
              selectedCount={selectedIds.size}
            />
          ) : (
            <div className="main-content-area">
              <div ref={gridContainerRef} className="grid-sub-container">
                {lib.sidebarTab === "rank" ? (
                  <RaterView
                    api={api}
                    searchQuery={lib.searchQuery}
                    onPhotosUpdated={handlePhotosUpdated}
                  />
                ) : lib.sidebarTab === "icloud" ? (
                  <ICloudSyncView api={api} />
                ) : lib.sidebarTab === "duplicates" ? (
                  <DuplicatesView
                    photos={lib.filteredPhotos}
                    api={api}
                    sources={lib.sources}
                    selectedPhoto={selectedPhoto}
                    selectedPhotoIds={selectedIds}
                    onSelectPhoto={handleSelect}
                    onDoubleClickPhoto={handleDoubleClickPhoto}
                    onPhotosDeleted={handlePhotosDeleted}
                    onToggleRejected={lib.toggleRejected}
                    onToggleQuickCollection={handleToggleQuickCollection}
                    onExportPhotos={() => setIsExportModalOpen(true)}
                    onAutoRename={lib.autoRename}
                    onMovePhotos={() => setIsMoveModalOpen(true)}
                    onEditDate={() => setIsDateModalOpen(true)}
                    onSetEvent={lib.setEvent}
                    onBatchSetEvent={lib.batchSetEvent}
                    onShowInFolder={handleShowInFolder}
                  />
                ) : viewMode === "grid" ? (
                  <PhotoGrid
                    photos={lib.filteredPhotos}
                    selectedPhoto={selectedPhoto}
                    selectedPhotoIds={selectedIds}
                    onSelectPhoto={handleSelect}
                    onDoubleClickPhoto={handleDoubleClickPhoto}
                    onToggleRejected={lib.toggleRejected}
                    onToggleQuickCollection={handleToggleQuickCollection}
                    onExportPhotos={() => setIsExportModalOpen(true)}
                    onAutoRename={lib.autoRename}
                    onMovePhotos={() => setIsMoveModalOpen(true)}
                    onEditDate={() => setIsDateModalOpen(true)}
                    onSetEvent={lib.setEvent}
                    onBatchSetEvent={lib.batchSetEvent}
                    onShowInFolder={handleShowInFolder}
                    onPhotosDeleted={handlePhotosDeleted}
                    columnCount={columnCount}
                    columnWidth={effectiveColumnWidth}
                    gridWidth={gridWidth}
                    gridHeight={gridDimensions.height}
                  />
                ) : viewMode === "filmstrip" ? (
                  <FilmstripView
                    photos={lib.filteredPhotos}
                    selectedPhoto={selectedPhoto}
                    selectedPhotoIds={selectedIds}
                    largeImageUrl={effectiveLargeImageUrl}
                    onSelectPhoto={handleSelect}
                    onToggleRejected={lib.toggleRejected}
                    onToggleQuickCollection={handleToggleQuickCollection}
                    onExportPhotos={() => setIsExportModalOpen(true)}
                    onAutoRename={lib.autoRename}
                    onMovePhotos={() => setIsMoveModalOpen(true)}
                    onEditDate={() => setIsDateModalOpen(true)}
                    onSetEvent={lib.setEvent}
                    onBatchSetEvent={lib.batchSetEvent}
                    onShowInFolder={handleShowInFolder}
                    onPhotosDeleted={handlePhotosDeleted}
                    onClose={() => setViewMode("grid")}
                    onOpenInfo={() => setIsMetadataOpen(true)}
                    scrollRef={filmstripScrollRef}
                    isMobile={isMobile}
                    width={gridDimensions.width}
                  />
                ) : (
                  selectedPhoto && (
                    <CropView
                      photo={selectedPhoto}
                      imageUrl={effectiveLargeImageUrlUncropped || api.getAssetUrl(selectedPhoto.path)}
                      onCancel={() => setViewMode(previousViewMode)}
                      onApply={(crop) => {
                        lib.updateCrop(
                          selectedPhoto.id,
                          crop.top,
                          crop.left,
                          crop.bottom,
                          crop.right,
                          selectedPhoto.crop_angle ?? null
                        );
                        setViewMode(previousViewMode);
                      }}
                    />
                  )
                )}
              </div>
            </div>
          )}
        </main>

        {!isMobile && (
          <>
            {!metadataCollapsed && <Resizer onResize={handleMetadataResize} />}
            <MetadataPanel
              photo={selectedPhoto}
              selectedCount={selectedIds.size}
              updateExposure={lib.updateExposure}
              updatePortraitBlur={lib.updatePortraitBlur}
              updateMetadata={lib.updateMetadata}
              updateCrop={lib.updateCrop}
              onEnterCropMode={enterCropMode}
              collapsed={metadataCollapsed}
              onToggle={() => setMetadataCollapsed(true)}
              onEditTags={() => setIsTagModalOpen(true)}
              onEditDate={() => setIsDateModalOpen(true)}
              width={metadataWidth}
              sources={lib.sources}
            />
          </>
        )}
      </div>

      {isMobile && viewMode !== "filmstrip" && viewMode !== "crop" && (
        <BottomNavBar
          activeTab={mobileTab}
          onTabChange={(tab) => {
            setMobileTab(tab);
            if (tab === "library") {
              lib.setSelectedPath(null);
              lib.setSelectedTag(null);
              lib.setSelectedPerson(null);
              lib.setSidebarTab("folders");
            }
          }}
        />
      )}

      {isMobile && isMetadataOpen && (
        <div className="mobile-metadata-overlay">
          <MetadataPanel
            photo={selectedPhoto}
            selectedCount={selectedIds.size}
            updateExposure={lib.updateExposure}
            updatePortraitBlur={lib.updatePortraitBlur}
            updateMetadata={lib.updateMetadata}
            updateCrop={lib.updateCrop}
            onEnterCropMode={() => {
              setIsMetadataOpen(false);
              enterCropMode();
            }}
            collapsed={false}
            onToggle={() => setIsMetadataOpen(false)}
            onEditTags={() => setIsTagModalOpen(true)}
            onEditDate={() => setIsDateModalOpen(true)}
            isMobile={true}
            sources={lib.sources}
          />
        </div>
      )}

      <MovePhotosModal
        isOpen={isMoveModalOpen}
        onClose={() => setIsMoveModalOpen(false)}
        onMove={handleMoveSelectedPhotos}
        trees={Object.values(lib.trees)}
        selectedCount={selectedIds.size}
        initialPhoto={selectedPhoto}
      />

      <MoveFolderModal
        isOpen={folderToMove !== null}
        onClose={() => setFolderToMove(null)}
        folder={folderToMove}
        trees={Object.values(lib.trees)}
        onMoveFolder={handleMoveFolder}
      />

      <TagModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        allTags={lib.tags}
        initialTags={initialTags}
        partialTags={partialTags}
        onSave={handleSaveTags}
        selectedCount={selectedIds.size > 0 ? selectedIds.size : selectedPhoto ? 1 : 0}
      />

      <EditCaptureDateModal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        selectedPhotos={lib.filteredPhotos.filter((p) => selectedIds.has(p.id))}
        onUpdate={handleUpdateCaptureDate}
      />

      {isExportModalOpen && (
        <ExportModal
          selectedCount={selectedIds.size > 0 ? selectedIds.size : selectedPhoto ? 1 : 0}
          selectedIds={selectedIds.size > 0 ? Array.from(selectedIds) : selectedPhoto ? [selectedPhoto.id] : []}
          onClose={() => setIsExportModalOpen(false)}
          onExport={handleExportPhotos}
        />
      )}

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
          photos={lib.filteredPhotos}
          interval={slideshowInterval}
          kenBurns={slideshowKenBurns}
          shuffle={slideshowShuffle}
          sleepMode={slideshowSleepMode}
          sleepStart={slideshowSleepStart}
          sleepEnd={slideshowSleepEnd}
          onClose={() => setViewMode("grid")}
          picturesBase={lib.sources.length > 0 ? lib.sources[0].path : ""}
          onRefreshPhotos={() => lib.fetchPhotos(lib.searchQuery)}
        />
      )}

      <FolderSyncModal isOpen={isFolderModalOpen} onClose={() => setIsFolderModalOpen(false)} />
    </div>
  );
}

function App() {
  return (
    <ApiProvider>
      <AppContent />
    </ApiProvider>
  );
}

export default App;
