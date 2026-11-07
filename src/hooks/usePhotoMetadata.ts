import { useCallback } from "react";
import { Photo } from "../types";
import { useApi } from "../services/ApiProvider";

import { clearPreviewCache } from "../utils/previewCache";

export function usePhotoMetadata(
  setPhotos: React.Dispatch<React.SetStateAction<Photo[]>>,
  selectedPhoto: Photo | null,
  setSelectedPhoto: React.Dispatch<React.SetStateAction<Photo | null>>
) {
  const api = useApi();

  const updateExposure = useCallback(async (id: string, val: number) => {
    try {
      await api.setExposure(id, val);
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, exposure: val } : p))
      );
      if (selectedPhoto?.id === id) {
        setSelectedPhoto(prev => prev ? { ...prev, exposure: val } : null);
      }
    } catch (err) {
      console.error("Failed to update exposure:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  const updateMetadata = useCallback(async (id: string, rating: number, tags: string, title: string, description: string) => {
    try {
      await api.setMetadata(id, rating, tags, title, description);
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, rating, tags, title, description } : p))
      );
      if (selectedPhoto?.id === id) {
        setSelectedPhoto(prev => prev ? { ...prev, rating, tags, title, description } : null);
      }
    } catch (err) {
      console.error("Failed to update metadata:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  const batchUpdateMetadata = useCallback(async (
    ids: string[],
    rating?: number,
    tags?: string,
    title?: string,
    description?: string,
    addTags?: string[],
    removeTags?: string[]
  ) => {
    try {
      await api.batchSetMetadata(ids, rating, tags, title, description, addTags, removeTags);
      const applyDeltaToTagString = (currentTagsStr: string) => {
        let tagList = currentTagsStr
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (removeTags) {
          tagList = tagList.filter(
            (t) => !removeTags.some((r) => r.trim().toLowerCase() === t.toLowerCase())
          );
        }
        if (addTags) {
          for (const t of addTags) {
            const trimmed = t.trim();
            if (trimmed && !tagList.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
              tagList.push(trimmed);
            }
          }
        }
        return tagList.join(",");
      };

      setPhotos((prev) =>
        prev.map((p) => {
          if (ids.includes(p.id)) {
            const photoTags = (addTags !== undefined || removeTags !== undefined)
              ? applyDeltaToTagString(p.tags || "")
              : (tags !== undefined ? tags : p.tags);

            return {
              ...p,
              rating: rating !== undefined ? rating : p.rating,
              tags: photoTags,
              title: title !== undefined ? title : p.title,
              description: description !== undefined ? description : p.description,
            };
          }
          return p;
        })
      );
      if (selectedPhoto && ids.includes(selectedPhoto.id)) {
        setSelectedPhoto((prev) => {
          if (!prev) return null;
          const photoTags = (addTags !== undefined || removeTags !== undefined)
            ? applyDeltaToTagString(prev.tags || "")
            : (tags !== undefined ? tags : prev.tags);

          return {
            ...prev,
            rating: rating !== undefined ? rating : prev.rating,
            tags: photoTags,
            title: title !== undefined ? title : prev.title,
            description: description !== undefined ? description : prev.description,
          };
        });
      }
    } catch (err) {
      console.error("Failed to batch update metadata:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  const batchUpdateCaptureTime = useCallback(async (updates: { id: string; captureTime: string }[]) => {
    try {
      await api.batchSetCaptureDate(updates);
      const updateMap = new Map(updates.map(u => [u.id, u.captureTime]));
      setPhotos((prev) =>
        prev.map((p) => {
          const newDate = updateMap.get(p.id);
          if (newDate) {
            return { ...p, capture_time: newDate };
          }
          return p;
        })
      );
      if (selectedPhoto) {
        const newDate = updateMap.get(selectedPhoto.id);
        if (newDate) {
          setSelectedPhoto(prev => prev ? { ...prev, capture_time: newDate } : null);
        }
      }
    } catch (err) {
      console.error("Failed to batch update capture time:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  const updateCrop = useCallback(async (
    id: string, 
    top: number | null, 
    left: number | null, 
    bottom: number | null, 
    right: number | null, 
    angle: number | null
  ) => {
    try {
      clearPreviewCache(id);
      await api.setCrop(id, top, left, bottom, right, angle);
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { 
          ...p, 
          crop_top: top, 
          crop_left: left, 
          crop_bottom: bottom, 
          crop_right: right, 
          crop_angle: angle 
        } : p))
      );
      if (selectedPhoto?.id === id) {
        setSelectedPhoto(prev => prev ? { 
          ...prev, 
          crop_top: top, 
          crop_left: left, 
          crop_bottom: bottom, 
          crop_right: right, 
          crop_angle: angle 
        } : null);
      }
    } catch (err) {
      console.error("Failed to update crop:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  const updatePortraitBlur = useCallback(async (id: string, val: number) => {
    try {
      await api.setPortraitBlur(id, val);
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, portrait_blur: val } : p))
      );
      if (selectedPhoto?.id === id) {
        setSelectedPhoto(prev => prev ? { ...prev, portrait_blur: val } : null);
      }
    } catch (err) {
      console.error("Failed to update portrait blur:", err);
    }
  }, [api, setPhotos, selectedPhoto, setSelectedPhoto]);

  return {
    updateExposure,
    updatePortraitBlur,
    updateMetadata,
    batchUpdateMetadata,
    batchUpdateCaptureTime,
    updateCrop
  };
}
