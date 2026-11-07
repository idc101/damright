import { useState, useEffect, useCallback } from "react";
import { Photo } from "../types";

export function usePhotoContextMenu() {
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, photo: Photo } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, photo: Photo, onSelect?: (photo: Photo) => void, isSelected?: boolean) => {
    e.preventDefault();
    if (onSelect && !isSelected) {
      onSelect(photo);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, photo });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (contextMenu) {
      window.addEventListener("click", closeContextMenu);
    }
    return () => window.removeEventListener("click", closeContextMenu);
  }, [contextMenu, closeContextMenu]);

  return {
    contextMenu,
    handleContextMenu,
    closeContextMenu
  };
}
