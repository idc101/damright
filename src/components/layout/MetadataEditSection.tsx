import { Sliders, Crop, RotateCcw, RotateCw, RefreshCcw } from "lucide-react";
import { Photo } from "../../types";

interface MetadataEditSectionProps {
  photo: Photo;
  updateExposure: (id: string, val: number) => void;
  updatePortraitBlur?: (id: string, val: number) => void;
  updateCrop: (id: string, top: number | null, left: number | null, bottom: number | null, right: number | null, angle: number | null) => void;
  onEnterCropMode?: () => void;
}

export function MetadataEditSection({
  photo,
  updateExposure,
  updatePortraitBlur,
  updateCrop,
  onEnterCropMode,
}: MetadataEditSectionProps) {
  const handleRotate = (delta: number) => {
    const currentAngle = photo.crop_angle || 0;
    const newAngle = (currentAngle + delta) % 360;
    updateCrop(
      photo.id,
      photo.crop_top ?? null,
      photo.crop_left ?? null,
      photo.crop_bottom ?? null,
      photo.crop_right ?? null,
      newAngle
    );
  };

  const handleResetCrop = () => {
    updateCrop(photo.id, null, null, null, null, null);
  };

  return (
    <>
      <div className="panel-section">
        <h3>
          <Sliders size={18} /> Adjustments
        </h3>
        <div className="control-group">
          <label>Exposure ({(photo.exposure || 0).toFixed(2)})</label>
          <input
            type="range"
            min="-2"
            max="2"
            step="0.1"
            value={photo.exposure || 0}
            onChange={(e) => updateExposure(photo.id, parseFloat(e.target.value))}
          />
        </div>
        {updatePortraitBlur && (
          <div className="control-group" style={{ marginTop: '12px' }}>
            <label>Portrait Depth Blur ({(photo.portrait_blur || 0).toFixed(2)})</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={photo.portrait_blur || 0}
              onChange={(e) => updatePortraitBlur(photo.id, parseFloat(e.target.value))}
            />
          </div>
        )}
      </div>

      <div className="panel-section">
        <h3>
          <Crop size={18} /> Crop & Rotation
        </h3>
        <div className="control-group">
          <label>Rotation ({photo.crop_angle || 0}°)</label>
          <div className="button-group" style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button className="small-button" onClick={() => handleRotate(-90)} title="Rotate Counter-Clockwise">
              <RotateCcw size={14} /> -90°
            </button>
            <button className="small-button" onClick={() => handleRotate(90)} title="Rotate Clockwise">
              <RotateCw size={14} /> +90°
            </button>
            {(photo.crop_top != null || photo.crop_angle != null) && (
              <button className="small-button" onClick={handleResetCrop} title="Reset All">
                <RefreshCcw size={14} /> Reset
              </button>
            )}
          </div>
          <button className="primary-button" style={{ width: '100%', marginTop: '4px' }} onClick={onEnterCropMode}>
            <Crop size={16} /> Enter Crop Mode
          </button>
        </div>
      </div>
    </>
  );
}
