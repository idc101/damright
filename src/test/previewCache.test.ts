import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  getPreviewCacheKey, 
  getCachedPreviewUrl, 
  setCachedPreviewUrl, 
  clearPreviewCache, 
  loadAndCachePreview, 
  prefetchAdjacentPreviews 
} from "../utils/previewCache";
import { Photo } from "../types";
import { ApiService } from "../services/api";

const mockPhoto1: Photo = {
  id: "p1",
  path: "/photos/p1.jpg",
  thumb_path: "/thumbs/p1.jpg",
  exposure: 0,
  rating: 0,
  rejected: false,
  tags: "",
  orientation: 1,
  mime_type: "image/jpeg",
  crop_top: 0.1,
  crop_left: 0.1,
  crop_bottom: 0.9,
  crop_right: 0.9,
  crop_angle: 0,
};

const mockPhoto2: Photo = {
  id: "p2",
  path: "/photos/p2.jpg",
  thumb_path: "/thumbs/p2.jpg",
  exposure: 0,
  rating: 0,
  rejected: false,
  tags: "",
  orientation: 1,
  mime_type: "image/jpeg",
};

const mockPhoto3: Photo = {
  id: "p3",
  path: "/photos/p3.mp4",
  thumb_path: "/thumbs/p3.jpg",
  exposure: 0,
  rating: 0,
  rejected: false,
  tags: "",
  orientation: 1,
  mime_type: "video/mp4",
};

describe("previewCache", () => {
  let mockApi: Partial<ApiService>;

  beforeEach(() => {
    clearPreviewCache();
    mockApi = {
      getPreviewUrl: vi.fn().mockImplementation(async (photo: Photo, uncropped?: boolean) => {
        return `/preview/${photo.id}${uncropped ? "_uncropped" : ""}.jpg`;
      }),
    };
  });

  it("generates distinct cache keys for cropped vs uncropped and different crop values", () => {
    const keyCropped = getPreviewCacheKey(mockPhoto1, false);
    const keyUncropped = getPreviewCacheKey(mockPhoto1, true);
    const keyPhoto2 = getPreviewCacheKey(mockPhoto2, false);

    expect(keyCropped).toContain("cropped");
    expect(keyUncropped).toContain("uncropped");
    expect(keyCropped).not.toEqual(keyUncropped);
    expect(keyCropped).not.toEqual(keyPhoto2);

    const keyBlur = getPreviewCacheKey({ ...mockPhoto1, portrait_blur: 0.8 }, false);
    expect(keyBlur).not.toEqual(keyCropped);

    const keyOrientation = getPreviewCacheKey({ ...mockPhoto1, orientation: 6 }, false);
    expect(keyOrientation).not.toEqual(keyCropped);
  });

  it("stores and retrieves preview URLs synchronously", () => {
    expect(getCachedPreviewUrl(mockPhoto1)).toBeNull();
    setCachedPreviewUrl(mockPhoto1, "/cached/p1.jpg");
    expect(getCachedPreviewUrl(mockPhoto1)).toBe("/cached/p1.jpg");
  });

  it("clears cache for specific photo or all photos", () => {
    setCachedPreviewUrl(mockPhoto1, "/cached/p1.jpg");
    setCachedPreviewUrl(mockPhoto2, "/cached/p2.jpg");

    clearPreviewCache("p1");
    expect(getCachedPreviewUrl(mockPhoto1)).toBeNull();
    expect(getCachedPreviewUrl(mockPhoto2)).toBe("/cached/p2.jpg");

    clearPreviewCache();
    expect(getCachedPreviewUrl(mockPhoto2)).toBeNull();
  });

  it("loads and caches preview, reusing in-flight requests", async () => {
    const p1Promise = loadAndCachePreview(mockApi as ApiService, mockPhoto1, false);
    const p2Promise = loadAndCachePreview(mockApi as ApiService, mockPhoto1, false);

    const [res1, res2] = await Promise.all([p1Promise, p2Promise]);
    expect(res1).toBe("/preview/p1.jpg");
    expect(res2).toBe("/preview/p1.jpg");
    expect(mockApi.getPreviewUrl).toHaveBeenCalledTimes(1);

    // Subsequent call returns immediately from cache
    const res3 = await loadAndCachePreview(mockApi as ApiService, mockPhoto1, false);
    expect(res3).toBe("/preview/p1.jpg");
    expect(mockApi.getPreviewUrl).toHaveBeenCalledTimes(1);
  });

  it("prefetches adjacent image previews while skipping videos", async () => {
    const photos = [mockPhoto1, mockPhoto2, mockPhoto3];
    prefetchAdjacentPreviews(mockApi as ApiService, photos, 0, 2);

    expect(mockApi.getPreviewUrl).toHaveBeenCalledWith(mockPhoto2, false);
    // Video should be skipped for preview generation
    expect(mockApi.getPreviewUrl).not.toHaveBeenCalledWith(mockPhoto3, false);
  });
});
