import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Photo } from "../types";

export interface SelectionModifiers {
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export function useSelection(items: Photo[]) {
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return localStorage.getItem("selectedPhotoId");
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("selectedPhotoId");
    return saved ? new Set([saved]) : new Set();
  });
  const prevItemsRef = useRef<Photo[]>(items);

  const itemMap = useMemo(() => {
    const map = new Map<string, Photo>();
    for (let i = 0; i < items.length; i++) {
      map.set(items[i].id, items[i]);
    }
    return map;
  }, [items]);

  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < items.length; i++) {
      map.set(items[i].id, i);
    }
    return map;
  }, [items]);

  const indexMapRef = useRef(indexMap);
  indexMapRef.current = indexMap;

  useEffect(() => {
    if (selectedId) {
      localStorage.setItem("selectedPhotoId", selectedId);
    } else {
      localStorage.removeItem("selectedPhotoId");
    }
  }, [selectedId]);

  useEffect(() => {
    const prevItems = prevItemsRef.current;
    if (prevItems === items) {
      return;
    }

    if (selectedId !== null) {
      const isStillPresent = itemMap.has(selectedId);

      if (isStillPresent) {
        // The currently selected item is still in the filtered list.
        // Clean up any IDs in selectedIds that no longer exist in items.
        setSelectedIds(prev => {
          let hasChanges = false;
          const next = new Set<string>();
          for (const id of prev) {
            if (itemMap.has(id)) {
              next.add(id);
            } else {
              hasChanges = true;
            }
          }
          if (!next.has(selectedId)) {
            next.add(selectedId);
            hasChanges = true;
          }
          return hasChanges ? next : prev;
        });
      } else {
        // The selected item is no longer in items (was deleted or filtered out).
        // Find the earliest selected photo's index in the previous items list.
        let pivotIndex = -1;
        if (selectedIds.size > 0) {
          for (let i = 0; i < prevItems.length; i++) {
            if (selectedIds.has(prevItems[i].id)) {
              pivotIndex = i;
              break;
            }
          }
        }
        if (pivotIndex === -1) {
          pivotIndex = prevItems.findIndex(p => p.id === selectedId);
        }

        let nextSelected: Photo | null = null;
        if (pivotIndex !== -1) {
          // Look backwards for the nearest photo that exists in the new items list
          for (let i = pivotIndex - 1; i >= 0; i--) {
            const found = itemMap.get(prevItems[i].id);
            if (found) {
              nextSelected = found;
              break;
            }
          }
        }

        // If no previous photo found (e.g. index 0 was removed), select the first photo in the new list if any
        if (!nextSelected && items.length > 0) {
          nextSelected = items[0];
        }

        if (nextSelected) {
          setSelectedId(nextSelected.id);
          setSelectedIds(new Set([nextSelected.id]));
        } else {
          setSelectedId(null);
          setSelectedIds(new Set());
        }
      }
    }

    prevItemsRef.current = items;
  }, [items, itemMap, selectedId, selectedIds]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const setSelectedItem = useCallback((photo: Photo | null) => {
    if (!photo) {
      setSelectedId(null);
      setSelectedIds(new Set());
    } else {
      setSelectedId(photo.id);
      setSelectedIds(new Set([photo.id]));
    }
  }, []);

  const handleSelect = useCallback((photo: Photo, modifiers: SelectionModifiers = {}) => {
    const { shift, ctrl, meta } = modifiers;
    const isMulti = ctrl || meta;
    const currentItems = itemsRef.current;
    const currentSelectedId = selectedIdRef.current;
    const currentIndexMap = indexMapRef.current;

    if (shift && currentSelectedId) {
      const currentIndex = currentIndexMap.get(photo.id) ?? -1;
      const pivotIndex = currentIndexMap.get(currentSelectedId) ?? -1;
      
      if (currentIndex !== -1 && pivotIndex !== -1) {
        const start = Math.min(currentIndex, pivotIndex);
        const end = Math.max(currentIndex, pivotIndex);
        setSelectedIds(prev => {
          const newSelection = new Set(prev);
          for (let i = start; i <= end; i++) {
            newSelection.add(currentItems[i].id);
          }
          return newSelection;
        });
      }
    } else if (isMulti) {
      setSelectedIds(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(photo.id)) {
          newSelection.delete(photo.id);
          // If we deselect the "primary" one, pick another
          if (currentSelectedId === photo.id) {
            const nextId = Array.from(newSelection).pop();
            setSelectedId(nextId || null);
          }
        } else {
          newSelection.add(photo.id);
          setSelectedId(photo.id);
        }
        return newSelection;
      });
    } else {
      setSelectedIds(new Set([photo.id]));
      setSelectedId(photo.id);
    }
  }, []);

  const selectAll = useCallback(() => {
    const currentItems = itemsRef.current;
    const currentSelectedId = selectedIdRef.current;
    if (currentItems.length === 0) {
      setSelectedIds(new Set());
      setSelectedId(null);
      return;
    }
    const allIds = new Set(currentItems.map(p => p.id));
    setSelectedIds(allIds);
    if (!currentSelectedId || !allIds.has(currentSelectedId)) {
      setSelectedId(currentItems[0].id);
    }
  }, []);

  const selectedItem = (selectedId ? itemMap.get(selectedId) : null) || null;

  return {
    selectedId,
    setSelectedId,
    selectedIds,
    setSelectedIds,
    handleSelect,
    selectAll,
    setSelectedItem,
    selectedItem,
  };
}
