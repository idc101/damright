import { Photo } from "../types";
import { ApiService } from "../services/api";

const previewCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string>>();

export function getPreviewCacheKey(photo: Photo, uncropped: boolean = false): string {
  const cropKey = `${photo.crop_top ?? ""}_${photo.crop_left ?? ""}_${photo.crop_bottom ?? ""}_${photo.crop_right ?? ""}_${photo.crop_angle ?? ""}_${photo.portrait_blur ?? ""}_${photo.orientation ?? ""}`;
  return `${photo.id}:${uncropped ? "uncropped" : "cropped"}:${cropKey}:${photo.exposure ?? 0}`;
}

export function getCachedPreviewUrl(photo: Photo, uncropped: boolean = false): string | null {
  const key = getPreviewCacheKey(photo, uncropped);
  return previewCache.get(key) || null;
}

export function setCachedPreviewUrl(photo: Photo, url: string, uncropped: boolean = false): void {
  const key = getPreviewCacheKey(photo, uncropped);
  previewCache.set(key, url);
}

export function clearPreviewCache(photoId?: string): void {
  if (photoId) {
    for (const key of previewCache.keys()) {
      if (key.startsWith(`${photoId}:`)) {
        previewCache.delete(key);
      }
    }
  } else {
    previewCache.clear();
  }
}

export function preloadBrowserImage(url: string): void {
  if (typeof Image === "undefined" || typeof window === "undefined") {
    return;
  }
  if (typeof navigator !== "undefined" && navigator.userAgent?.includes("jsdom")) {
    return;
  }
  const img = new Image();
  img.src = url;
}

export async function loadAndCachePreview(
  api: ApiService,
  photo: Photo,
  uncropped: boolean = false
): Promise<string> {
  const key = getPreviewCacheKey(photo, uncropped);
  const cached = previewCache.get(key);
  if (cached) {
    return cached;
  }

  const existingRequest = inFlightRequests.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const url = await api.getPreviewUrl(photo, uncropped);
      if (url) {
        previewCache.set(key, url);
        preloadBrowserImage(url);
      }
      return url;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, request);
  return request;
}

export function prefetchAdjacentPreviews(
  api: ApiService,
  photos: Photo[],
  currentIndex: number,
  range: number = 3
): void {
  if (currentIndex < 0 || currentIndex >= photos.length) return;

  for (let offset = 1; offset <= range; offset++) {
    const nextPhoto = photos[currentIndex + offset];
    if (nextPhoto && !nextPhoto.mime_type.startsWith("video/")) {
      loadAndCachePreview(api, nextPhoto, false);
    }

    const prevPhoto = photos[currentIndex - offset];
    if (prevPhoto && !prevPhoto.mime_type.startsWith("video/")) {
      loadAndCachePreview(api, prevPhoto, false);
    }
  }
}
