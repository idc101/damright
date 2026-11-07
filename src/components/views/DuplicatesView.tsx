import React, { useMemo, useState, useCallback } from "react";
import { Trash2, Copy, CheckCircle2 } from "lucide-react";
import { Photo, Source } from "../../types";
import { ApiService } from "../../services/api";
import { PhotoContextMenu } from "../common/PhotoContextMenu";
import { getRelativeFolderPath, comparePhotoQuality } from "../../utils/pathUtils";
import "./DuplicatesView.css";

interface DuplicatesViewProps {
  photos: Photo[];
  api: ApiService;
  sources?: Source[];
  selectedPhoto?: Photo | null;
  selectedPhotoIds?: Set<string>;
  onSelectPhoto?: (photo: Photo, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }) => void;
  onDoubleClickPhoto?: (photo: Photo) => void;
  onPhotosDeleted?: () => void;
  onToggleRejected?: (id: string) => void;
  onToggleQuickCollection?: (ids?: string[]) => void;
  onExportPhotos?: () => void;
  onAutoRename?: (path: string, id?: string) => Promise<number>;
  onMovePhotos?: () => void;
  onEditDate?: () => void;
  onSetEvent?: (id: string, event: string | null) => void;
  onBatchSetEvent?: (ids: string[], event: string | null) => void;
  onShowInFolder?: (photo: Photo) => void;
}

export function formatFileSize(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "Unknown size";
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function formatCaptureDate(captureTime?: string | null): string {
  if (!captureTime) return "Unknown date";
  try {
    const d = new Date(captureTime);
    if (isNaN(d.getTime())) return captureTime;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return captureTime;
  }
}

export const DuplicatesView: React.FC<DuplicatesViewProps> = ({
  photos,
  api,
  sources,
  selectedPhoto,
  selectedPhotoIds = new Set(),
  onSelectPhoto,
  onDoubleClickPhoto,
  onPhotosDeleted,
  onToggleRejected,
  onToggleQuickCollection,
  onExportPhotos,
  onAutoRename,
  onMovePhotos,
  onEditDate,
  onSetEvent,
  onBatchSetEvent,
  onShowInFolder,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; photo: Photo } | null>(null);
  const [checkedPhotoIds, setCheckedPhotoIds] = useState<Set<string>>(new Set());

  const duplicateGroups = useMemo(() => {
    const groupsMap = new Map<string, Photo[]>();
    photos.forEach((photo) => {
      if (photo.perceptual_hash) {
        const group = groupsMap.get(photo.perceptual_hash) || [];
        group.push(photo);
        groupsMap.set(photo.perceptual_hash, group);
      }
    });

    const result: { hash: string; photos: Photo[] }[] = [];
    for (const [hash, groupPhotos] of groupsMap.entries()) {
      if (groupPhotos.length > 1) {
        const sortedPhotos = [...groupPhotos].sort((a, b) => comparePhotoQuality(b, a, sources));
        result.push({ hash, photos: sortedPhotos });
      }
    }

    return result.sort((a, b) => b.photos.length - a.photos.length || a.hash.localeCompare(b.hash));
  }, [photos, sources]);

  const totalDuplicatesCount = useMemo(() => {
    return duplicateGroups.reduce((sum, g) => sum + g.photos.length, 0);
  }, [duplicateGroups]);

  const isHighestQuality = useCallback((photo: Photo, groupPhotos: Photo[]): boolean => {
    if (groupPhotos.length <= 1) return false;
    return groupPhotos[0]?.id === photo.id;
  }, []);

  const toggleCheckPhoto = (photoId: string, e?: React.MouseEvent | React.ChangeEvent) => {
    e?.stopPropagation();
    setCheckedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (checkedPhotoIds.size === 0) return;

    const count = checkedPhotoIds.size;
    const message = `Are you sure you want to delete ${count} selected photo${count === 1 ? "" : "s"}? This will permanently delete the file${count === 1 ? "" : "s"}, XMP sidecars, and thumbnails from disk.`;

    let confirmed = false;
    try {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      confirmed = await confirm(message, {
        title: "Confirm Delete Selected Photos",
        kind: "warning",
      });
    } catch {
      confirmed = window.confirm(message);
    }

    if (!confirmed) return;

    const idsToDelete = Array.from(checkedPhotoIds);
    try {
      for (const id of idsToDelete) {
        await api.deletePhoto(id);
      }
      setCheckedPhotoIds(new Set());
      if (onPhotosDeleted) {
        onPhotosDeleted();
      }
    } catch (err) {
      console.error("Failed to delete selected duplicate photos:", err);
      alert(`Failed to delete selected photos: ${err}`);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, photo: Photo) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, photo });
  };

  return (
    <div className="duplicates-container" data-testid="duplicates-view">
      <div className="duplicates-header">
        <div className="duplicates-title-row">
          <h2>Duplicate Photos</h2>
          <span className="duplicates-badge" data-testid="duplicates-count-badge">
            {duplicateGroups.length} {duplicateGroups.length === 1 ? "Group" : "Groups"} ({totalDuplicatesCount} Photos)
          </span>
          <div className="duplicates-actions">
            <button
              className="delete-selected-btn"
              onClick={handleDeleteSelected}
              disabled={checkedPhotoIds.size === 0}
              data-testid="delete-selected-btn"
            >
              <Trash2 size={15} />
              <span>
                {checkedPhotoIds.size > 0
                  ? `Delete Selected (${checkedPhotoIds.size})`
                  : "Delete Selected"}
              </span>
            </button>
          </div>
        </div>
        <div className="duplicates-description">
          Review duplicate images side by side with key metadata (size, date, filename, filepath) and remove unwanted copies.
        </div>
      </div>

      {duplicateGroups.length === 0 ? (
        <div className="duplicates-empty" data-testid="duplicates-empty-state">
          <CheckCircle2 size={48} className="empty-icon" />
          <h3>No Duplicate Photos Found</h3>
          <p>All photos in your library have unique perceptual hashes.</p>
        </div>
      ) : (
        <div className="duplicate-groups-list">
          {duplicateGroups.map((group, groupIdx) => (
            <div key={group.hash} className="duplicate-group-card" data-testid={`duplicate-group-${groupIdx}`}>
              <div className="group-header-bar">
                <div className="group-header-info">
                  <span className="group-title">
                    <Copy size={16} style={{ display: "inline-block", marginRight: "6px", verticalAlign: "middle" }} />
                    Duplicate Pair #{groupIdx + 1}
                  </span>
                  <span className="group-hash" title={`Perceptual Hash: ${group.hash}`}>
                    Hash: {group.hash.slice(0, 12)}...
                  </span>
                </div>
                <span className="group-count">{group.photos.length} copies</span>
              </div>

              <div className="group-items-row">
                {group.photos.map((photo, photoIdx) => {
                  const filename = photo.path.split(/[/\\]/).pop() || photo.path;
                  const lastSepIdx = Math.max(photo.path.lastIndexOf("/"), photo.path.lastIndexOf("\\"));
                  const folderPath = lastSepIdx !== -1 ? photo.path.substring(0, lastSepIdx) : photo.path;
                  const relativeFolderPath = getRelativeFolderPath(photo.path, sources);
                  const formattedSize = formatFileSize(photo.file_size);
                  const formattedDate = formatCaptureDate(photo.capture_time);
                  const resolution = (photo.width && photo.height) ? `${photo.width} × ${photo.height}` : "Unknown";
                  const bestQuality = isHighestQuality(photo, group.photos);
                  const isSelected = selectedPhoto?.id === photo.id || selectedPhotoIds.has(photo.id);
                  const isChecked = checkedPhotoIds.has(photo.id);

                  return (
                    <div
                      key={photo.id}
                      className={`duplicate-item-card ${isSelected ? "selected" : ""} ${isChecked ? "checked-for-delete" : ""}`}
                      onClick={(e) =>
                        onSelectPhoto?.(photo, { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey })
                      }
                      onDoubleClick={() => onDoubleClickPhoto?.(photo)}
                      onContextMenu={(e) => handleContextMenu(e, photo)}
                      data-testid={`duplicate-card-${photo.id}`}
                    >
                      <div className="item-action-bar">
                        <div className="item-badge-container">
                          <label className="checkbox-wrapper" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => toggleCheckPhoto(photo.id, e)}
                              className="duplicate-checkbox"
                              data-testid={`select-checkbox-${photo.id}`}
                            />
                            <span className="item-index-badge">Copy #{photoIdx + 1}</span>
                          </label>
                          {bestQuality && (
                            <span className="quality-badge" title="Highest resolution or largest file size in group">
                              Best Quality
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="item-preview-container">
                        <img
                          src={api.getAssetUrl(photo.thumb_path || photo.path, true)}
                          alt={filename}
                          className="item-preview-img"
                        />
                      </div>

                      <div className="item-metadata-box">
                        <div className="meta-row" data-testid={`meta-filename-${photo.id}`}>
                          <span className="meta-label">Filename:</span>
                          <span className="meta-value filename-value" title={filename}>
                            {filename}
                          </span>
                        </div>
                        <div className="meta-row" data-testid={`meta-filepath-${photo.id}`}>
                          <span className="meta-label">Filepath:</span>
                          <span className="meta-value filepath-value" title={folderPath}>
                            {relativeFolderPath}
                          </span>
                        </div>
                        <div className="meta-row" data-testid={`meta-resolution-${photo.id}`}>
                          <span className="meta-label">Resolution:</span>
                          <span className="meta-value">{resolution}</span>
                        </div>
                        <div className="meta-row" data-testid={`meta-size-${photo.id}`}>
                          <span className="meta-label">Size:</span>
                          <span className="meta-value">{formattedSize}</span>
                        </div>
                        <div className="meta-row" data-testid={`meta-date-${photo.id}`}>
                          <span className="meta-label">Date:</span>
                          <span className="meta-value">{formattedDate}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {contextMenu && (
        <PhotoContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          photo={contextMenu.photo}
          selectedIds={selectedPhotoIds}
          onClose={() => setContextMenu(null)}
          onToggleRejected={onToggleRejected || (() => {})}
          onToggleQuickCollection={onToggleQuickCollection}
          onExportPhotos={onExportPhotos}
          onAutoRename={onAutoRename || (async () => 0)}
          onMovePhotos={onMovePhotos || (() => {})}
          onEditDate={onEditDate || (() => {})}
          onSetEvent={onSetEvent || (() => {})}
          onBatchSetEvent={onBatchSetEvent || (() => {})}
          onShowInFolder={onShowInFolder}
          onPhotosDeleted={onPhotosDeleted}
        />
      )}
    </div>
  );
};
