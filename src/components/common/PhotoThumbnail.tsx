import { Star, PlayCircle, Bookmark, FileText } from "lucide-react";
import "./PhotoThumbnail.css";
import { Photo } from "../../types";
import { PhotoPreview } from "./PhotoPreview";
import { memo } from "react";

interface PhotoThumbnailProps {
  photo: Photo;
  isSelected?: boolean;
  isActive?: boolean;
  onSelect?: (photo: Photo, modifiers: { shift?: boolean, ctrl?: boolean, meta?: boolean }) => void;
  onDoubleClick?: (photo: Photo) => void;
  onContextMenu?: (e: React.MouseEvent, photo: Photo) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const PhotoThumbnail = memo(({ 
  photo, 
  isSelected, 
  isActive, 
  onSelect, 
  onDoubleClick, 
  onContextMenu,
  className = "photo-cell",
  style
}: PhotoThumbnailProps) => {
  const isVideo = photo.mime_type.startsWith("video/");
  const isMarkdown = photo.mime_type === "text/markdown" || photo.path.toLowerCase().endsWith(".md") || photo.path.toLowerCase().endsWith(".markdown");
  const displayTitle = photo.title || photo.path.split(/[/\\]/).pop()?.replace(/\.(md|markdown)$/i, "").replace(/[-_]/g, " ") || "Story Post";

  return (
    <div
      className={`photo-thumbnail ${className} ${isSelected ? "selected" : ""} ${isActive ? "active" : ""} ${photo.rejected ? "rejected" : ""}`}
      onClick={(e) => onSelect?.(photo, { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey })}
      onDoubleClick={() => onDoubleClick?.(photo)}
      onContextMenu={(e) => onContextMenu?.(e, photo)}
      style={style}
    >
      <div className="thumb-wrapper">
        {isMarkdown ? (
          <div className="markdown-thumb-card" data-testid="markdown-thumbnail">
            <div className="markdown-thumb-header">
              <span className="markdown-thumb-badge">
                <FileText size={11} />
                <span>Post</span>
              </span>
            </div>
            <div className="markdown-thumb-title">{displayTitle}</div>
            {photo.description && (
              <div className="markdown-thumb-desc">{photo.description}</div>
            )}
          </div>
        ) : (
          <PhotoPreview photo={photo} />
        )}
        {isVideo && (
          <div className="video-overlay">
            <PlayCircle size={className.includes("filmstrip") ? 24 : 40} color="white" fill="rgba(0,0,0,0.5)" />
          </div>
        )}
        {photo.rejected && (
          <div className="rejected-overlay">REJECTED</div>
        )}
        {photo.in_quick_collection && (
          <div className="quick-collection-overlay" title="In Quick Collection" data-testid="quick-collection-badge">
            <Bookmark size={className.includes("filmstrip") ? 10 : 14} fill="#3b82f6" color="#3b82f6" />
          </div>
        )}
        {photo.rating > 0 && !photo.rejected && (
          <div className="rating-overlay">
            {Array.from({ length: photo.rating }).map((_, i) => (
              <Star key={i} size={className.includes("filmstrip") ? 8 : 12} className="star-icon" data-testid="star-filled" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
