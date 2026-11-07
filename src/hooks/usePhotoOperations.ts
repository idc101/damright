import { useCallback } from "react";
import { Photo } from "../types";
import { useApi } from "../services/ApiProvider";

export function usePhotoOperations(
  photos: Photo[],
  setPhotos: React.Dispatch<React.SetStateAction<Photo[]>>,
  selectedPhoto: Photo | null,
  setSelectedPhoto: React.Dispatch<React.SetStateAction<Photo | null>>,
  fetchPhotos: (query?: string) => Promise<void>
) {
  const api = useApi();

  const toggleRejected = useCallback(async (id: string) => {
    const photo = photos.find(p => p.id === id);
    if (!photo) return;
    
    const newValue = !photo.rejected;
    try {
      await api.setRejected(id, newValue);
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, rejected: newValue } : p))
      );
      if (selectedPhoto?.id === id) {
        setSelectedPhoto(prev => prev ? { ...prev, rejected: newValue } : null);
      }
    } catch (err) {
      console.error("Failed to toggle rejected status:", err);
    }
  }, [api, photos, setPhotos, selectedPhoto, setSelectedPhoto]);

  const setEvent = useCallback(async (id: string, event: string | null) => {
    try {
      await api.setEvent(id, event);
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, event: event || undefined } : p))
      );
      if (selectedPhoto?.id === id) {
        setSelectedPhoto(prev => prev ? { ...prev, event: event || undefined } : null);
      }
    } catch (err) {
      console.error("Failed to set event:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  const batchSetEvent = useCallback(async (ids: string[], event: string | null) => {
    try {
      await api.batchSetEvent(ids, event);
      setPhotos((prev) =>
        prev.map((p) => (ids.includes(p.id) ? { ...p, event: event || undefined } : p))
      );
      if (selectedPhoto && ids.includes(selectedPhoto.id)) {
        setSelectedPhoto(prev => prev ? { ...prev, event: event || undefined } : null);
      }
    } catch (err) {
      console.error("Failed to batch set event:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  const autoRename = useCallback(async (path: string, id?: string) => {
    try {
      const count = await api.autoRename(path, id);
      if (count > 0) {
        await fetchPhotos();
      }
      return count;
    } catch (err) {
      console.error("Failed to auto-rename:", err);
      throw err;
    }
  }, [api, fetchPhotos]);

  const movePhotos = useCallback(async (ids: string[], destFolder: string) => {
    try {
      const count = await api.movePhotos(ids, destFolder);
      if (count > 0) {
        await fetchPhotos();
      }
      return count;
    } catch (err) {
      console.error("Failed to move photos:", err);
      throw err;
    }
  }, [api, fetchPhotos]);

  return {
    toggleRejected,
    setEvent,
    batchSetEvent,
    autoRename,
    movePhotos
  };
}
