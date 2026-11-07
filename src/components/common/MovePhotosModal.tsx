import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Photo, DirEntry } from '../../types';
import { FolderPlus, ChevronRight, ChevronDown, Folder, Loader2 } from 'lucide-react';
import './MovePhotosModal.css';

export interface CreatedSubfolder {
  parentPath: string;
  name: string;
  fullPath: string;
}

interface MovePhotosModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMove: (destFolder: string, autoRename?: boolean) => void | Promise<void>;
  trees: DirEntry[];
  selectedCount: number;
  initialPhoto?: Photo | null;
}

export function getSuggestedFolderName(parentPath: string | null, photo?: Photo | null): string {
  if (!photo) return 'New Folder';

  let year: string | null = null;
  let month: string | null = null;
  let day: string | null = null;

  if (photo.capture_time) {
    const match = photo.capture_time.match(/(\d{4})[-:/.](\d{2})[-:/.](\d{2})/);
    if (match) {
      year = match[1];
      month = match[2];
      day = match[3];
    } else {
      const d = new Date(photo.capture_time.replace(' ', 'T'));
      if (!isNaN(d.getTime())) {
        year = d.getFullYear().toString();
        month = (d.getMonth() + 1).toString().padStart(2, '0');
        day = d.getDate().toString().padStart(2, '0');
      }
    }
  }

  const eventName = photo.event?.trim() || '';
  const parentFolderName = parentPath
    ? parentPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || ''
    : '';

  const isParentYear = /^\d{4}$/.test(parentFolderName);
  const isParentDate = /^\d{2}-\d{2}$/.test(parentFolderName) || /^\d{4}-\d{2}-\d{2}$/.test(parentFolderName);

  if (year && month && day) {
    if (isParentDate && eventName) {
      return eventName;
    }
    const datePrefix = isParentYear ? `${month}-${day}` : `${year}-${month}-${day}`;
    return eventName ? `${datePrefix} ${eventName}` : datePrefix;
  }

  if (eventName) {
    return eventName;
  }

  return 'New Folder';
}

export const MovePhotosModal: React.FC<MovePhotosModalProps> = ({ 
  isOpen, 
  onClose, 
  onMove, 
  trees, 
  selectedCount, 
  initialPhoto 
}) => {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [createdSubfolder, setCreatedSubfolder] = useState<CreatedSubfolder | null>(null);
  const [shouldAutoRename, setShouldAutoRename] = useState(true);
  const [isMoving, setIsMoving] = useState(false);

  // Reset state whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setSelectedFolder(null);
      setNewFolderName('');
      setShowNewFolderInput(false);
      setCreatedSubfolder(null);
      setShouldAutoRename(true);
      setIsMoving(false);
    }
  }, [isOpen]);

  const handleShowNewFolder = () => {
    if (!selectedFolder) return;
    const suggested = getSuggestedFolderName(selectedFolder, initialPhoto);
    setNewFolderName(suggested);
    setShowNewFolderInput(true);
  };

  const handleConfirmNewFolder = () => {
    const trimmed = newFolderName.trim();
    if (!selectedFolder || !trimmed) return;

    const separator = selectedFolder.includes('\\') ? '\\' : '/';
    const newPath = selectedFolder.endsWith(separator)
      ? `${selectedFolder}${trimmed}`
      : `${selectedFolder}${separator}${trimmed}`;

    setCreatedSubfolder({
      parentPath: selectedFolder,
      name: trimmed,
      fullPath: newPath,
    });
    setSelectedFolder(newPath);
    setShowNewFolderInput(false);
    setNewFolderName('');
  };

  const handleCancelNewFolder = () => {
    setShowNewFolderInput(false);
    setNewFolderName('');
  };

  const getResolvedDestination = () => {
    if (!selectedFolder) return null;
    if (showNewFolderInput && newFolderName.trim()) {
      const separator = selectedFolder.includes('\\') ? '\\' : '/';
      return selectedFolder.endsWith(separator) 
        ? `${selectedFolder}${newFolderName.trim()}` 
        : `${selectedFolder}${separator}${newFolderName.trim()}`;
    }
    return selectedFolder;
  };

  const resolvedDestination = getResolvedDestination();

  const handleMove = async () => {
    if (!resolvedDestination || isMoving) return;
    setIsMoving(true);
    try {
      await onMove(resolvedDestination, shouldAutoRename);
    } catch (err) {
      console.error("Failed to move photos:", err);
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Modal
      title={`Move ${selectedCount} Photo${selectedCount > 1 ? 's' : ''}`}
      isOpen={isOpen}
      onClose={isMoving ? () => {} : onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose} disabled={isMoving}>
            Cancel
          </button>
          <button 
            className="primary-button move-submit-btn" 
            onClick={handleMove} 
            disabled={!resolvedDestination || (showNewFolderInput && !newFolderName.trim()) || isMoving}
          >
            {isMoving ? (
              <>
                <Loader2 size={16} className="spinner" />
                <span>Moving...</span>
              </>
            ) : (
              'Move'
            )}
          </button>
        </>
      }
    >
      <div className={`move-modal-body ${isMoving ? 'is-moving' : ''}`}>
        <p className="modal-instruction">Select destination folder:</p>
        <div className="folder-selector-tree">
          {trees.map(tree => (
            <SimpleFolderTree 
              key={tree.path} 
              node={tree} 
              selectedPath={selectedFolder} 
              onSelect={setSelectedFolder}
              createdSubfolder={createdSubfolder}
            />
          ))}
        </div>

        {resolvedDestination && (
          <div className="destination-preview" data-testid="destination-preview">
            <span className="destination-label">Target:</span>
            <span className="destination-path" title={resolvedDestination}>
              {resolvedDestination}
            </span>
          </div>
        )}
        
        <div className="new-folder-action">
          {!showNewFolderInput ? (
            <button 
              className="text-button" 
              onClick={handleShowNewFolder}
              disabled={!selectedFolder || isMoving}
            >
              <FolderPlus size={16} /> Create New Folder in Selected
            </button>
          ) : (
            <div className="new-folder-input-container">
              <div className="new-folder-input-row">
                <input 
                  type="text" 
                  placeholder="Folder name..." 
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirmNewFolder();
                    } else if (e.key === 'Escape') {
                      handleCancelNewFolder();
                    }
                  }}
                  disabled={isMoving}
                  autoFocus
                />
                <button 
                  type="button"
                  className="primary-button btn-small new-folder-ok-btn" 
                  onClick={handleConfirmNewFolder}
                  disabled={!newFolderName.trim() || isMoving}
                >
                  OK
                </button>
                <button 
                  type="button"
                  className="secondary-button btn-small new-folder-cancel-btn" 
                  onClick={handleCancelNewFolder}
                  disabled={isMoving}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {isMoving && (
          <div className="move-progress-banner" data-testid="move-progress-banner">
            <Loader2 size={16} className="spinner" />
            <span>Moving {selectedCount} photo{selectedCount > 1 ? 's' : ''}...</span>
          </div>
        )}

        <div className="auto-rename-action">
          <label className="auto-rename-checkbox-label">
            <input 
              type="checkbox" 
              checked={shouldAutoRename} 
              onChange={(e) => setShouldAutoRename(e.target.checked)}
              disabled={isMoving}
            />
            <span>Auto-rename photo{selectedCount > 1 ? 's' : ''} to standard format (<code>YYYYMMDDTHHMMSS-hash</code>)</span>
          </label>
        </div>
      </div>
    </Modal>
  );
};

export interface SimpleFolderTreeProps {
  node: DirEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  createdSubfolder?: CreatedSubfolder | null;
  disabledPathPrefix?: string;
}

export const SimpleFolderTree: React.FC<SimpleFolderTreeProps> = ({ 
  node, 
  selectedPath, 
  onSelect,
  createdSubfolder,
  disabledPathPrefix
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = selectedPath === node.path;
  const hasCreatedChild = createdSubfolder?.parentPath === node.path;
  const isAncestorOfSelected = selectedPath 
    ? selectedPath.startsWith(node.path + '/') || selectedPath.startsWith(node.path + '\\')
    : false;

  const normNode = node.path.replace(/\\/g, '/');
  const normDisabled = disabledPathPrefix ? disabledPathPrefix.replace(/\\/g, '/') : null;
  const isDisabled = normDisabled
    ? normNode === normDisabled || normNode.startsWith(normDisabled + '/')
    : false;

  useEffect(() => {
    if (hasCreatedChild || isAncestorOfSelected) {
      setIsOpen(true);
    }
  }, [hasCreatedChild, isAncestorOfSelected]);
  
  return (
    <div className="simple-tree-node">
      <div 
        className={`simple-tree-label ${isSelected ? "selected" : ""} ${isDisabled ? "disabled" : ""}`}
        onClick={() => {
          if (!isDisabled) onSelect(node.path);
        }}
        style={isDisabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
      >
        <span className="toggle-icon" onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}>
          {node.children.length > 0 || hasCreatedChild ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : <span style={{ width: 14 }} />}
        </span>
        <Folder size={14} className="folder-icon" />
        <span className="node-name">{node.name}</span>
      </div>
      {isOpen && (
        <div className="simple-tree-children">
          {node.children.map(child => (
            <SimpleFolderTree 
              key={child.path} 
              node={child} 
              selectedPath={selectedPath} 
              onSelect={onSelect} 
              createdSubfolder={createdSubfolder}
              disabledPathPrefix={disabledPathPrefix}
            />
          ))}
          {hasCreatedChild && createdSubfolder && !node.children.some(c => c.path === createdSubfolder.fullPath) && (
            <div className="simple-tree-node">
              <div 
                className={`simple-tree-label ${selectedPath === createdSubfolder.fullPath ? "selected" : ""}`}
                onClick={() => onSelect(createdSubfolder.fullPath)}
              >
                <span className="toggle-icon"><span style={{ width: 14 }} /></span>
                <FolderPlus size={14} className="folder-icon" />
                <span className="node-name">{createdSubfolder.name} <span className="new-badge">(New)</span></span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
