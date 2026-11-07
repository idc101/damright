import { FixedSizeGrid as Grid, areEqual } from "react-window";
import "./PhotoGrid.css";
import { Photo } from "../../types";
import { useEffect, useRef, memo, useMemo, useCallback, useState } from "react";
import { PhotoThumbnail } from "../common/PhotoThumbnail";
import { PhotoContextMenu } from "../common/PhotoContextMenu";
import { usePhotoContextMenu } from "../../hooks/usePhotoContextMenu";
import { TimelineScrubber } from "./TimelineScrubber";
import { buildTimelineIndex, formatPhotoDateHeader } from "../../utils/timeline";

interface PhotoGridProps {
  photos: Photo[];
  selectedPhoto: Photo | null;
  selectedPhotoIds: Set<string>;
  onSelectPhoto: (photo: Photo, modifiers?: { shift?: boolean, ctrl?: boolean, meta?: boolean }) => void;
  onDoubleClickPhoto: (photo: Photo) => void;
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
  columnCount: number;
  columnWidth: number;
  gridWidth: number;
  gridHeight: number;
}

interface PhotoCellData {
  photos: Photo[];
  selectedPhotoId?: string;
  selectedPhotoIds: Set<string>;
  onSelectPhoto: (photo: Photo, modifiers?: { shift?: boolean, ctrl?: boolean, meta?: boolean }) => void;
  onDoubleClickPhoto: (photo: Photo) => void;
  onContextMenu: (e: React.MouseEvent, photo: Photo) => void;
  columnCount: number;
}

const PhotoCell = memo(({ columnIndex, rowIndex, style, data }: any) => {
  const { photos, selectedPhotoId, selectedPhotoIds, onSelectPhoto, onDoubleClickPhoto, onContextMenu, columnCount } = data as PhotoCellData;
  const index = rowIndex * columnCount + columnIndex;
  const photo = photos[index];

  if (!photo) return null;

  return (
    <PhotoThumbnail
      photo={photo}
      isSelected={selectedPhotoIds.has(photo.id)}
      isActive={selectedPhotoId === photo.id}
      onSelect={onSelectPhoto}
      onDoubleClick={onDoubleClickPhoto}
      onContextMenu={onContextMenu}
      style={style}
    />
  );
}, areEqual);

export function PhotoGrid({
  photos,
  selectedPhoto,
  selectedPhotoIds,
  onSelectPhoto,
  onDoubleClickPhoto,
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
  columnCount,
  columnWidth,
  gridWidth,
  gridHeight,
}: PhotoGridProps) {
  const gridRef = useRef<Grid>(null);
  const { contextMenu, handleContextMenu, closeContextMenu } = usePhotoContextMenu();

  useEffect(() => {
    if (selectedPhoto && gridRef.current) {
      const index = photos.findIndex((p) => p.id === selectedPhoto.id);
      if (index !== -1) {
        gridRef.current.scrollToItem({
          align: "smart",
          columnIndex: index % columnCount,
          rowIndex: Math.floor(index / columnCount),
        });
      }
    }
  }, [selectedPhoto, columnCount, photos]);

  const selectedPhotoIdsRef = useRef(selectedPhotoIds);
  selectedPhotoIdsRef.current = selectedPhotoIds;

  const onSelectPhotoRef = useRef(onSelectPhoto);
  onSelectPhotoRef.current = onSelectPhoto;

  const onContextMenu = useCallback((e: React.MouseEvent, photo: Photo) => {
    handleContextMenu(e, photo, onSelectPhotoRef.current, selectedPhotoIdsRef.current.has(photo.id));
  }, [handleContextMenu]);

  const itemData = useMemo<PhotoCellData>(() => ({
    photos,
    selectedPhotoId: selectedPhoto?.id,
    selectedPhotoIds,
    onSelectPhoto,
    onDoubleClickPhoto,
    onContextMenu: onContextMenu,
    columnCount,
  }), [photos, selectedPhoto?.id, selectedPhotoIds, onSelectPhoto, onDoubleClickPhoto, columnCount, onContextMenu]);

  const [currentTimelineTitle, setCurrentTimelineTitle] = useState<string | null>(null);

  useEffect(() => {
    setCurrentTimelineTitle(null);
  }, [photos]);

  const timelineIndex = useMemo(
    () => buildTimelineIndex(photos),
    [photos]
  );

  const handleScrub = useCallback(
    (targetIndex: number) => {
      if (gridRef.current && columnCount > 0) {
        const rowIndex = Math.floor(targetIndex / columnCount);
        gridRef.current.scrollToItem({
          rowIndex,
          align: "start",
        });
      }
    },
    [columnCount]
  );

  const handleItemsRendered = useCallback(
    ({ visibleRowStartIndex }: { visibleRowStartIndex: number }) => {
      if (columnCount <= 0 || photos.length === 0) return;
      const visibleIdx = Math.min(
        visibleRowStartIndex * columnCount,
        photos.length - 1
      );
      const photo = photos[visibleIdx];
      if (photo) {
        const title = formatPhotoDateHeader(photo);
        setCurrentTimelineTitle((prev) => (prev === title ? prev : title));
      }
    },
    [columnCount, photos]
  );

  if (photos.length === 0) {
    return <div className="empty-state">No photos found.</div>;
  }

  const displayTitle = currentTimelineTitle || (photos.length > 0 ? formatPhotoDateHeader(photos[0]) : "Photos");

  return (
    <div className="grid-container">
      <div className="photo-grid-header" data-testid="photo-grid-header">
        <div className="photo-grid-header-glass">
          <h2 className="photo-grid-title" data-testid="photo-grid-title">
            {displayTitle}
          </h2>
          <span className="photo-grid-count" data-testid="photo-grid-count">
            {photos.length.toLocaleString()} {photos.length === 1 ? "item" : "items"}
          </span>
        </div>
      </div>

      <Grid
        ref={gridRef}
        columnCount={columnCount}
        columnWidth={columnWidth}
        height={gridHeight}
        rowCount={Math.ceil(photos.length / columnCount)}
        rowHeight={columnWidth}
        width={gridWidth}
        itemData={itemData}
        onItemsRendered={handleItemsRendered}
      >
        {PhotoCell}
      </Grid>

      <TimelineScrubber
        years={timelineIndex.years}
        onScrub={handleScrub}
      />

      {contextMenu && (
        <PhotoContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          photo={contextMenu.photo}
          selectedIds={selectedPhotoIds}
          onClose={closeContextMenu}
          onToggleRejected={onToggleRejected}
          onToggleQuickCollection={onToggleQuickCollection}
          onExportPhotos={onExportPhotos}
          onAutoRename={onAutoRename}
          onMovePhotos={onMovePhotos}
          onEditDate={onEditDate}
          onSetEvent={onSetEvent}
          onBatchSetEvent={onBatchSetEvent}
          onShowInFolder={onShowInFolder}
          onPhotosDeleted={onPhotosDeleted}
        />
      )}
    </div>
  );
}
