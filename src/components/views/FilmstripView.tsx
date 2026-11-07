import { X, Loader2, PlayCircle, Info } from "lucide-react";
import "./FilmstripView.css";
import { Photo } from "../../types";
import { RefObject, useEffect, useRef, useState, useCallback, memo, useMemo } from "react";
import { FixedSizeList, areEqual, ListChildComponentProps } from "react-window";
import { PhotoPreview } from "../common/PhotoPreview";
import { PhotoThumbnail } from "../common/PhotoThumbnail";
import { PhotoContextMenu } from "../common/PhotoContextMenu";
import { MarkdownReader } from "../common/MarkdownReader";
import { usePhotoContextMenu } from "../../hooks/usePhotoContextMenu";
import { useApi } from "../../services/ApiProvider";

interface FilmstripViewProps {
  photos: Photo[];
  selectedPhoto: Photo | null;
  selectedPhotoIds: Set<string>;
  largeImageUrl: string | null;
  onSelectPhoto: (photo: Photo, modifiers?: { shift?: boolean, ctrl?: boolean, meta?: boolean }) => void;
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
  onClose: () => void;
  onOpenInfo?: () => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
  isMobile?: boolean;
  width?: number;
}

interface FilmstripCellData {
  photos: Photo[];
  selectedPhotoId?: string;
  selectedPhotoIds: Set<string>;
  onSelectPhoto: (photo: Photo, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }) => void;
  onContextMenu: (e: React.MouseEvent, photo: Photo) => void;
}

const FilmstripThumbCell = memo(({ index, style, data }: ListChildComponentProps<FilmstripCellData>) => {
  const { photos, selectedPhotoId, selectedPhotoIds, onSelectPhoto, onContextMenu } = data;
  const photo = photos[index];
  if (!photo) return null;

  return (
    <div style={{ ...style, padding: "10px 5px", boxSizing: "border-box" }}>
      <PhotoThumbnail
        photo={photo}
        isSelected={selectedPhotoIds.has(photo.id)}
        isActive={selectedPhotoId === photo.id}
        onSelect={onSelectPhoto}
        onContextMenu={onContextMenu}
        className="filmstrip-thumb"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}, areEqual);

export const FilmstripView = memo(function FilmstripView({
  photos,
  selectedPhoto,
  selectedPhotoIds,
  largeImageUrl,
  onSelectPhoto,
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
  onClose,
  onOpenInfo,
  scrollRef,
  isMobile = false,
  width,
}: FilmstripViewProps) {
  const api = useApi();
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<FixedSizeList>(null);
  const bottomBarContainerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const { contextMenu, handleContextMenu, closeContextMenu } = usePhotoContextMenu();

  useEffect(() => {
    const el = bottomBarContainerRef.current;
    if (!el) return;

    if (el.clientWidth > 0) {
      setMeasuredWidth(el.clientWidth);
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setMeasuredWidth(entry.contentRect.width);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveBarWidth = Math.max(width || measuredWidth || 800, 100);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && selectedPhoto?.mime_type.startsWith("video/")) {
        e.preventDefault();
        if (videoRef.current) {
          if (videoRef.current.paused) {
            videoRef.current.play();
          } else {
            videoRef.current.pause();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPhoto]);

  const photoIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < photos.length; i++) {
      map.set(photos[i].id, i);
    }
    return map;
  }, [photos]);

  useEffect(() => {
    if (selectedPhoto && listRef.current && effectiveBarWidth > 0) {
      const index = photoIndexMap.get(selectedPhoto.id) ?? -1;
      if (index !== -1) {
        listRef.current.scrollToItem(index, "center");
      }
    }
  }, [selectedPhoto, photoIndexMap, effectiveBarWidth]);

  const selectedPhotoIdsRef = useRef(selectedPhotoIds);
  selectedPhotoIdsRef.current = selectedPhotoIds;

  const onSelectPhotoRef = useRef(onSelectPhoto);
  onSelectPhotoRef.current = onSelectPhoto;

  const onContextMenu = useCallback((e: React.MouseEvent, photo: Photo) => {
    handleContextMenu(e, photo, onSelectPhotoRef.current, selectedPhotoIdsRef.current.has(photo.id));
  }, [handleContextMenu]);

  const itemData = useMemo<FilmstripCellData>(() => ({
    photos,
    selectedPhotoId: selectedPhoto?.id,
    selectedPhotoIds,
    onSelectPhoto,
    onContextMenu,
  }), [photos, selectedPhoto?.id, selectedPhotoIds, onSelectPhoto, onContextMenu]);

  if (photos.length === 0) {
    return (
      <div className="filmstrip-container">
        <div className="filmstrip-large-view">
          <div className="empty-state">
            <p>No photos in this folder.</p>
            <button onClick={onClose}>Back to Grid</button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedPhoto) return null;

  const isVideo = selectedPhoto.mime_type.startsWith("video/");
  const isMarkdown = selectedPhoto.mime_type === "text/markdown" || selectedPhoto.path.toLowerCase().endsWith(".md") || selectedPhoto.path.toLowerCase().endsWith(".markdown");

  return (
    <div className="filmstrip-container">
      <div className="filmstrip-large-view">
        <div className="filmstrip-controls">
          {isMobile && (
            <button className="control-btn info-btn" onClick={onOpenInfo} title="Info">
              <Info size={24} />
            </button>
          )}
          <button className="control-btn close-btn" onClick={onClose} title="Close">
            <X size={24} />
          </button>
        </div>
        <div 
          className="large-image-wrapper" 
          onContextMenu={(e) => onContextMenu(e, selectedPhoto)}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', height: '100%', width: '100%' }}
        >
          {isMarkdown ? (
            <div style={{ width: '100%', height: '100%', overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
              <MarkdownReader photo={selectedPhoto} variant="lightbox" />
            </div>
          ) : isVideo ? (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', maxHeight: '100%', maxWidth: '100%' }}>
              <video
                ref={videoRef}
                key={selectedPhoto.id}
                src={api.getAssetUrl(selectedPhoto.path)}
                poster={largeImageUrl || undefined}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                controls
              />
              {!isPlaying && (
                <div className="video-overlay" style={{ pointerEvents: 'none' }}>
                  <PlayCircle size={64} color="white" fill="rgba(0,0,0,0.5)" />
                </div>
              )}
            </div>
          ) : largeImageUrl ? (
            <PhotoPreview 
              key={selectedPhoto.id}
              photo={selectedPhoto} 
              isThumbnail={false} 
              src={largeImageUrl}
              className="large-photo"
            />
          ) : (
            <div className="large-view-placeholder-container">
              <PhotoPreview 
                key={selectedPhoto.id}
                photo={selectedPhoto} 
                isThumbnail={false} 
                src={api.getAssetUrl(selectedPhoto.thumb_path || selectedPhoto.path, true)}
                className="large-photo placeholder-preview"
              />
              <div className="large-view-loading-overlay">
                <Loader2 className="spinner" size={36} />
              </div>
            </div>
          )}
        </div>
      </div>
      {!isMobile && (
        <div className="filmstrip-bottom-bar" ref={bottomBarContainerRef}>
          <FixedSizeList
            ref={listRef}
            outerRef={scrollRef}
            height={120}
            width={effectiveBarWidth}
            itemCount={photos.length}
            itemSize={110}
            layout="horizontal"
            itemData={itemData}
            itemKey={(index, data) => data.photos[index]?.id || index}
          >
            {FilmstripThumbCell}
          </FixedSizeList>
        </div>
      )}

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
});
