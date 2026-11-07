import React, { useState, useCallback } from "react";
import { Cloud, RefreshCw, Trash2, CheckCircle2, AlertCircle, Image, FileText, Square, CheckSquare, Info } from "lucide-react";
import { ApiService } from "../../services/api";
import { ICloudDiffResult, ICloudPhoto } from "../../types";
import "./ICloudSyncView.css";

interface ICloudSyncViewProps {
  api: ApiService;
}

export const ICloudSyncView: React.FC<ICloudSyncViewProps> = ({ api }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ICloudDiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"rejected" | "orphaned" | "keep">("rejected");

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedIds(new Set());
    setProcessedCount(null);

    try {
      const diffResult = await api.diffICloudPhotos();
      setResult(diffResult);
      // Auto-select all rejected and orphaned photos by default
      const autoSelected = new Set<string>();
      diffResult.matched_rejected.forEach(p => autoSelected.add(p.id));
      diffResult.orphaned.forEach(p => autoSelected.add(p.id));
      setSelectedIds(autoSelected);
    } catch (err: any) {
      console.error("iCloud Scan failed:", err);
      setError(err?.toString() || "Failed to scan iCloud library.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!result) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      const currentList = activeTab === "rejected" 
        ? result.matched_rejected 
        : activeTab === "orphaned" 
        ? result.orphaned 
        : result.matched_keep;
      
      currentList.forEach(p => next.add(p.id));
      return next;
    });
  }, [result, activeTab]);

  const handleSelectNone = useCallback(() => {
    if (!result) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      const currentList = activeTab === "rejected" 
        ? result.matched_rejected 
        : activeTab === "orphaned" 
        ? result.orphaned 
        : result.matched_keep;

      currentList.forEach(p => next.delete(p.id));
      return next;
    });
  }, [result, activeTab]);

  const handleAddToAlbum = useCallback(async () => {
    const idsToProcess = Array.from(selectedIds);
    if (idsToProcess.length === 0) return;

    setProcessing(true);
    setError(null);

    try {
      const added = await api.addPhotosToICloudAlbum(idsToProcess);
      setProcessedCount(added);
    } catch (err: any) {
      console.error("Failed to add photos to iCloud album:", err);
      setError(err?.toString() || "Failed to add photos to 'DamRight Rejected' album.");
    } finally {
      setProcessing(false);
    }
  }, [api, selectedIds]);

  const formatSize = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return "Unknown size";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "Unknown Date";
    try {
      const date = new Date(dateStr);
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  // Determine current list to display
  const getCurrentList = (): ICloudPhoto[] => {
    if (!result) return [];
    if (activeTab === "rejected") return result.matched_rejected;
    if (activeTab === "orphaned") return result.orphaned;
    return result.matched_keep;
  };

  const currentList = getCurrentList();

  return (
    <div className="icloud-sync-view">
      <div className="icloud-header">
        <div className="title-section">
          <Cloud className="cloud-icon" size={32} />
          <h1>iCloud Photo Library Sync</h1>
        </div>
        <p className="description">
          Find photos in your iCloud library that have been marked as rejected or deleted from DamRight, and selectively remove them from iCloud.
        </p>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {processedCount !== null && (
        <div className="success-card">
          <div className="success-header">
            <CheckCircle2 className="success-icon" size={24} />
            <h2>Added to 'DamRight Rejected' Album</h2>
          </div>
          <p className="success-summary">
            Successfully added <strong>{processedCount}</strong> photos to the <strong>"DamRight Rejected"</strong> album in your macOS Photos app.
          </p>
          <div className="instructions-box">
            <h3><Info size={16} /> What to do next:</h3>
            <ol>
              <li>Open the native <strong>Photos</strong> app on your Mac.</li>
              <li>Locate the album named <strong>"DamRight Rejected"</strong> in the sidebar.</li>
              <li>Click inside the album, press <strong>Command + A</strong> to select all photos.</li>
              <li>Press <strong>Command + Delete</strong> (or right-click and choose <strong>"Delete X Photos"</strong>).</li>
              <li>Confirm the deletion. This moves them to the <strong>"Recently Deleted"</strong> section, which automatically removes them from iCloud and your iPhone!</li>
            </ol>
            <p className="instruction-note">
              <em>Note: Do not just press Delete (which only removes them from the album). Pressing Command+Delete removes them from your entire library.</em>
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => setProcessedCount(null)}>
            Dismiss
          </button>
        </div>
      )}

      {!result && !loading && processedCount === null && (
        <div className="scan-placeholder">
          <div className="placeholder-content">
            <Cloud className="animated-cloud" size={64} />
            <h2>Library Out of Sync?</h2>
            <p>
              Compare your macOS Photos app (which syncs to iCloud) with the local DamRight database to identify files you can safely delete.
            </p>
            <button className="btn btn-primary btn-large" onClick={handleScan}>
              <RefreshCw size={18} />
              Scan iCloud Photos
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <h2>Comparing Libraries...</h2>
          <p>Querying the macOS Photos app and matching files against your DamRight database. This might take a few seconds.</p>
        </div>
      )}

      {result && !loading && (
        <div className="scan-results">
          <div className="stats-row">
            <div className="stat-card stat-keep" onClick={() => setActiveTab("keep")}>
              <h3>Matched (Keep)</h3>
              <div className="stat-value">{result.matched_keep.length}</div>
              <p>Photos matching active files in DamRight.</p>
            </div>
            <div className="stat-card stat-rejected" onClick={() => setActiveTab("rejected")}>
              <h3>Matched (Rejected)</h3>
              <div className="stat-value">{result.matched_rejected.length}</div>
              <p>Photos matching rejected files in DamRight.</p>
            </div>
            <div className="stat-card stat-orphaned" onClick={() => setActiveTab("orphaned")}>
              <h3>Orphaned (Not in DamRight)</h3>
              <div className="stat-value">{result.orphaned.length}</div>
              <p>Photos not found in DamRight library.</p>
            </div>
          </div>

          <div className="actions-bar">
            <div className="tab-buttons">
              <button 
                className={`tab-link ${activeTab === "rejected" ? "active" : ""}`}
                onClick={() => setActiveTab("rejected")}
              >
                Rejected Matches ({result.matched_rejected.length})
              </button>
              <button 
                className={`tab-link ${activeTab === "orphaned" ? "active" : ""}`}
                onClick={() => setActiveTab("orphaned")}
              >
                Orphaned Photos ({result.orphaned.length})
              </button>
              <button 
                className={`tab-link ${activeTab === "keep" ? "active" : ""}`}
                onClick={() => setActiveTab("keep")}
              >
                Kept Matches ({result.matched_keep.length})
              </button>
            </div>

            <div className="action-buttons">
              {activeTab !== "keep" && currentList.length > 0 && (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={handleSelectAll}>
                    Select All
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleSelectNone}>
                    Select None
                  </button>
                  <button 
                    className="btn btn-danger btn-sm" 
                    onClick={handleAddToAlbum}
                    disabled={selectedIds.size === 0 || processing}
                  >
                    <Trash2 size={16} />
                    {processing ? "Processing..." : `Send Selected (${selectedIds.size}) to Rejected Album`}
                  </button>
                </>
              )}
              <button className="btn btn-secondary btn-sm" onClick={handleScan}>
                <RefreshCw size={14} />
                Rescan
              </button>
            </div>
          </div>

          <div className="list-container">
            {currentList.length === 0 ? (
              <div className="empty-list">
                <FileText size={48} />
                <h3>No Photos Found</h3>
                <p>No photos fit this category in the iCloud library.</p>
              </div>
            ) : (
              <table className="photos-table">
                <thead>
                  <tr>
                    {activeTab !== "keep" && <th style={{ width: "40px" }}></th>}
                    <th>Filename</th>
                    <th>Capture Date</th>
                    <th>Size</th>
                    <th>Dimensions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentList.map((photo) => {
                    const isSelected = selectedIds.has(photo.id);
                    return (
                      <tr 
                        key={photo.id} 
                        className={isSelected ? "selected-row" : ""}
                        onClick={() => activeTab !== "keep" && handleToggleSelect(photo.id)}
                      >
                        {activeTab !== "keep" && (
                          <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                            <button 
                              className="checkbox-btn"
                              onClick={() => handleToggleSelect(photo.id)}
                            >
                              {isSelected ? (
                                <CheckSquare className="checkbox-icon checked" size={18} />
                              ) : (
                                <Square className="checkbox-icon" size={18} />
                              )}
                            </button>
                          </td>
                        )}
                        <td className="filename-cell">
                          {photo.local_path ? (
                            <img 
                              src={api.getAssetUrl(photo.local_path, true)} 
                              alt={photo.filename} 
                              className="photo-preview" 
                            />
                          ) : (
                            <Image size={16} className="file-icon" />
                          )}
                          <span>{photo.filename}</span>
                        </td>
                        <td>{formatDate(photo.date)}</td>
                        <td>{formatSize(photo.size)}</td>
                        <td>{photo.width && photo.height ? `${photo.width} × ${photo.height}` : "Unknown"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
