import { useState, useCallback, useRef } from "react";
import { Photo, TagWithCount, PersonWithCount } from "../types";
import { useApi } from "../services/ApiProvider";
import { usePhotoMetadata } from "./usePhotoMetadata";
import { usePhotoOperations } from "./usePhotoOperations";

export function usePhotos() {
  const api = useApi();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [people, setPeople] = useState<PersonWithCount[]>([]);
  const [searchQuery, setSearchQueryState] = useState(() => {
    return localStorage.getItem("searchQuery") || "";
  });
  const searchQueryRef = useRef(localStorage.getItem("searchQuery") || "");
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());

  const setSearchQuery = useCallback((q: string) => {
    searchQueryRef.current = q;
    setSearchQueryState(q);
    localStorage.setItem("searchQuery", q);
  }, []);

  const fetchPhotos = useCallback(async (query?: string) => {
    const q = query !== undefined ? query : searchQueryRef.current;
    try {
      const loadedPhotos = await api.getAllPhotos(q);
      setPhotos(loadedPhotos);
      if (query !== undefined) {
        searchQueryRef.current = query;
        setSearchQueryState(query);
        localStorage.setItem("searchQuery", query);
      }
    } catch (err) {
      console.error("Failed to fetch photos:", err);
    }
  }, [api]);

  const fetchAllTags = useCallback(async () => {
    try {
      const loadedTags = await api.getAllTags();
      setTags(loadedTags);
      return loadedTags;
    } catch (err) {
      console.error("Failed to fetch tags:", err);
      return [];
    }
  }, [api]);

  const fetchAllPeople = useCallback(async () => {
    try {
      const loadedPeople = await api.getAllPeople();
      setPeople(loadedPeople);
      return loadedPeople;
    } catch (err) {
      console.error("Failed to fetch people:", err);
      return [];
    }
  }, [api]);

  const {
    updateExposure,
    updatePortraitBlur,
    updateMetadata,
    batchUpdateMetadata,
    batchUpdateCaptureTime,
    updateCrop
  } = usePhotoMetadata(setPhotos, selectedPhoto, setSelectedPhoto);

  const {
    toggleRejected,
    setEvent,
    batchSetEvent,
    autoRename,
    movePhotos
  } = usePhotoOperations(photos, setPhotos, selectedPhoto, setSelectedPhoto, fetchPhotos);

  return {
    photos,
    setPhotos,
    searchQuery,
    setSearchQuery,
    selectedPhoto,
    setSelectedPhoto,
    selectedPhotoIds,
    setSelectedPhotoIds,
    fetchPhotos,
    updateExposure,
    updatePortraitBlur,
    updateMetadata,
    batchUpdateMetadata,
    batchUpdateCaptureTime,
    updateCrop,
    toggleRejected,
    setEvent,
    batchSetEvent,
    autoRename,
    movePhotos,
    tags,
    people,
    fetchAllTags,
    fetchAllPeople
  };
}
