import { useEffect } from "react";
import { Photo } from "../types";

interface KeyboardShortcutProps {
  selectedPhoto: Photo | null;
  selectedIds: Set<string>;
  filteredPhotos: Photo[];
  viewMode: string;
  columnCount: number;
  isMoveModalOpen: boolean;
  isTagModalOpen: boolean;
  isDateModalOpen?: boolean;
  isExportModalOpen?: boolean;
  handleSelect: (photo: Photo, modifiers: { shift: boolean; ctrl: boolean; meta: boolean }) => void;
  selectAll?: () => void;
  toggleQuickCollection?: () => void;
  toggleRejected: (id: string) => void;
  batchUpdateMetadata: (ids: string[], rating?: number, tags?: string, title?: string, description?: string, addTags?: string[], removeTags?: string[]) => Promise<void>;
  deleteSelectedPhotos?: () => Promise<void> | void;
  setIsMoveModalOpen: (open: boolean) => void;
  setIsTagModalOpen: (open: boolean) => void;
  setIsExportModalOpen?: (open: boolean) => void;
  setViewMode: (mode: "grid" | "filmstrip" | "crop" | "slideshow") => void;
}

export function useKeyboardShortcuts({
  selectedPhoto,
  selectedIds,
  filteredPhotos,
  viewMode,
  columnCount,
  isMoveModalOpen,
  isTagModalOpen,
  isDateModalOpen = false,
  isExportModalOpen = false,
  handleSelect,
  selectAll,
  toggleQuickCollection,
  toggleRejected,
  batchUpdateMetadata,
  deleteSelectedPhotos,
  setIsMoveModalOpen,
  setIsTagModalOpen,
  setIsExportModalOpen,
  setViewMode
}: KeyboardShortcutProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      // Ignore all dashboard shortcuts when in slideshow mode
      if (viewMode === "slideshow") return;

      // Don't trigger shortcuts if a modal is open
      if (isMoveModalOpen || isTagModalOpen || isExportModalOpen || isDateModalOpen) return;

      // Cmd+A / Ctrl+A to select all photos
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll?.();
        return;
      }

      // Cmd+E / Ctrl+E to export selected photos
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setIsExportModalOpen?.(true);
        return;
      }

      // Delete / Backspace to delete selected photo(s)
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedPhotos?.();
        return;
      }

      if (!selectedPhoto) return;

      // Rating shortcuts
      if (e.key >= "0" && e.key <= "5") {
        e.preventDefault();
        batchUpdateMetadata(Array.from(selectedIds), Number(e.key));
        return;
      }

      // Dialog shortcuts
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setIsMoveModalOpen(true);
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setIsTagModalOpen(true);
        return;
      }

      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        toggleRejected(selectedPhoto.id);
        return;
      }

      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        toggleQuickCollection?.();
        return;
      }

      const currentIndex = filteredPhotos.findIndex(p => p.id === selectedPhoto.id);
      if (currentIndex === -1) return;

      const modifiers = { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey };

      if (viewMode === "filmstrip") {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const next = Math.min(currentIndex + 1, filteredPhotos.length - 1);
          handleSelect(filteredPhotos[next], modifiers);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          const prev = Math.max(currentIndex - 1, 0);
          handleSelect(filteredPhotos[prev], modifiers);
        } else if (e.key === "Escape") {
          e.preventDefault();
          setViewMode("grid");
        }
      } else {
        // Grid mode navigation
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const next = Math.min(currentIndex + 1, filteredPhotos.length - 1);
          handleSelect(filteredPhotos[next], modifiers);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          const prev = Math.max(currentIndex - 1, 0);
          handleSelect(filteredPhotos[prev], modifiers);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = Math.min(currentIndex + columnCount, filteredPhotos.length - 1);
          handleSelect(filteredPhotos[next], modifiers);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const prev = Math.max(currentIndex - columnCount, 0);
          handleSelect(filteredPhotos[prev], modifiers);
        } else if (e.key === "Enter") {
          e.preventDefault();
          setViewMode("filmstrip");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedPhoto, 
    viewMode, 
    filteredPhotos, 
    handleSelect, 
    selectAll,
    toggleQuickCollection,
    columnCount, 
    toggleRejected, 
    deleteSelectedPhotos,
    isMoveModalOpen, 
    isTagModalOpen, 
    isDateModalOpen,
    isExportModalOpen, 
    selectedIds, 
    batchUpdateMetadata,
    setIsMoveModalOpen,
    setIsTagModalOpen,
    setIsExportModalOpen,
    setViewMode
  ]);
}
