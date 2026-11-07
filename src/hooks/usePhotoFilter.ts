import { useMemo } from "react";
import { Photo, Source, MediaTypeFilter } from "../types";

export function isIncorrectName(photo: Photo): boolean {
  return photo.validation_issues?.includes("bad_name") || false;
}

export function isIncorrectFolder(photo: Photo): boolean {
  return photo.validation_issues?.includes("bad_folder") || false;
}

export function usePhotoFilter(
  photos: Photo[],
  sources: Source[],
  searchQuery: string,
  sidebarTab: "folders" | "tags" | "people" | "quick" | "duplicates" | "validation" | "icloud",
  selectedPath: string | null,
  selectedTag: string | null,
  selectedPerson: string | null,
  validationFilter: "all" | "missing_event" | "missing_capture_time" | "bad_name" | "bad_folder" = "all",
  searchScope: "global" | "local" = "global",
  mediaTypeFilter: MediaTypeFilter = "all",
  rejectedFilter: "hide" | "show_all" | "only_rejected" = "hide"
) {
  return useMemo(() => {
    let filtered: Photo[];

    const hasActiveSelection = (sidebarTab === "folders" && selectedPath !== null) ||
                              (sidebarTab === "tags" && selectedTag !== null) ||
                              (sidebarTab === "people" && selectedPerson !== null);

    const activeScope = (searchScope === "local" && hasActiveSelection) ? "local" : "global";
    const isGlobalSearch = Boolean(searchQuery && activeScope === "global");

    const normalizePath = (p: string) => p.replace(/\\/g, "/");

    if (sidebarTab === "duplicates") {
      const hashCounts = new Map<string, number>();
      photos.forEach(p => {
        if (p.perceptual_hash) {
          hashCounts.set(p.perceptual_hash, (hashCounts.get(p.perceptual_hash) || 0) + 1);
        }
      });
      filtered = photos
        .filter(p => p.perceptual_hash && (hashCounts.get(p.perceptual_hash) || 0) > 1)
        .sort((a, b) => (a.perceptual_hash || '').localeCompare(b.perceptual_hash || ''));
    } else if (sidebarTab === "validation") {
      filtered = photos.filter(p => {
        const hasEventIssue = p.validation_issues?.includes("missing_event") || false;
        const hasCaptureTimeIssue = p.validation_issues?.includes("missing_capture_time") || false;
        const hasNameIssue = p.validation_issues?.includes("bad_name") || false;
        const hasFolderIssue = p.validation_issues?.includes("bad_folder") || false;

        if (validationFilter === "missing_event") {
          return hasEventIssue;
        } else if (validationFilter === "missing_capture_time") {
          return hasCaptureTimeIssue;
        } else if (validationFilter === "bad_name") {
          return hasNameIssue;
        } else if (validationFilter === "bad_folder") {
          return hasFolderIssue;
        } else {
          return !p.validation_is_valid;
        }
      });
    } else if (isGlobalSearch) {
      filtered = photos;
    } else if (sidebarTab === "folders") {
      if (!selectedPath) {
        filtered = photos.filter(p => sources.some(s => normalizePath(p.path).startsWith(normalizePath(s.path))));
      } else {
        const normSelected = normalizePath(selectedPath);
        filtered = photos.filter(p => normalizePath(p.path).startsWith(normSelected));
      }
    } else if (sidebarTab === "tags") {
      if (!selectedTag) {
        filtered = photos.filter(p => sources.some(s => normalizePath(p.path).startsWith(normalizePath(s.path))));
      } else {
        const sLower = selectedTag.toLowerCase();
        filtered = photos.filter(p => (p.tags || '').split(',').map(t => t.trim().toLowerCase()).includes(sLower));
      }
    } else if (sidebarTab === "quick") {
      filtered = photos.filter(p => p.in_quick_collection);
    } else if (sidebarTab === "people") {
      // people tab
      if (!selectedPerson) {
        filtered = photos.filter(p => sources.some(s => normalizePath(p.path).startsWith(normalizePath(s.path))));
      } else {
        const pLower = selectedPerson.toLowerCase();
        filtered = photos.filter(p => {
          const hasFace = p.faces?.some(f => (f.name || "").toLowerCase() === pLower);
          if (hasFace) return true;
          const tagList = (p.tags || "").split(",").map(t => t.trim().toLowerCase());
          return tagList.includes(pLower);
        });
      }
    } else {
      // icloud tab: return empty array since we don't display standard grid
      filtered = [];
    }

    // Apply media type filter
    const isMd = (p: Photo) => p.mime_type === "text/markdown" || p.path.toLowerCase().endsWith(".md") || p.path.toLowerCase().endsWith(".markdown");
    if (mediaTypeFilter === "images") {
      filtered = filtered.filter(p => !isMd(p) && p.mime_type.startsWith("image/"));
    } else if (mediaTypeFilter === "videos") {
      filtered = filtered.filter(p => p.mime_type.startsWith("video/"));
    } else if (mediaTypeFilter === "markdown") {
      filtered = filtered.filter(isMd);
    }

    // Apply rejected filter
    if (rejectedFilter === "hide") {
      filtered = filtered.filter(p => !p.rejected);
    } else if (rejectedFilter === "only_rejected") {
      filtered = filtered.filter(p => p.rejected);
    }

    if (sidebarTab === "duplicates" && !isGlobalSearch) {
      return filtered;
    }

    // Sort all other views by capture_time ascending
    return [...filtered].sort((a, b) => {
      const timeA = a.capture_time || "";
      const timeB = b.capture_time || "";
      if (timeA !== timeB) {
        return timeA.localeCompare(timeB);
      }
      return a.path.localeCompare(b.path);
    });
  }, [
    photos,
    selectedPath,
    sources,
    sidebarTab,
    selectedTag,
    selectedPerson,
    searchQuery,
    validationFilter,
    searchScope,
    mediaTypeFilter,
    rejectedFilter
  ]);
}
