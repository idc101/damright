import { useState, useEffect, useMemo, useCallback } from "react";
import { usePhotos } from "./usePhotos";
import { useSources } from "./useSources";
import { usePhotoFilter } from "./usePhotoFilter";
import { parseSlideshowParams } from "../utils/slideshowParams";
import { MediaTypeFilter } from "../types";

export type LibraryTab = "photos" | "folders" | "tags" | "people" | "quick" | "duplicates" | "validation" | "icloud" | "rank";

export interface LibraryNavigationState {
  activeTab: LibraryTab;
  selectedPath: string | null;
  selectedTag: string | null;
  selectedPerson: string | null;
  searchQuery: string;
  searchScope: "global" | "local";
  validationFilter: "all" | "missing_event" | "missing_capture_time" | "bad_name" | "bad_folder";
  mediaTypeFilter: MediaTypeFilter;
  rejectedFilter: "hide" | "show_all" | "only_rejected";
}

export interface UseLibraryStateOptions {
  syncUrl?: boolean;
  defaultTab?: LibraryTab;
}

const normalizePath = (p: string) => p.replace(/\\/g, "/");

export function useLibraryState(options: UseLibraryStateOptions = {}) {
  const { syncUrl = false, defaultTab = "folders" } = options;

  const photoHook = usePhotos();
  const sourceHook = useSources();

  const {
    photos,
    searchQuery,
    fetchPhotos,
    fetchAllTags,
    fetchAllPeople,
  } = photoHook;

  const {
    sources,
    fetchSources,
  } = sourceHook;

  // Active Tab
  const [activeTab, setActiveTabState] = useState<LibraryTab>(() => {
    const saved = localStorage.getItem("selectedSidebarTab");
    const validTabs: LibraryTab[] = ["photos", "folders", "tags", "people", "quick", "duplicates", "validation", "icloud", "rank"];
    if (saved && validTabs.includes(saved as LibraryTab)) {
      return saved as LibraryTab;
    }
    return defaultTab;
  });

  const setActiveTab = useCallback((tab: LibraryTab) => {
    setActiveTabState(tab);
    localStorage.setItem("selectedSidebarTab", tab);
  }, []);

  // Selection state
  const [selectedPath, setSelectedPathState] = useState<string | null>(() => {
    return localStorage.getItem("selectedPath");
  });

  const setSelectedPath = useCallback((path: string | null) => {
    setSelectedPathState(path);
    if (path !== null) {
      localStorage.setItem("selectedPath", path);
    } else {
      localStorage.removeItem("selectedPath");
    }
  }, []);

  const [selectedTag, setSelectedTagState] = useState<string | null>(() => {
    return localStorage.getItem("selectedTag");
  });

  const setSelectedTag = useCallback((tag: string | null) => {
    setSelectedTagState(tag);
    if (tag !== null) {
      localStorage.setItem("selectedTag", tag);
    } else {
      localStorage.removeItem("selectedTag");
    }
  }, []);

  const [selectedPerson, setSelectedPersonState] = useState<string | null>(() => {
    return localStorage.getItem("selectedPerson");
  });

  const setSelectedPerson = useCallback((person: string | null) => {
    setSelectedPersonState(person);
    if (person !== null) {
      localStorage.setItem("selectedPerson", person);
    } else {
      localStorage.removeItem("selectedPerson");
    }
  }, []);

  // Filter criteria
  const [validationFilter, setValidationFilter] = useState<"all" | "missing_event" | "missing_capture_time" | "bad_name" | "bad_folder">("all");

  const [searchScope, setSearchScopeState] = useState<"global" | "local">(() => {
    return (localStorage.getItem("searchScope") as "global" | "local") || "global";
  });

  const setSearchScope = useCallback((scope: "global" | "local") => {
    setSearchScopeState(scope);
    localStorage.setItem("searchScope", scope);
  }, []);

  const [mediaTypeFilter, setMediaTypeFilterState] = useState<MediaTypeFilter>(() => {
    return (localStorage.getItem("mediaTypeFilter") as MediaTypeFilter) || "all";
  });

  const setMediaTypeFilter = useCallback((filter: MediaTypeFilter) => {
    setMediaTypeFilterState(filter);
    localStorage.setItem("mediaTypeFilter", filter);
  }, []);

  const [rejectedFilter, setRejectedFilterState] = useState<"hide" | "show_all" | "only_rejected">(() => {
    return (localStorage.getItem("rejectedFilter") as "hide" | "show_all" | "only_rejected") || "hide";
  });

  const setRejectedFilter = useCallback((filter: "hide" | "show_all" | "only_rejected") => {
    setRejectedFilterState(filter);
    localStorage.setItem("rejectedFilter", filter);
  }, []);

  // Initial data loading
  useEffect(() => {
    const init = async () => {
      let initialQuery: string | undefined = undefined;
      if (syncUrl && typeof window !== "undefined") {
        const parsed = parseSlideshowParams(window.location.search);
        if (parsed.searchQuery) {
          initialQuery = parsed.searchQuery;
        }
      }
      await fetchPhotos(initialQuery);
      await fetchAllTags();
      await fetchAllPeople();
      await fetchSources();
    };
    init();
  }, [syncUrl, fetchPhotos, fetchAllTags, fetchAllPeople, fetchSources]);

  // Search helpers
  const handleSearch = useCallback((query: string) => {
    fetchPhotos(query);
  }, [fetchPhotos]);

  const clearSearch = useCallback(() => {
    fetchPhotos("");
  }, [fetchPhotos]);

  // Canonical filtered collection
  // Map "photos" tab to "folders" with null path to display all photos
  const effectiveFilterTab = activeTab === "photos" ? "folders" : activeTab;
  const effectivePath = activeTab === "photos" ? null : selectedPath;
  const effectiveTag = activeTab === "photos" ? null : selectedTag;
  const effectivePerson = activeTab === "photos" ? null : selectedPerson;

  const filteredPhotos = usePhotoFilter(
    photos,
    sources,
    searchQuery,
    effectiveFilterTab as any,
    effectivePath,
    effectiveTag,
    effectivePerson,
    validationFilter,
    searchScope,
    mediaTypeFilter,
    rejectedFilter
  );

  // Derived folder hierarchy
  const allFolders = useMemo(() => {
    const folders = new Set<string>();
    photos.forEach((p) => {
      const norm = normalizePath(p.path);
      const lastSlash = norm.lastIndexOf("/");
      if (lastSlash !== -1) {
        folders.add(norm.substring(0, lastSlash));
      }
    });
    return Array.from(folders);
  }, [photos]);

  // Current level subfolders and direct photos (used for drilled-in mobile folder views)
  const currentLevelItems = useMemo(() => {
    if (!selectedPath) {
      return { subfolders: [], photos: [] };
    }

    const normCurrent = normalizePath(selectedPath);

    // Immediate subfolders
    const subfolderPaths = new Set<string>();
    allFolders.forEach((f) => {
      const normF = normalizePath(f);
      if (normF.startsWith(normCurrent + "/")) {
        const relative = normF.substring(normCurrent.length + 1);
        const firstSlash = relative.indexOf("/");
        if (firstSlash === -1) {
          subfolderPaths.add(normF);
        } else {
          subfolderPaths.add(normCurrent + "/" + relative.substring(0, firstSlash));
        }
      }
    });

    const subfolders = Array.from(subfolderPaths)
      .map((fpath) => {
        const name = fpath.split("/").pop() || fpath;
        const count = photos.filter((p) => normalizePath(p.path).startsWith(fpath + "/")).length;
        return {
          name,
          path: fpath,
          photoCount: count,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // Direct photos in this folder
    const directPhotos = photos.filter((p) => {
      if (p.rejected && rejectedFilter === "hide") return false;
      const normP = normalizePath(p.path);
      const lastSlash = normP.lastIndexOf("/");
      return lastSlash !== -1 && normP.substring(0, lastSlash) === normCurrent;
    }).sort((a, b) => {
      const timeA = a.capture_time || "";
      const timeB = b.capture_time || "";
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return a.path.localeCompare(b.path);
    });

    return {
      subfolders,
      photos: directPhotos,
    };
  }, [selectedPath, allFolders, photos, rejectedFilter]);

  // Drilldown / Back helper
  const navigateBack = useCallback(() => {
    if (activeTab === "folders" && selectedPath) {
      const normCurrent = normalizePath(selectedPath);
      const isSource = sources.some((s) => normalizePath(s.path) === normCurrent);
      if (isSource) {
        setSelectedPath(null);
        return;
      }

      const lastSlash = normCurrent.lastIndexOf("/");
      if (lastSlash !== -1) {
        setSelectedPath(normCurrent.substring(0, lastSlash));
      } else {
        setSelectedPath(null);
      }
      return;
    }

    if (activeTab === "tags" && selectedTag) {
      setSelectedTag(null);
      return;
    }

    if (activeTab === "people" && selectedPerson) {
      setSelectedPerson(null);
      return;
    }

    if (searchQuery) {
      clearSearch();
    }
  }, [activeTab, selectedPath, selectedTag, selectedPerson, searchQuery, sources, setSelectedPath, setSelectedTag, setSelectedPerson, clearSearch]);

  // Contextual Header Back Button configuration
  const headerBackButton = useMemo(() => {
    if (activeTab === "folders" && selectedPath) {
      return { label: "Folders", onClick: navigateBack };
    }
    if (activeTab === "tags" && selectedTag) {
      return { label: "Tags", onClick: () => setSelectedTag(null) };
    }
    if (activeTab === "people" && selectedPerson) {
      return { label: "People", onClick: () => setSelectedPerson(null) };
    }
    if (activeTab === "photos" && searchQuery) {
      return { label: "Photos", onClick: clearSearch };
    }
    return null;
  }, [activeTab, selectedPath, selectedTag, selectedPerson, searchQuery, navigateBack, setSelectedTag, setSelectedPerson, clearSearch]);

  // Contextual Header Title
  const headerTitle = useMemo(() => {
    if (activeTab === "folders") {
      if (selectedPath) {
        return selectedPath.split(/[/\\]/).pop() || selectedPath;
      }
      return "Folders";
    }
    if (activeTab === "tags") {
      return selectedTag ? selectedTag : "Tags";
    }
    if (activeTab === "people") {
      return selectedPerson ? selectedPerson : "People";
    }
    if (searchQuery) {
      return `Results for "${searchQuery}"`;
    }
    return "Photos";
  }, [activeTab, selectedPath, selectedTag, selectedPerson, searchQuery]);

  // Active View Photos (for rendering grid / lightbox navigation)
  const activeViewPhotos = useMemo(() => {
    if (activeTab === "folders" && selectedPath) {
      return currentLevelItems.photos;
    }
    return filteredPhotos;
  }, [activeTab, selectedPath, currentLevelItems.photos, filteredPhotos]);

  return useMemo(() => ({
    ...photoHook,
    ...sourceHook,
    // State
    activeTab,
    sidebarTab: activeTab,
    selectedPath,
    selectedTag,
    selectedPerson,
    validationFilter,
    searchScope,
    mediaTypeFilter,
    rejectedFilter,
    // Collections
    filteredPhotos,
    activeViewPhotos,
    allFolders,
    currentLevelItems,
    // Setters & Helpers
    setActiveTab,
    setSidebarTab: setActiveTab,
    selectFolder: setSelectedPath,
    setSelectedPath,
    selectTag: setSelectedTag,
    setSelectedTag,
    selectPerson: setSelectedPerson,
    setSelectedPerson,
    setValidationFilter,
    setSearchScope,
    setMediaTypeFilter,
    setRejectedFilter,
    handleSearch,
    clearSearch,
    navigateBack,
    headerTitle,
    headerBackButton,
  }), [
    photoHook,
    sourceHook,
    activeTab,
    selectedPath,
    selectedTag,
    selectedPerson,
    validationFilter,
    searchScope,
    mediaTypeFilter,
    rejectedFilter,
    filteredPhotos,
    activeViewPhotos,
    allFolders,
    currentLevelItems,
    setActiveTab,
    setSelectedPath,
    setSelectedTag,
    setSelectedPerson,
    setValidationFilter,
    setSearchScope,
    setMediaTypeFilter,
    setRejectedFilter,
    handleSearch,
    clearSearch,
    navigateBack,
    headerTitle,
    headerBackButton,
  ]);
}
