import React, { useState } from "react";
import "./ExportModal.css";
import { Folder, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

export interface ExportConfig {
  photo_ids: string[];
  destination_dir: string;
  format_mode: "original" | "jpeg";
  jpeg_quality?: number;
  max_dimension?: number;
  preserve_folder_structure: boolean;
  include_xmp: boolean;
}

interface ExportModalProps {
  selectedCount: number;
  selectedIds: string[];
  onClose: () => void;
  onExport: (config: ExportConfig) => Promise<void>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  selectedCount,
  selectedIds,
  onClose,
  onExport,
}) => {
  const [destinationDir, setDestinationDir] = useState<string>(() => {
    return localStorage.getItem("lastExportDestination") || "";
  });
  const [formatMode, setFormatMode] = useState<"original" | "jpeg">("jpeg");
  const [jpegQuality, setJpegQuality] = useState<number>(85);
  const [enableResize, setEnableResize] = useState<boolean>(false);
  const [maxDimension, setMaxDimension] = useState<number>(2048);
  const [preserveStructure, setPreserveStructure] = useState<boolean>(false);
  const [includeXmp, setIncludeXmp] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        setDestinationDir(selected);
        localStorage.setItem("lastExportDestination", selected);
      }
    } catch (err) {
      console.error("Failed to select destination folder:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationDir.trim() || selectedIds.length === 0) return;

    setIsSubmitting(true);
    try {
      await onExport({
        photo_ids: selectedIds,
        destination_dir: destinationDir.trim(),
        format_mode: formatMode,
        jpeg_quality: formatMode === "jpeg" ? jpegQuality : undefined,
        max_dimension: formatMode === "jpeg" && enableResize ? maxDimension : undefined,
        preserve_folder_structure: preserveStructure,
        include_xmp: formatMode === "original" ? includeXmp : false,
      });
      onClose();
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="export-modal-overlay" onClick={onClose} data-testid="export-modal">
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-header">
          <h3>Export {selectedCount} {selectedCount === 1 ? "Photo" : "Photos"}</h3>
          <button className="export-modal-close-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Destination Folder */}
          <div className="export-modal-section">
            <label className="section-title">Export Destination</label>
            <div className="export-folder-picker">
              <input
                type="text"
                className="export-folder-input"
                value={destinationDir}
                onChange={(e) => setDestinationDir(e.target.value)}
                placeholder="Select output folder..."
                required
              />
              <button
                type="button"
                className="export-folder-browse-btn"
                onClick={handleBrowse}
              >
                <Folder size={16} /> Browse...
              </button>
            </div>
          </div>

          {/* Format Selection */}
          <div className="export-modal-section">
            <label className="section-title">Format & Quality</label>
            <div className="export-radio-group">
              <label
                className={`export-radio-option ${formatMode === "jpeg" ? "selected" : ""}`}
                onClick={() => setFormatMode("jpeg")}
              >
                <input
                  type="radio"
                  name="format"
                  value="jpeg"
                  checked={formatMode === "jpeg"}
                  onChange={() => setFormatMode("jpeg")}
                />
                <div className="export-radio-details">
                  <span className="export-radio-label">JPEG (Re-encode processed image)</span>
                  <span className="export-radio-desc">Applies orientation, exposure, and crop adjustments</span>
                </div>
              </label>

              {formatMode === "jpeg" && (
                <div className="export-sub-options">
                  <div className="export-slider-row">
                    <label>JPEG Quality:</label>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={jpegQuality}
                      onChange={(e) => setJpegQuality(Number(e.target.value))}
                    />
                    <span className="export-slider-value">{jpegQuality}%</span>
                  </div>

                  <label className="export-checkbox-row">
                    <input
                      type="checkbox"
                      checked={enableResize}
                      onChange={(e) => setEnableResize(e.target.checked)}
                    />
                    <span>Resize to max dimension:</span>
                    {enableResize && (
                      <input
                        type="number"
                        className="export-dimension-input"
                        value={maxDimension}
                        onChange={(e) => setMaxDimension(Number(e.target.value))}
                        min={100}
                        max={10000}
                      />
                    )}
                    {enableResize && <span>px</span>}
                  </label>
                </div>
              )}

              <label
                className={`export-radio-option ${formatMode === "original" ? "selected" : ""}`}
                onClick={() => setFormatMode("original")}
              >
                <input
                  type="radio"
                  name="format"
                  value="original"
                  checked={formatMode === "original"}
                  onChange={() => setFormatMode("original")}
                />
                <div className="export-radio-details">
                  <span className="export-radio-label">Original Files (Straight Copy)</span>
                  <span className="export-radio-desc">Copies original source media files without modifications</span>
                </div>
              </label>

              {formatMode === "original" && (
                <div className="export-sub-options">
                  <label className="export-checkbox-row">
                    <input
                      type="checkbox"
                      checked={includeXmp}
                      onChange={(e) => setIncludeXmp(e.target.checked)}
                    />
                    <span>Include XMP sidecar files if present</span>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Folder Structure Options */}
          <div className="export-modal-section">
            <label className="section-title">Folder Structure</label>
            <div className="export-radio-group">
              <label
                className={`export-radio-option ${!preserveStructure ? "selected" : ""}`}
                onClick={() => setPreserveStructure(false)}
              >
                <input
                  type="radio"
                  name="structure"
                  checked={!preserveStructure}
                  onChange={() => setPreserveStructure(false)}
                />
                <div className="export-radio-details">
                  <span className="export-radio-label">Flat Folder</span>
                  <span className="export-radio-desc">Save all exported files directly in the destination folder</span>
                </div>
              </label>

              <label
                className={`export-radio-option ${preserveStructure ? "selected" : ""}`}
                onClick={() => setPreserveStructure(true)}
              >
                <input
                  type="radio"
                  name="structure"
                  checked={preserveStructure}
                  onChange={() => setPreserveStructure(true)}
                />
                <div className="export-radio-details">
                  <span className="export-radio-label">Preserve Source Folder Hierarchy</span>
                  <span className="export-radio-desc">Recreate relative subdirectories under the destination folder</span>
                </div>
              </label>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="export-modal-actions">
            <button
              type="button"
              className="export-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="export-submit-btn"
              disabled={isSubmitting || !destinationDir.trim()}
            >
              {isSubmitting ? "Exporting..." : `Export ${selectedCount} ${selectedCount === 1 ? "Photo" : "Photos"}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
