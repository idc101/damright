import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Folder,
  Server,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Play,
  HardDrive,
  CloudUpload,
  CloudDownload,
  ShieldOff,
  Sparkles,
  Ban,
} from 'lucide-react';
import { Source, AppConfig } from '../types';
import './FolderSyncModal.css';

interface FolderSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshSources?: () => void;
}

export const FolderSyncModal: React.FC<FolderSyncModalProps> = ({
  isOpen,
  onClose,
  onRefreshSources,
}) => {
  const [activeTab, setActiveTab] = useState<'folders' | 'server'>('folders');
  const [sources, setSources] = useState<Source[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [fullConfig, setFullConfig] = useState<AppConfig | null>(null);

  // Server settings
  const [endpoint, setEndpoint] = useState('http://localhost:8010');
  const [enabled, setEnabled] = useState(false);
  const [debounceMinutes, setDebounceMinutes] = useState(30);

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const [saving, setSaving] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setLoadingSources(true);
    try {
      const srcList = await invoke<Source[]>('get_all_sources');
      setSources(srcList);

      const config = await invoke<AppConfig>('get_sync_config');
      setFullConfig(config);
      if (config && config.server_sync) {
        setEndpoint(config.server_sync.endpoint || 'http://localhost:8010');
        setEnabled(config.server_sync.enabled ?? false);
        setDebounceMinutes(config.server_sync.debounce_minutes || 30);
      }
    } catch (err) {
      console.error('Failed to load folder & sync data:', err);
    } finally {
      setLoadingSources(false);
    }
  };

  const handleAddFolder = async () => {
    try {
      const newSource = await invoke<Source>('add_source', { path: '' });
      if (newSource) {
        await loadData();
        if (onRefreshSources) onRefreshSources();
      }
    } catch (err) {
      console.error('Failed to add source folder:', err);
    }
  };

  const handleUpdateSourceMode = async (
    source: Source,
    syncMode: 'push' | 'pull' | 'none'
  ) => {
    try {
      await invoke('update_source_sync_settings', {
        id: source.id,
        syncMode,
        serverPath: source.server_path || source.name,
        archivePrefix: source.archive_prefix || null,
        ratingEnabled: source.rating_enabled ?? true,
      });
      setSources(prev =>
        prev.map(s => (s.id === source.id ? { ...s, sync_mode: syncMode } : s))
      );
    } catch (err) {
      console.error('Failed to update source mode:', err);
    }
  };

  const handleUpdateRatingEnabled = async (
    source: Source,
    ratingEnabled: boolean
  ) => {
    try {
      await invoke('update_source_sync_settings', {
        id: source.id,
        syncMode: source.sync_mode || 'none',
        serverPath: source.server_path || source.name,
        archivePrefix: source.archive_prefix || null,
        ratingEnabled,
      });
      setSources(prev =>
        prev.map(s => (s.id === source.id ? { ...s, rating_enabled: ratingEnabled } : s))
      );
    } catch (err) {
      console.error('Failed to update source rating setting:', err);
    }
  };

  const handleDeleteSource = async (id: string) => {
    if (!confirm('Are you sure you want to remove this folder from DamRight?')) return;
    try {
      await invoke('delete_source', { id });
      setSources(prev => prev.filter(s => s.id !== id));
      if (onRefreshSources) onRefreshSources();
    } catch (err) {
      console.error('Failed to delete source:', err);
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('Connecting to server...');
    try {
      const ok = await invoke<boolean>('test_server_config', {
        config: {
          endpoint,
          enabled,
          debounce_minutes: debounceMinutes,
          folder_rules: {},
        },
      });
      if (ok) {
        setTestStatus('success');
        setTestMessage('Connection successful!');
      } else {
        setTestStatus('error');
        setTestMessage('Server returned unreachable status.');
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(`Connection failed: ${err.message || err}`);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const existingRules = fullConfig?.server_sync?.folder_rules || {};
      const updatedConfig: AppConfig = {
        server_sync: {
          endpoint,
          enabled,
          debounce_minutes: debounceMinutes,
          folder_rules: existingRules,
        },
        local: { web_port: fullConfig?.local?.web_port || 8010 },
      };
      await invoke('save_sync_config', { config: updatedConfig });
      setFullConfig(updatedConfig);
    } catch (err) {
      console.error('Failed to save sync config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndSyncNow = async () => {
    await handleSaveConfig();
    setSyncingNow(true);
    try {
      await invoke('trigger_sync_now');
      onClose();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncingNow(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="folder-sync-overlay" onClick={onClose} data-testid="folder-sync-overlay">
      <div className="folder-sync-modal" onClick={e => e.stopPropagation()}>
        <div className="folder-sync-header">
          <div className="folder-sync-title">
            <HardDrive size={20} />
            <h2>Manage Library Folders & Home Server Sync</h2>
          </div>
          <button className="folder-sync-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="folder-sync-tabs">
          <button
            className={`folder-sync-tab ${activeTab === 'folders' ? 'active' : ''}`}
            onClick={() => setActiveTab('folders')}
          >
            <Folder size={16} />
            Library Folders ({sources.length})
          </button>
          <button
            className={`folder-sync-tab ${activeTab === 'server' ? 'active' : ''}`}
            onClick={() => setActiveTab('server')}
          >
            <Server size={16} />
            Home Server Sync Settings
          </button>
        </div>

        <div className="folder-sync-body">
          {activeTab === 'folders' && (
            <div className="folder-sync-tab-content">
              <div className="folder-sync-toolbar">
                <p className="folder-sync-hint">
                  Configure local photo library folders and select backup / sync behavior for each folder.
                </p>
                <button className="folder-sync-btn primary" onClick={handleAddFolder}>
                  <Plus size={14} /> Add Folder
                </button>
              </div>

              {loadingSources ? (
                <div className="folder-sync-empty">Loading folders...</div>
              ) : sources.length === 0 ? (
                <div className="folder-sync-empty">
                  No folders added yet. Click "Add Folder" to index your media library.
                </div>
              ) : (
                <div className="folder-list">
                  {sources.map(source => (
                    <div key={source.id} className="folder-card">
                      <div className="folder-card-main">
                        <div className="folder-card-name">
                          <Folder size={18} className="folder-icon" />
                          <div>
                            <strong>{source.name}</strong>
                            <div className="folder-card-path">{source.path}</div>
                          </div>
                        </div>
                        <button
                          className="folder-remove-btn"
                          onClick={() => handleDeleteSource(source.id)}
                          title="Remove folder from DamRight"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="folder-card-options">
                        <div className="folder-card-option-row">
                          <span className="mode-label">Sync Mode:</span>
                          <div className="mode-pills">
                            <button
                              className={`mode-pill ${source.sync_mode === 'push' ? 'active push' : ''}`}
                              onClick={() => handleUpdateSourceMode(source, 'push')}
                              title="Backup local photos to server"
                            >
                              <CloudUpload size={12} /> Push (Backup)
                            </button>
                            <button
                              className={`mode-pill ${source.sync_mode === 'pull' ? 'active pull' : ''}`}
                              onClick={() => handleUpdateSourceMode(source, 'pull')}
                              title="Download server Inbox photos to laptop"
                            >
                              <CloudDownload size={12} /> Pull (Inbox)
                            </button>
                            <button
                              className={`mode-pill ${(!source.sync_mode || source.sync_mode === 'none') ? 'active none' : ''}`}
                              onClick={() => handleUpdateSourceMode(source, 'none')}
                              title="Index locally only, do not sync to server"
                            >
                              <ShieldOff size={12} /> Local Only
                            </button>
                          </div>
                        </div>

                        <div className="folder-card-option-row">
                          <span className="mode-label">Photo Rater:</span>
                          <div className="mode-pills">
                            <button
                              className={`mode-pill ${source.rating_enabled !== false ? 'active rating-enabled' : ''}`}
                              onClick={() => handleUpdateRatingEnabled(source, true)}
                              title="Include photos in this folder in Photo Force Ranker"
                            >
                              <Sparkles size={12} /> Rankable
                            </button>
                            <button
                              className={`mode-pill ${source.rating_enabled === false ? 'active rating-disabled' : ''}`}
                              onClick={() => handleUpdateRatingEnabled(source, false)}
                              title="Exclude photos in this folder from Photo Force Ranker"
                            >
                              <Ban size={12} /> Excluded
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'server' && (
            <div className="folder-sync-tab-content">
              <div className="form-group toggle-group">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setEnabled(e.target.checked)}
                  />
                  <span>Enable Home Server Background Backup</span>
                </label>
              </div>

              <div className="form-group">
                <label>Home Server Endpoint URL</label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                  placeholder="http://localhost:8010"
                  className="folder-sync-input"
                />
              </div>

              <div className="form-group">
                <label>Auto-Sync Interval (minutes)</label>
                <input
                  type="number"
                  value={debounceMinutes}
                  onChange={e => setDebounceMinutes(Number(e.target.value))}
                  className="folder-sync-input"
                  min={1}
                />
              </div>

              <div className="connection-test-section">
                <button
                  type="button"
                  className="folder-sync-btn"
                  onClick={handleTestConnection}
                  disabled={testStatus === 'testing'}
                >
                  {testStatus === 'testing' ? (
                    <>
                      <RefreshCw size={14} className="spin" /> Testing...
                    </>
                  ) : (
                    'Test Server Connection'
                  )}
                </button>
                {testStatus === 'success' && (
                  <span className="test-badge success">
                    <CheckCircle2 size={14} /> {testMessage}
                  </span>
                )}
                {testStatus === 'error' && (
                  <span className="test-badge error">
                    <XCircle size={14} /> {testMessage}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="folder-sync-footer">
          <button className="folder-sync-btn" onClick={onClose}>
            Done
          </button>
          {enabled && (
            <button
              className="folder-sync-btn primary"
              onClick={handleSaveAndSyncNow}
              disabled={syncingNow || saving}
            >
              {syncingNow ? (
                <>
                  <RefreshCw size={14} className="spin" /> Syncing...
                </>
              ) : (
                <>
                  <Play size={14} /> Save & Sync Now
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
