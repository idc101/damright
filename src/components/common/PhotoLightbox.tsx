import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  Star,
  Calendar,
  Layers,
  Camera,
  MapPin,
  Users
} from "lucide-react";
import { Photo } from "../../types";
import { useApi } from "../../services/ApiProvider";
import {
  getCachedPreviewUrl,
  loadAndCachePreview,
  prefetchAdjacentPreviews
} from "../../utils/previewCache";
import { MarkdownReader } from "./MarkdownReader";
import "./PhotoLightbox.css";

export interface PhotoLightboxProps {
  photo: Photo;
  photos: Photo[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
  showMetadataDrawer?: boolean;
  onTagClick?: (tag: string) => void;
  onPersonClick?: (person: string) => void;
}

export function PhotoLightbox({
  photo,
  photos,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
  showMetadataDrawer,
  onTagClick,
  onPersonClick,
}: PhotoLightboxProps) {
  const api = useApi();
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [largeImageUrl, setLargeImageUrl] = useState<string | null>(null);

  // Sync external showMetadataDrawer if provided
  useEffect(() => {
    if (showMetadataDrawer !== undefined) {
      setIsInfoOpen(showMetadataDrawer);
    }
  }, [showMetadataDrawer]);

  // Reset info drawer state on photo index change
  useEffect(() => {
    if (showMetadataDrawer === undefined) {
      setIsInfoOpen(false);
    }
  }, [currentIndex, showMetadataDrawer]);

  // Load preview URL for current photo and prefetch adjacent previews
  useEffect(() => {
    if (!isOpen || !photo) return;

    let active = true;
    const cached = getCachedPreviewUrl(photo, false);
    if (cached) {
      setLargeImageUrl(cached);
    } else {
      setLargeImageUrl(null);
    }

    loadAndCachePreview(api, photo, false)
      .then((url) => {
        if (active) {
          setLargeImageUrl(url);
        }
      })
      .catch((err) => {
        console.error("Failed to load preview url:", err);
        if (active) {
          setLargeImageUrl(api.getAssetUrl(photo.path));
        }
      });

    prefetchAdjacentPreviews(api, photos, currentIndex, 3);

    return () => {
      active = false;
    };
  }, [isOpen, photo, currentIndex, photos, api]);

  const navigatePrev = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (currentIndex > 0) {
        onNavigate(currentIndex - 1);
      }
    },
    [currentIndex, onNavigate]
  );

  const navigateNext = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (currentIndex < photos.length - 1) {
        onNavigate(currentIndex + 1);
      }
    },
    [currentIndex, photos.length, onNavigate]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") navigatePrev();
      if (e.key === "ArrowRight") navigateNext();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, navigatePrev, navigateNext]);

  // Touch swiping
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    const swipeDistance = touchStartX.current - touchEndX.current;
    const swipeThreshold = 50;
    if (swipeDistance > swipeThreshold) {
      navigateNext();
    } else if (swipeDistance < -swipeThreshold) {
      navigatePrev();
    }
  };

  if (!isOpen || !photo) return null;

  const isVideo = photo.mime_type.startsWith("video/");
  const isMarkdown = photo.mime_type === "text/markdown" || photo.path.toLowerCase().endsWith(".md") || photo.path.toLowerCase().endsWith(".markdown");

  return (
    <div className="web-viewer">
      <div className="web-viewer-header">
        <button
          className="web-viewer-close"
          onClick={onClose}
          title="Back to grid"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          className="web-viewer-info-trigger"
          onClick={() => setIsInfoOpen(!isInfoOpen)}
        >
          <Info size={16} /> {isInfoOpen ? "Hide Info" : "Details"}
        </button>
      </div>

      <div
        className="web-viewer-body"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Touch Tap Targets for Mobile Screen Edges */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "25%",
            zIndex: 2,
          }}
          onClick={navigatePrev}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "25%",
            zIndex: 2,
          }}
          onClick={navigateNext}
        />

        {/* Desktop Nav Chevrons */}
        {currentIndex > 0 && (
          <button
            className="web-viewer-nav web-viewer-nav-left"
            onClick={navigatePrev}
            aria-label="Previous photo"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {isMarkdown ? (
          <div style={{ width: "100%", height: "100%", overflowY: "auto", display: "flex", justifyContent: "center", zIndex: 1 }}>
            <MarkdownReader photo={photo} variant="lightbox" />
          </div>
        ) : isVideo ? (
          <video
            key={photo.id}
            className="web-viewer-media"
            src={api.getAssetUrl(photo.path)}
            poster={largeImageUrl || undefined}
            controls
            autoPlay
            playsInline
          />
        ) : largeImageUrl ? (
          <img
            className="web-viewer-media"
            src={largeImageUrl}
            alt={photo.title || ""}
          />
        ) : (
          <div style={{ color: "var(--text-secondary)" }}>
            Loading Preview...
          </div>
        )}

        {currentIndex < photos.length - 1 && (
          <button
            className="web-viewer-nav web-viewer-nav-right"
            onClick={navigateNext}
            aria-label="Next photo"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {/* Slide-up EXIF and Metadata Drawer */}
      <div className={`web-info-drawer ${isInfoOpen ? "open" : ""}`}>
        <div className="web-info-header">
          <div>
            <h4 className="web-info-title">{photo.title || "Untitled"}</h4>
            <span className="web-info-filename">
              {photo.path.split(/[/\\]/).pop() || photo.path}
            </span>
          </div>
          <button
            className="web-viewer-close"
            onClick={() => setIsInfoOpen(false)}
            aria-label="Close info"
          >
            <X size={16} />
          </button>
        </div>

        {photo.rating > 0 && (
          <div className="web-info-rating">
            {Array.from({ length: photo.rating }).map((_, i) => (
              <Star key={i} size={16} fill="#eab308" stroke="none" />
            ))}
          </div>
        )}

        {photo.description && (
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              Description
            </label>
            <p
              style={{
                margin: "4px 0",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                lineHeight: "1.4",
              }}
            >
              {photo.description}
            </p>
          </div>
        )}

        <div className="web-info-grid">
          {photo.capture_time && (
            <div className="web-info-item">
              <label>
                <Calendar size={12} style={{ marginRight: "4px" }} /> Captured
              </label>
              <span>{new Date(photo.capture_time).toLocaleString()}</span>
            </div>
          )}
          {photo.width && photo.height ? (
            <div className="web-info-item">
              <label>
                <Layers size={12} style={{ marginRight: "4px" }} /> Dimensions
              </label>
              <span>
                {photo.width} × {photo.height}
                {photo.file_size
                  ? ` (${(photo.file_size / (1024 * 1024)).toFixed(1)} MB)`
                  : ""}
              </span>
            </div>
          ) : null}
          {(photo.camera_make || photo.camera_model) && (
            <div className="web-info-item">
              <label>
                <Camera size={12} style={{ marginRight: "4px" }} /> Camera
              </label>
              <span>{`${photo.camera_make || ""} ${photo.camera_model || ""}`}</span>
            </div>
          )}
          {photo.event && (
            <div className="web-info-item">
              <label>
                <MapPin size={12} style={{ marginRight: "4px" }} /> Event
              </label>
              <span>{photo.event}</span>
            </div>
          )}
        </div>

        {photo.tags && (
          <div style={{ marginTop: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Tags
            </label>
            <div className="web-info-tags">
              {photo.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((tag) => (
                  <span
                    key={tag}
                    className={`web-info-tag ${onTagClick ? "clickable" : ""}`}
                    onClick={() => onTagClick?.(tag)}
                  >
                    {tag}
                  </span>
                ))}
            </div>
          </div>
        )}

        {photo.faces && photo.faces.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              <Users size={12} /> People
            </label>
            <div className="web-info-tags">
              {photo.faces
                .filter((f) => f.name)
                .map((face) => (
                  <span
                    key={face.name}
                    className={`web-info-tag ${onPersonClick ? "clickable" : ""}`}
                    onClick={() => onPersonClick?.(face.name)}
                  >
                    {face.name}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
