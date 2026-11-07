import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, CheckCircle2, RefreshCw, CloudOff } from 'lucide-react';
import { FolderSyncModal } from './FolderSyncModal';
import { ActivityDialog } from './ActivityDialog';
import { Progress, SyncStatus } from '../types';
import './ActivityBadge.css';

export interface ActivityBadgeProps {
  importing?: boolean;
  importProgress?: Progress | null;
  exporting?: boolean;
  exportProgress?: Progress | null;
}

export const ActivityBadge: React.FC<ActivityBadgeProps> = ({
  importing = false,
  importProgress = null,
  exporting = false,
  exportProgress = null,
}) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const st = await invoke<SyncStatus>('get_sync_status');
      setSyncStatus(st);
    } catch {
      // Ignore if not in Tauri environment
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
    const intervalTime = isActivityOpen || syncingNow ? 1000 : 3000;
    const interval = setInterval(fetchSyncStatus, intervalTime);
    return () => clearInterval(interval);
  }, [fetchSyncStatus, isActivityOpen, syncingNow]);

  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      await invoke('trigger_sync_now');
      await fetchSyncStatus();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncingNow(false);
    }
  };

  // Determine Sync active status and counts
  let syncActive = false;
  let syncCurrent = 0;
  let syncTotal = 0;

  if (syncStatus && syncStatus.enabled) {
    const stage = syncStatus.stage;
    if (typeof stage === 'string' && stage === 'Scanning') {
      syncActive = true;
    } else if (typeof stage === 'object') {
      if ('Scanning' in stage) {
        syncActive = true;
        syncCurrent = stage.Scanning.files_scanned || 0;
      } else if ('Syncing' in stage) {
        syncActive = true;
        const { files_done, total_files, bytes_done, total_bytes } = stage.Syncing;
        if (total_bytes > 0) {
          syncCurrent = bytes_done;
          syncTotal = total_bytes;
        } else {
          syncCurrent = files_done;
          syncTotal = total_files;
        }
      }
    }
  }

  // Import active status and counts
  const importActive = importing || importProgress !== null;
  const importCurrent = importProgress?.current || 0;
  const importTotal = importProgress?.total || 0;

  // Export active status and counts
  const exportActive = exporting || exportProgress !== null;
  const exportCurrent = exportProgress?.current || 0;
  const exportTotal = exportProgress?.total || 0;

  const totalActiveTasks = (syncActive ? 1 : 0) + (importActive ? 1 : 0) + (exportActive ? 1 : 0);

  // Calculate combined percentage
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
  const combinedPercentage = hasDeterminedProgress
    ? Math.min(100, Math.round((sumCurrent / sumTotal) * 100))
    : null;

  // Tooltip
  let tooltipText = '';
  if (totalActiveTasks > 0) {
    tooltipText = `Activity: ${totalActiveTasks} task(s) active (${
      combinedPercentage !== null ? `${combinedPercentage}%` : 'In progress'
    }). Click for details.`;
  } else {
    tooltipText = 'Activity Center: Idle. Click to view background details.';
  }

  const isSyncing = syncingNow || syncActive;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <button
        onClick={() => setIsActivityOpen(true)}
        className={`activity-badge-button ${totalActiveTasks > 0 ? 'active' : ''}`}
        title={tooltipText}
        data-testid="activity-badge-button"
      >
        {totalActiveTasks > 0 ? (
          <>
            <RefreshCw size={14} className="activity-badge-icon-spin" />
            <span>Activity</span>
            <span className="activity-badge-pct">
              {combinedPercentage !== null ? `${combinedPercentage}%` : '...'}
            </span>
          </>
        ) : (
          <>
            <Activity size={14} className="activity-badge-idle" />
            {!syncStatus || !syncStatus.enabled ? (
              <>
                <CloudOff size={12} style={{ color: '#888' }} />
                <span style={{ color: '#888' }}>Sync Off</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={12} className="activity-badge-idle" />
                <span className="activity-badge-idle">Synced</span>
              </>
            )}
          </>
        )}
      </button>

      {syncStatus?.enabled && (
        <button
          onClick={handleSyncNow}
          disabled={isSyncing}
          style={{
            background: isSyncing ? '#333' : '#2196f3',
            border: 'none',
            borderRadius: '6px',
            padding: '4px 10px',
            color: '#fff',
            cursor: isSyncing ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: 500,
            height: '28px',
          }}
          title="Trigger instant library backup"
        >
          {isSyncing ? '🔄 Syncing...' : 'Sync Now'}
        </button>
      )}

      <ActivityDialog
        isOpen={isActivityOpen}
        onClose={() => {
          setIsActivityOpen(false);
          fetchSyncStatus();
        }}
        syncStatus={syncStatus}
        onSyncNow={handleSyncNow}
        onOpenSyncConfig={() => {
          setIsActivityOpen(false);
          setIsSyncModalOpen(true);
        }}
        importing={importing}
        importProgress={importProgress}
        exporting={exporting}
        exportProgress={exportProgress}
        syncingNow={syncingNow}
      />

      <FolderSyncModal
        isOpen={isSyncModalOpen}
        onClose={() => {
          setIsSyncModalOpen(false);
          fetchSyncStatus();
        }}
        onRefreshSources={fetchSyncStatus}
      />
    </div>
  );
};
