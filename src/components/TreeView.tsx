import React, { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Folder, RefreshCw, Trash2, Type, ExternalLink, FolderInput } from "lucide-react";
import { DirEntry } from "../types";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface TreeViewProps {
  node: DirEntry;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  onRefresh: (path: string) => void;
  onPhotosDeleted: () => void;
  onAutoRename: (path: string, id?: string) => Promise<number>;
  onMoveFolder?: (node: DirEntry) => void;
  isSourceRoot?: boolean;
  expandTrigger?: number;
  collapseTrigger?: number;
}

const TreeView: React.FC<TreeViewProps> = ({ 
  node, 
  onSelect, 
  selectedPath, 
  onRefresh, 
  onPhotosDeleted, 
  onAutoRename,
  onMoveFolder,
  isSourceRoot = false,
  expandTrigger = 0,
  collapseTrigger = 0
}) => {
  const [isOpen, setIsOpen] = useState(() => {
    const saved = localStorage.getItem(`expanded_node:${node.path}`);
    return saved !== null ? saved === "true" : true;
  });
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
  const isSelected = selectedPath === node.path;

  useEffect(() => {
    const saved = localStorage.getItem(`expanded_node:${node.path}`);
    setIsOpen(saved !== null ? saved === "true" : true);
  }, [node.path]);

  useEffect(() => {
    if (expandTrigger > 0) {
      setIsOpen(true);
      localStorage.setItem(`expanded_node:${node.path}`, "true");
    }
  }, [expandTrigger, node.path]);

  useEffect(() => {
    if (collapseTrigger > 0) {
      setIsOpen(false);
      localStorage.setItem(`expanded_node:${node.path}`, "false");
    }
  }, [collapseTrigger, node.path]);

  useEffect(() => {
    if (selectedPath) {
      const isParent = selectedPath.startsWith(node.path + "/") || selectedPath.startsWith(node.path + "\\");
      if (isParent) {
        setIsOpen(true);
        localStorage.setItem(`expanded_node:${node.path}`, "true");
      }
    }
  }, [selectedPath, node.path]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener("click", handleClickOutside);
    }
    return () => window.removeEventListener("click", handleClickOutside);
  }, [contextMenu]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    localStorage.setItem(`expanded_node:${node.path}`, String(nextOpen));
  };

  const handleSelect = () => {
    onSelect(node.path);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRefresh(node.path);
    setContextMenu(null);
  };

  const handleReveal = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("reveal_in_finder", { path: node.path });
    setContextMenu(null);
  };

  const handleMoveFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(null);
    onMoveFolder?.(node);
  };

  const handleAutoRename = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(null);
    
    try {
      const confirmed = await confirm(
        `Are you sure you want to rename all photos in this folder to the standard format (YYYYMMDDTHHMMSS-hash)? This will modify the files on disk.`,
        { title: 'Confirm Auto-Rename', kind: 'info' }
      );

      if (confirmed) {
        const count = await onAutoRename(node.path);
        await message(`Successfully renamed ${count} photo(s).`, { title: 'Auto-Rename Complete', kind: 'info' });
      }
    } catch (err) {
      console.error("Failed to auto-rename photos:", err);
    }
  };

  const handleDeleteRejected = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(null);
    
    try {
      // First, we need to know how many are rejected.
      // We could add a command for this, or just try to delete and return count.
      // Let's use a simple approach: call the delete command, and it returns the count.
      // But the user wants a confirmation *with* the count.
      // I'll add a 'get_rejected_count' command or just use get_all_photos and filter.
      // Actually, let's keep it simple and just ask for confirmation generally first, 
      // or implement a quick count command.
      
      const photos = await invoke("get_all_photos") as any[];
      const rejectedInThisFolder = photos.filter(p => p.rejected && p.path.startsWith(node.path));
      
      if (rejectedInThisFolder.length === 0) {
        alert("No rejected images found in this folder.");
        return;
      }

      const confirmed = await confirm(
        `Are you sure you want to delete ${rejectedInThisFolder.length} rejected image(s)? This will also delete their XMP sidecars and cannot be undone.`,
        { title: 'Confirm Deletion', kind: 'warning' }
      );

      if (confirmed) {
        await invoke("delete_rejected", { folderPath: node.path });
        onPhotosDeleted();
      }
    } catch (err) {
      console.error("Failed to delete rejected images:", err);
    }
  };

  return (
    <div className="tree-node">
      <div 
        className={`tree-label ${isSelected ? "selected" : ""}`}
        onClick={handleSelect}
        onContextMenu={handleContextMenu}
      >
        <span className="toggle-icon" onClick={handleToggle}>
          {node.children.length > 0 ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span style={{ width: 14 }} />
          )}
        </span>
        <Folder size={14} className="folder-icon" />
        <span className="node-name">{node.name}</span>
        <span className="photo-count">({node.photo_count})</span>
      </div>

      {contextMenu && (
        <div 
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={handleReveal}>
            <ExternalLink size={14} /> Reveal in Finder
          </button>
          {!isSourceRoot && onMoveFolder && (
            <button onClick={handleMoveFolder} data-testid="move-folder-menu-btn">
              <FolderInput size={14} /> Move / Rename Folder...
            </button>
          )}
          <button onClick={handleDeleteRejected} style={{ color: "#ff4444" }}>
            <Trash2 size={14} /> Delete Rejected Images
          </button>
          <button onClick={handleAutoRename}>
            <Type size={14} /> Auto Rename Photos
          </button>
          <button onClick={handleRefresh}>
            <RefreshCw size={14} /> Refresh Folder
          </button>
        </div>
      )}

      {isOpen && node.children.length > 0 && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeView 
              key={child.path} 
              node={child} 
              onSelect={onSelect} 
              selectedPath={selectedPath}
              onRefresh={onRefresh}
              onPhotosDeleted={onPhotosDeleted}
              onAutoRename={onAutoRename}
              onMoveFolder={onMoveFolder}
              isSourceRoot={false}
              expandTrigger={expandTrigger}
              collapseTrigger={collapseTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TreeView;
