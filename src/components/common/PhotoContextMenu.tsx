import React from "react";
import { Ban, Type, Move, ExternalLink, Calendar, MapPin, Folder, Trash2, Bookmark, Download } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { Photo } from "../../types";

interface PhotoContextMenuProps {
  x: number;
  y: number;
  photo: Photo;
  selectedIds: Set<string>;
  onClose: () => void;
  onToggleRejected: (id: string) => void;
  onToggleQuickCollection?: () => void;
  onExportPhotos?: () => void;
  onAutoRename: (path: string, id?: string) => Promise<number>;
  onMovePhotos: () => void;
  onEditDate: () => void;
  onSetEvent: (id: string, event: string | null) => void;
  onBatchSetEvent: (ids: string[], event: string | null) => void;
  onShowInFolder?: (photo: Photo) => void;
  onPhotosDeleted?: () => void;
}

export const PhotoContextMenu: React.FC<PhotoContextMenuProps> = ({
  x,
  y,
  photo,
  selectedIds,
  onClose,
  onToggleRejected,
  onToggleQuickCollection,
  onExportPhotos,
  onAutoRename,
  onMovePhotos,
  onEditDate,
  onSetEvent,
  onBatchSetEvent,
  onShowInFolder,
  onPhotosDeleted,
}) => {
  const selectedCount = selectedIds.size;
  
  const handleReveal = () => {
    invoke("reveal_in_finder", { path: photo.path });
    onClose();
  };

  const handleAutoRename = async () => {
    onClose();
    try {
      const confirmed = await confirm(
        `Are you sure you want to rename ${selectedCount > 1 ? `these ${selectedCount} photos` : "this photo"}? This will modify the file(s) on disk.`,
        { title: 'Confirm Auto-Rename', kind: 'info' }
      );

      if (confirmed) {
        if (selectedCount > 1) {
            // Bulk rename loop (placeholder)
            /*
            for (const id of Array.from(selectedIds)) {
                // await onAutoRename(path, id);
            }
            */
        } else {
            await onAutoRename(photo.path, photo.id);
        }
        await message(`Rename complete.`, { title: 'Auto-Rename Complete', kind: 'info' });
      }
    } catch (err) {
      console.error("Failed to auto-rename photo:", err);
    }
  };

  const handleSetEventFromFolder = () => {
    onClose();
    const getFolderName = (p: string) => {
        const parts = p.split(/[/\\]/);
        return parts[parts.length - 2] || "Unknown Event"; // Parent folder
    };

    const eventName = getFolderName(photo.path);
    if (selectedCount > 1) {
        onBatchSetEvent(Array.from(selectedIds), eventName);
    } else {
        onSetEvent(photo.id, eventName);
    }
  };

  const handleClearEvent = () => {
    onClose();
    if (selectedCount > 1) {
        onBatchSetEvent(Array.from(selectedIds), null);
    } else {
        onSetEvent(photo.id, null);
    }
  };

  const handleDeletePhoto = async () => {
    onClose();
    try {
      const isBatch = selectedCount > 1;
      const confirmMessage = isBatch 
        ? `Are you sure you want to permanently delete these ${selectedCount} files? This will delete the image files, XMP sidecars, and thumbnails from disk.`
        : `Are you sure you want to permanently delete this file? This will delete the image file, XMP sidecars, and thumbnails from disk.`;
      const confirmTitle = isBatch ? 'Confirm Delete Files' : 'Confirm Delete File';
      let confirmed = false;
      try {
        confirmed = await confirm(confirmMessage, { title: confirmTitle, kind: 'warning' });
      } catch {
        confirmed = window.confirm(confirmMessage);
      }
      
      if (confirmed) {
        if (isBatch) {
          for (const id of Array.from(selectedIds)) {
            await invoke("delete_photo", { id });
          }
        } else {
          await invoke("delete_photo", { id: photo.id });
        }
        if (onPhotosDeleted) {
          onPhotosDeleted();
        }
      }
    } catch (err) {
      console.error("Failed to delete photo:", err);
    }
  };

  return (
    <div 
      className="context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {selectedCount > 1 ? (
        <>
          {onExportPhotos && (
            <button onClick={() => { onExportPhotos(); onClose(); }}>
              <Download size={14} /> Export {selectedCount} Photos... (Cmd+E)
            </button>
          )}
          <button onClick={() => { onMovePhotos(); onClose(); }}>
            <Move size={14} /> Move {selectedCount} Photos...
          </button>
          <button onClick={() => { onEditDate(); onClose(); }}>
            <Calendar size={14} /> Edit Dates for {selectedCount} Photos...
          </button>
          <button onClick={handleSetEventFromFolder}>
            <MapPin size={14} /> Set Event from Folder for {selectedCount} Photos
          </button>
          <button onClick={handleClearEvent}>
            <MapPin size={14} style={{ opacity: 0.5 }} /> Clear Event
          </button>
          <button onClick={handleDeletePhoto} style={{ color: "#ef4444" }}>
            <Trash2 size={14} style={{ color: "#ef4444" }} /> Delete {selectedCount} Files...
          </button>
        </>
      ) : (
        <>
          {onShowInFolder && (
            <button onClick={() => { onShowInFolder(photo); onClose(); }}>
              <Folder size={14} /> Show in Folder
            </button>
          )}
          <button onClick={handleReveal}>
            <ExternalLink size={14} /> Reveal in Finder
          </button>
          <button onClick={() => { onToggleRejected(photo.id); onClose(); }}>
            <Ban size={14} /> {photo.rejected ? "Un-reject Photo" : "Reject Photo (x)"}
          </button>
          {onToggleQuickCollection && (
            <button onClick={() => { onToggleQuickCollection(); onClose(); }}>
              <Bookmark size={14} /> {photo.in_quick_collection ? "Remove from Quick Collection (b)" : "Add to Quick Collection (b)"}
            </button>
          )}
          <button onClick={handleAutoRename}>
            <Type size={14} /> Auto Rename Photo
          </button>
          {onExportPhotos && (
            <button onClick={() => { onExportPhotos(); onClose(); }}>
              <Download size={14} /> Export Photo... (Cmd+E)
            </button>
          )}
          <button onClick={() => { onMovePhotos(); onClose(); }}>
            <Move size={14} /> Move Photo...
          </button>
          <button onClick={() => { onEditDate(); onClose(); }}>
            <Calendar size={14} /> Edit Capture Date...
          </button>
          <button onClick={handleSetEventFromFolder}>
            <MapPin size={14} /> Set Event from Folder Name
          </button>
          {photo.event && (
            <button onClick={handleClearEvent}>
              <MapPin size={14} style={{ opacity: 0.5 }} /> Clear Event
            </button>
          )}
          <button onClick={handleDeletePhoto} style={{ color: "#ef4444" }}>
            <Trash2 size={14} style={{ color: "#ef4444" }} /> Delete File
          </button>
        </>
      )}
    </div>
  );
};
