import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Check, Crop as CropIcon, Loader2 } from "lucide-react";
import { Photo } from "../../types";
import "./CropView.css";

interface CropViewProps {
  photo: Photo;
  onApply: (crop: { top: number; left: number; bottom: number; right: number }) => void;
  onCancel: () => void;
  imageUrl: string;
}

type AspectRatio = "free" | "original" | "1:1" | "16:9" | "4:3" | "3:2" | "2:3" | "3:4";

type DragType = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export function CropView({ photo, onApply, onCancel, imageUrl }: CropViewProps) {
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("free");
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Normalized coordinates (0-1)
  const [crop, setCrop] = useState({
    left: photo.crop_left ?? 0,
    top: photo.crop_top ?? 0,
    right: photo.crop_right ?? 1,
    bottom: photo.crop_bottom ?? 1,
  });

  const [dragging, setDragging] = useState<{
    type: DragType;
    startX: number;
    startY: number;
    initialCrop: typeof crop;
  } | null>(null);

  const photoAspectRatio = useMemo(() => {
    if (photo.width && photo.height) {
      const isRotated = photo.orientation >= 5 && photo.orientation <= 8;
      return isRotated ? photo.height / photo.width : photo.width / photo.height;
    }
    return 1;
  }, [photo]);

  const targetAspectRatio = useMemo(() => {
    switch (aspectRatio) {
      case "original": return photoAspectRatio;
      case "1:1": return 1;
      case "16:9": return 16 / 9;
      case "4:3": return 4 / 3;
      case "3:2": return 3 / 2;
      case "2:3": return 2 / 3;
      case "3:4": return 3 / 4;
      default: return null;
    }
  }, [aspectRatio, photoAspectRatio]);

  const handleImageLoad = () => {
    if (imgRef.current) {
      setImgSize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
      });
      setLoaded(true);
      setError(null);
    }
  };

  const handleImageError = () => {
    setError("Failed to load image for cropping");
  };

  useEffect(() => {
    // Reset loaded state when imageUrl changes
    setLoaded(false);
    setError(null);

    // If image has already loaded (e.g. from cache), trigger handleImageLoad immediately
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      handleImageLoad();
    }
  }, [imageUrl]);

  useEffect(() => {
    // Re-measure when loaded changes to true, as layout might have shifted
    if (loaded && imgRef.current) {
      setImgSize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
      });
    }
  }, [loaded]);

  useEffect(() => {
    window.addEventListener("resize", handleImageLoad);
    return () => window.removeEventListener("resize", handleImageLoad);
  }, []);

  const constrainCrop = useCallback((newCrop: typeof crop, targetAR: number | null) => {
    let { left, top, right, bottom } = newCrop;

    // Keep within bounds
    left = Math.max(0, Math.min(left, right - 0.05));
    right = Math.min(1, Math.max(right, left + 0.05));
    top = Math.max(0, Math.min(top, bottom - 0.05));
    bottom = Math.min(1, Math.max(bottom, top + 0.05));

    if (targetAR) {
      // Adjust right/bottom to match aspect ratio based on width
      // currentAR = (w * photoAR) / h
      // we want (w * photoAR) / h = targetAR
      // h = (w * photoAR) / targetAR
      const w = right - left;
      const h = bottom - top;
      const currentAR = (w * photoAspectRatio) / h;

      if (currentAR > targetAR) {
        // Too wide, shrink width
        const newW = (h * targetAR) / photoAspectRatio;
        // Keep it centered or adjust based on which side was dragged?
        // For now, let's just adjust the right side
        if (right === 1 && left > 0) {
           left = right - newW;
        } else {
           right = left + newW;
        }
      } else {
        // Too tall, shrink height
        const newH = (w * photoAspectRatio) / targetAR;
        if (bottom === 1 && top > 0) {
          top = bottom - newH;
        } else {
          bottom = top + newH;
        }
      }
    }

    return { left, top, right, bottom };
  }, [photoAspectRatio]);

  // Handle dragging
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragging.startX) / imgSize.width;
      const dy = (e.clientY - dragging.startY) / imgSize.height;

      let newCrop = { ...dragging.initialCrop };

      switch (dragging.type) {
        case "move":
          const w = newCrop.right - newCrop.left;
          const h = newCrop.bottom - newCrop.top;
          newCrop.left = Math.max(0, Math.min(1 - w, dragging.initialCrop.left + dx));
          newCrop.top = Math.max(0, Math.min(1 - h, dragging.initialCrop.top + dy));
          newCrop.right = newCrop.left + w;
          newCrop.bottom = newCrop.top + h;
          break;
        case "nw":
          newCrop.left = dragging.initialCrop.left + dx;
          newCrop.top = dragging.initialCrop.top + dy;
          break;
        case "ne":
          newCrop.right = dragging.initialCrop.right + dx;
          newCrop.top = dragging.initialCrop.top + dy;
          break;
        case "sw":
          newCrop.left = dragging.initialCrop.left + dx;
          newCrop.bottom = dragging.initialCrop.bottom + dy;
          break;
        case "se":
          newCrop.right = dragging.initialCrop.right + dx;
          newCrop.bottom = dragging.initialCrop.bottom + dy;
          break;
        case "n":
          newCrop.top = dragging.initialCrop.top + dy;
          break;
        case "s":
          newCrop.bottom = dragging.initialCrop.bottom + dy;
          break;
        case "e":
          newCrop.right = dragging.initialCrop.right + dx;
          break;
        case "w":
          newCrop.left = dragging.initialCrop.left + dx;
          break;
      }

      setCrop(constrainCrop(newCrop, targetAspectRatio));
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, imgSize, constrainCrop, targetAspectRatio]);

  const startDragging = (type: DragType, e: React.MouseEvent) => {
    e.stopPropagation();
    setDragging({
      type,
      startX: e.clientX,
      startY: e.clientY,
      initialCrop: { ...crop },
    });
  };

  const handleApply = () => {
    onApply(crop);
  };

  const handleAspectRatioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newAR = e.target.value as AspectRatio;
    setAspectRatio(newAR);
    
    // Immediately apply constraint
    let targetARValue = null;
    switch (newAR) {
      case "original": targetARValue = photoAspectRatio; break;
      case "1:1": targetARValue = 1; break;
      case "16:9": targetARValue = 16 / 9; break;
      case "4:3": targetARValue = 4 / 3; break;
      case "3:2": targetARValue = 3 / 2; break;
      case "2:3": targetARValue = 2 / 3; break;
      case "3:4": targetARValue = 3 / 4; break;
    }
    
    if (targetARValue) {
      setCrop(prev => constrainCrop(prev, targetARValue));
    }
  };

  const cropStyle: React.CSSProperties = {
    left: `${crop.left * 100}%`,
    top: `${crop.top * 100}%`,
    width: `${(crop.right - crop.left) * 100}%`,
    height: `${(crop.bottom - crop.top) * 100}%`,
  };

  return (
    <div className="crop-view-container">
      <div className="crop-toolbar">
        <div className="crop-toolbar-group">
          <CropIcon size={18} />
          <span>Aspect Ratio:</span>
          <select value={aspectRatio} onChange={handleAspectRatioChange}>
            <option value="free">Freeform</option>
            <option value="original">Original</option>
            <option value="1:1">Square (1:1)</option>
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="3:2">3:2</option>
            <option value="2:3">2:3 (Portrait)</option>
            <option value="3:4">3:4 (Portrait)</option>
          </select>
        </div>
      </div>

      <div className="crop-main">
        {error ? (
          <div className="crop-error">
            <p>{error}</p>
          </div>
        ) : !loaded && (
          <div className="crop-loading">
            <Loader2 className="spinner" size={48} />
            <p>Loading image...</p>
          </div>
        )}
        {!error && (
          <div 
            className="crop-image-container" 
            style={{ 
              opacity: loaded ? 1 : 0,
              position: loaded ? 'relative' : 'absolute',
              pointerEvents: loaded ? 'all' : 'none',
              aspectRatio: photoAspectRatio,
            }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              className="crop-image"
              alt="To crop"
              onLoad={handleImageLoad}
              onError={handleImageError}
              draggable={false}
            />
            {imgSize.width > 0 && (
              <div className="crop-box" style={cropStyle} onMouseDown={(e) => startDragging("move", e)}>
                <div className="crop-grid">
                  <div className="crop-grid-cell" /><div className="crop-grid-cell" /><div className="crop-grid-cell" />
                  <div className="crop-grid-cell" /><div className="crop-grid-cell" /><div className="crop-grid-cell" />
                  <div className="crop-grid-cell" /><div className="crop-grid-cell" /><div className="crop-grid-cell" />
                </div>
                
                <div className="crop-handle handle-nw" onMouseDown={(e) => startDragging("nw", e)} />
                <div className="crop-handle handle-ne" onMouseDown={(e) => startDragging("ne", e)} />
                <div className="crop-handle handle-sw" onMouseDown={(e) => startDragging("sw", e)} />
                <div className="crop-handle handle-se" onMouseDown={(e) => startDragging("se", e)} />
                
                {aspectRatio === "free" && (
                  <>
                    <div className="crop-handle handle-n" onMouseDown={(e) => startDragging("n", e)} />
                    <div className="crop-handle handle-s" onMouseDown={(e) => startDragging("s", e)} />
                    <div className="crop-handle handle-e" onMouseDown={(e) => startDragging("e", e)} />
                    <div className="crop-handle handle-w" onMouseDown={(e) => startDragging("w", e)} />
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="crop-footer">
        <button className="secondary-button" onClick={onCancel}>
          <X size={16} /> Cancel
        </button>
        <button className="primary-button" onClick={handleApply} disabled={!loaded || !!error}>
          <Check size={16} /> Apply Crop
        </button>
      </div>
    </div>
  );
}
