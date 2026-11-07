import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { DirEntry } from '../../types';
import { Loader2, AlertCircle } from 'lucide-react';
import { SimpleFolderTree } from './MovePhotosModal';
import './MoveFolderModal.css';

export interface MoveFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folder: DirEntry | null;
  trees: DirEntry[];
  onMoveFolder: (srcPath: string, destPath: string) => Promise<void>;
}

export function getParentDirectoryPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 1) return '';
  parts.pop();
  const isAbsoluteUnix = path.startsWith('/');
  const parent = parts.join(separator);
  return isAbsoluteUnix ? '/' + parent : parent;
}

export const MoveFolderModal: React.FC<MoveFolderModalProps> = ({
  isOpen,
  onClose,
  folder,
  trees,
  onMoveFolder,
}) => {
  const [folderName, setFolderName] = useState('');
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const initialParent = folder ? getParentDirectoryPath(folder.path) : '';

  useEffect(() => {
    if (isOpen && folder) {
      setFolderName(folder.name);
      setSelectedParent(initialParent);
      setError(null);
      setIsMoving(false);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, folder, initialParent]);

  if (!folder) return null;

  const trimmedName = folderName.trim();
  const separator = folder.path.includes('\\') ? '\\' : '/';
  const resolvedDestination = selectedParent && trimmedName
    ? selectedParent.endsWith(separator)
      ? `${selectedParent}${trimmedName}`
      : `${selectedParent}${separator}${trimmedName}`
    : null;

  const isParentChanged = selectedParent !== null && selectedParent !== initialParent;
  const isNameChanged = trimmedName !== folder.name;
  const isUnchanged = !isParentChanged && !isNameChanged;
  const canSubmit = !!resolvedDestination && !isUnchanged && !isMoving;

  const getButtonText = () => {
    if (isMoving) return 'Processing...';
    if (isParentChanged && isNameChanged) return 'Move & Rename';
    if (isParentChanged) return 'Move Folder';
    return 'Rename Folder';
  };

  const getActionDescription = () => {
    if (isParentChanged && isNameChanged) {
      return 'Moving folder to new location and renaming it.';
    }
    if (isParentChanged) {
      return 'Moving folder to a new parent location.';
    }
    if (isNameChanged) {
      return 'Renaming folder in its current location.';
    }
    return 'Select a new parent folder or type a new folder name.';
  };

  const handleSubmit = async () => {
    if (!resolvedDestination || !canSubmit) return;
    setIsMoving(true);
    setError(null);
    try {
      await onMoveFolder(folder.path, resolvedDestination);
      onClose();
    } catch (err: any) {
      console.error('Failed to move or rename folder:', err);
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to move or rename folder';
      setError(msg);
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Modal
      title="Move or Rename Folder"
      isOpen={isOpen}
      onClose={isMoving ? () => {} : onClose}
      footer={
        <>
          <button className="secondary-button" onClick={onClose} disabled={isMoving}>
            Cancel
          </button>
          <button
            className="primary-button move-folder-submit-btn"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="move-folder-confirm-btn"
          >
            {isMoving ? (
              <>
                <Loader2 size={16} className="spinner" />
                <span>Moving...</span>
              </>
            ) : (
              getButtonText()
            )}
          </button>
        </>
      }
    >
      <div className={`move-folder-modal-body ${isMoving ? 'is-moving' : ''}`}>
        {error && (
          <div className="move-folder-error-banner" data-testid="move-folder-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="move-folder-field">
          <label className="move-folder-label" htmlFor="folder-name-input">Folder Name:</label>
          <input
            id="folder-name-input"
            ref={inputRef}
            type="text"
            className="move-folder-input"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={isMoving}
            placeholder="Folder name"
            data-testid="folder-name-input"
          />
        </div>

        <div className="move-folder-field">
          <label className="move-folder-label">Destination Parent Folder:</label>
          <div className="folder-selector-tree">
            {trees.map((tree) => (
              <SimpleFolderTree
                key={tree.path}
                node={tree}
                selectedPath={selectedParent}
                onSelect={setSelectedParent}
                disabledPathPrefix={folder.path}
              />
            ))}
          </div>
        </div>

        {resolvedDestination && (
          <div className="destination-preview" data-testid="folder-destination-preview">
            <span className="destination-label">Target:</span>
            <span className="destination-path" title={resolvedDestination}>
              {resolvedDestination}
            </span>
          </div>
        )}

        <p className="move-folder-hint">{getActionDescription()}</p>
      </div>
    </Modal>
  );
};
