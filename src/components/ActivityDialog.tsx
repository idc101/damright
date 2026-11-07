import React, { useState } from 'react';
import { RefreshCw, Server, FolderDown, Download, X, Settings, Play, FileText } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Progress, SyncStatus, SyncDiagnosticsData } from '../types';
import './ActivityDialog.css';

export interface ActivityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: SyncStatus | null;
  onSyncNow?: () => Promise<void>;
  onOpenSyncConfig?: () => void;
  importing: boolean;
  importProgress: Progress | null;
  exporting: boolean;
  exportProgress: Progress | null;
  syncingNow?: boolean;
}

export const ActivityDialog: React.FC<ActivityDialogProps> = ({
  isOpen,
  onClose,
  syncStatus,
  onSyncNow,
  onOpenSyncConfig,
  importing,
  importProgress,
  exporting,
  exportProgress,
  syncingNow = false,
}) => {
  const [diagnostics, setDiagnostics] = useState<SyncDiagnosticsData | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleFetchDiagnostics = async () => {
    setLoadingDiagnostics(true);
    setShowDiagnostics(true);
    try {
      const res = await invoke<SyncDiagnosticsData>('get_sync_diagnostics');
      setDiagnostics(res);
    } catch (err) {
      console.error('Failed to fetch sync diagnostics:', err);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  if (!isOpen) return null;

  // Compute status for Server Sync
  let syncActive = false;
  let syncProgressText = '';
  let syncCurrent = 0;
  let syncTotal = 0;
  let syncPillText = 'Idle';
  let syncPillClass = 'idle';

  if (!syncStatus || !syncStatus.enabled) {
    syncPillText = 'Disabled';
    syncPillClass = 'idle';
    syncProgressText = 'Home server sync is not enabled.';
  } else {
    const stage = syncStatus.stage;
    if (typeof stage === 'string') {
      if (stage === 'Idle') {
        syncPillText = 'Synced';
        syncPillClass = 'success';
        syncProgressText = 'Library backup is up to date.';
      } else if (stage === 'Scanning') {
        syncActive = true;
        syncPillText = 'Scanning...';
        syncPillClass = 'active';
        syncProgressText = 'Scanning library for changed files...';
      }
    } else if (typeof stage === 'object') {
      if ('Scanning' in stage) {
        syncActive = true;
        const current_step = stage.Scanning.current_step || '';
        const files_scanned = stage.Scanning.files_scanned || 0;
        const countStr = files_scanned > 0 ? ` (${files_scanned.toLocaleString()} checked)` : '';
        syncPillText = current_step ? `Scanning: ${current_step}${countStr}` : `Scanning...${countStr}`;
        syncPillClass = 'active';
        syncProgressText = `${current_step || 'Scanning library for changed files...'}${countStr}`;
      } else if ('Debouncing' in stage) {
        syncPillText = `Pending (${Math.ceil(stage.Debouncing.remaining_secs / 60)}m)`;
        syncPillClass = 'pending';
        syncProgressText = `Sync scheduled in ${Math.ceil(stage.Debouncing.remaining_secs / 60)} minute(s).`;
      } else if ('Syncing' in stage) {
        syncActive = true;
        const { files_done, total_files, bytes_done, total_bytes, bytes_per_sec, current_file } = stage.Syncing;
        
        let syncPercentage = 0;
        if (total_bytes > 0) {
          syncCurrent = bytes_done;
          syncTotal = total_bytes;
          syncPercentage = Math.min(100, Math.round((bytes_done / total_bytes) * 100));
        } else if (total_files > 0) {
          syncCurrent = files_done;
          syncTotal = total_files;
          syncPercentage = Math.min(100, Math.round((files_done / total_files) * 100));
        }

        const formatSpeed = (bps?: number) => {
          if (!bps || bps <= 0) return '';
          if (bps < 1024) return `${bps} B/s`;
          if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
          return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
        };

        const speedStr = formatSpeed(bytes_per_sec);
        const speedSuffix = speedStr ? ` • ${speedStr}` : '';

        syncPillText = `Syncing (${files_done}/${total_files} files • ${syncPercentage}%${speedSuffix})`;
        syncPillClass = 'active';
        
        syncProgressText = current_file
          ? `${current_file} (${files_done}/${total_files} files${speedSuffix})`
          : `Syncing ${files_done} of ${total_files} files${speedSuffix}...`;
      } else if ('Success' in stage) {
        syncPillText = 'Synced';
        syncPillClass = 'success';
        const timeStr = stage.Success.last_sync_time
          ? new Date(stage.Success.last_sync_time).toLocaleTimeString()
          : '';
        syncProgressText = `Last synced ${timeStr ? `at ${timeStr}` : 'recently'} (${stage.Success.files_synced} files).`;
      } else if ('Error' in stage) {
        syncPillText = 'Error';
        syncPillClass = 'error';
        syncProgressText = `Sync error: ${stage.Error.message}`;
      }
    }
  }

  // Compute status for Import / Refresh
  const importActive = importing || importProgress !== null;
  const importCurrent = importProgress?.current || 0;
  const importTotal = importProgress?.total || 0;
  const importMessage = importProgress?.message || (importing ? 'Processing folder import...' : 'No active import');

  // Compute status for Export
  const exportActive = exporting || exportProgress !== null;
  const exportCurrent = exportProgress?.current || 0;
  const exportTotal = exportProgress?.total || 0;
  const exportMessage = exportProgress?.message || (exporting ? 'Processing photo export...' : 'No active export');

  // Active tasks count and combined calculation
  let activeTaskCount = 0;
  if (syncActive) activeTaskCount++;
  if (importActive) activeTaskCount++;
  if (exportActive) activeTaskCount++;

  let sumCurrent = 0;
  let sumTotal = 0;

  if (syncActive && syncTotal > 0) {
    sumCurrent += syncCurrent;
    sumTotal += syncTotal;
  }
  if (importActive && importTotal > 0) {
    sumCurrent += importCurrent;
    sumTotal += importTotal;
  }
  if (exportActive && exportTotal > 0) {
    sumCurrent += exportCurrent;
    sumTotal += exportTotal;
  }

  const hasDeterminedProgress = sumTotal > 0;
  const overallPercentage = hasDeterminedProgress
    ? Math.min(100, Math.round((sumCurrent / sumTotal) * 100))
    : null;

  return (
    <div className="activity-dialog-overlay" data-testid="activity-dialog-overlay" onClick={onClose}>
      <div className="activity-dialog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="activity-dialog-header">
          <div className="activity-dialog-header-left">
            <h2>
              <RefreshCw size={18} className={activeTaskCount > 0 ? 'activity-spin-icon' : ''} />
              Activity Center
            </h2>
            <span className={`activity-summary-badge ${activeTaskCount > 0 ? 'active' : 'idle'}`}>
              {activeTaskCount > 0
                ? `${activeTaskCount} active task${activeTaskCount > 1 ? 's' : ''}`
                : 'All tasks idle'}
            </span>
          </div>
          <button className="activity-dialog-close" onClick={onClose} title="Close Activity Center">
            <X size={18} />
          </button>
        </div>

        <div className="activity-dialog-body">
          {/* Combined Progress Card when active */}
          {activeTaskCount > 0 && (
            <div className="overall-progress-card">
              <div className="overall-progress-header">
                <span>Combined Progress</span>
                <span>
                  {overallPercentage !== null ? `${overallPercentage}%` : 'In Progress...'}
                </span>
              </div>
              <div className="overall-progress-bar-container">
                <div
                  className={`overall-progress-bar ${overallPercentage === null ? 'indeterminate' : ''}`}
                  style={{ width: overallPercentage !== null ? `${overallPercentage}%` : '100%' }}
                />
              </div>
            </div>
          )}

          <div className="activity-tasks-list">
            {/* Server Sync Task */}
            <div className={`activity-task-card ${syncActive ? 'active' : ''}`}>
              <div className="activity-task-header">
                <div className="activity-task-title">
                  <Server size={16} />
                  Server Sync
                </div>
                <span className={`activity-task-status-pill ${syncPillClass}`}>
                  {syncActive && <RefreshCw size={12} className="activity-spin-icon" />}
                  {syncPillText}
                </span>
              </div>
              <div className="activity-task-message">{syncProgressText}</div>

              {syncActive && syncTotal > 0 && (
                <div className="activity-task-progress-bar-container">
                  <div
                    className="activity-task-progress-bar"
                    style={{ width: `${Math.min(100, Math.round((syncCurrent / syncTotal) * 100))}%` }}
                  />
                </div>
              )}

              <div className="activity-task-actions">
                {syncStatus?.enabled && onSyncNow && (
                  <button
                    className="activity-btn primary"
                    onClick={onSyncNow}
                    disabled={syncingNow || syncActive}
                    title="Trigger instant backup"
                  >
                    {syncingNow || syncActive ? (
                      <>
                        <RefreshCw size={12} className="activity-spin-icon" /> Syncing...
                      </>
                    ) : (
                      <>
                        <Play size={12} /> Sync Now
                      </>
                    )}
                  </button>
                )}
                {onOpenSyncConfig && (
                  <button className="activity-btn" onClick={onOpenSyncConfig} title="Sync Settings">
                    <Settings size={12} /> Configure Sync
                  </button>
                )}
                <button
                  className="activity-btn"
                  onClick={handleFetchDiagnostics}
                  disabled={loadingDiagnostics}
                  title="Run File List Diagnostics"
                >
                  <FileText size={12} /> {loadingDiagnostics ? 'Scanning...' : 'Diagnostics'}
                </button>
              </div>

              {showDiagnostics && (
                <div className="activity-diagnostics-box" style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-tertiary, #1a1a1a)', borderRadius: '6px', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <strong>Sync Diagnostics Report</strong>
                    <button className="activity-btn" style={{ padding: '2px 6px', fontSize: '0.75rem' }} onClick={() => setShowDiagnostics(false)}>Close</button>
                  </div>
                  {loadingDiagnostics ? (
                    <div>Analyzing library file list...</div>
                  ) : diagnostics ? (
                    <div>
                      <div><strong>Total Files Scanned:</strong> {diagnostics.total_files.toLocaleString()} ({Math.round(diagnostics.total_bytes / (1024 * 1024))} MB)</div>
                      
                      <div style={{ marginTop: '8px' }}><strong>Source Folders:</strong></div>
                      <ul style={{ margin: '4px 0 8px 16px', padding: 0 }}>
                        {diagnostics.rules_breakdown.map((r, idx) => (
                          <li key={idx}>
                            <code>{r.name}</code> ({r.path}): <strong>{r.file_count.toLocaleString()} files</strong> ({Math.round(r.total_bytes / (1024 * 1024))} MB)
                          </li>
                        ))}
                      </ul>

                      <div><strong>Top File Extensions:</strong></div>
                      <div style={{ margin: '4px 0 8px 0', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {diagnostics.extension_counts.slice(0, 10).map(([ext, count], idx) => (
                          <span key={idx} style={{ background: 'var(--bg-secondary, #2a2a2a)', padding: '2px 6px', borderRadius: '4px' }}>
                            .{ext}: {count.toLocaleString()}
                          </span>
                        ))}
                      </div>

                      {diagnostics.sample_files.length > 0 && (
                        <div>
                          <div><strong>Sample Files:</strong></div>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0, maxHeight: '100px', overflowY: 'auto' }}>
                            {diagnostics.sample_files.slice(0, 8).map((f, idx) => (
                              <li key={idx} style={{ wordBreak: 'break-all' }}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>No diagnostic info available.</div>
                  )}
                </div>
              )}
            </div>

            {/* Folder Import / Refresh Task */}
            <div className={`activity-task-card ${importActive ? 'active' : ''}`}>
              <div className="activity-task-header">
                <div className="activity-task-title">
                  <FolderDown size={16} />
                  Folder Import & Refresh
                </div>
                <span className={`activity-task-status-pill ${importActive ? 'active' : 'idle'}`}>
                  {importActive && <RefreshCw size={12} className="activity-spin-icon" />}
                  {importActive ? 'Importing' : 'Idle'}
                </span>
              </div>
              <div className="activity-task-message">
                {importActive ? importMessage : 'No folder import or refresh currently active.'}
              </div>

              {importActive && (
                <div className="activity-task-progress-bar-container">
                  <div
                    className="activity-task-progress-bar"
                    style={{
                      width: importTotal > 0 ? `${Math.min(100, Math.round((importCurrent / importTotal) * 100))}%` : '100%',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Photo Export Task */}
            <div className={`activity-task-card ${exportActive ? 'active' : ''}`}>
              <div className="activity-task-header">
                <div className="activity-task-title">
                  <Download size={16} />
                  Photo Export
                </div>
                <span className={`activity-task-status-pill ${exportActive ? 'active' : 'idle'}`}>
                  {exportActive && <RefreshCw size={12} className="activity-spin-icon" />}
                  {exportActive ? 'Exporting' : 'Idle'}
                </span>
              </div>
              <div className="activity-task-message">
                {exportActive ? exportMessage : 'No export job currently active.'}
              </div>

              {exportActive && (
                <div className="activity-task-progress-bar-container">
                  <div
                    className="activity-task-progress-bar"
                    style={{
                      width: exportTotal > 0 ? `${Math.min(100, Math.round((exportCurrent / exportTotal) * 100))}%` : '100%',
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="activity-dialog-footer">
          <button className="activity-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
