import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getPhotoLastSeenMap,
  recordPhotoSeen,
  clearPhotoHistory,
  shufflePhotosWithRecency,
  isInSleepWindow,
  LOCAL_STORAGE_LAST_SEEN_KEY,
} from "../utils/slideshowHistory";
import { Photo } from "../types";

const createMockPhoto = (id: string): Photo => ({
  id,
  path: `/photos/${id}.jpg`,
  thumb_path: `/thumbs/${id}.jpg`,
  exposure: 0,
  rating: 3,
  rejected: false,
  tags: "",
  orientation: 1,
  mime_type: "image/jpeg",
  capture_time: "2024-01-01 12:00:00",
});

describe("slideshowHistory", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("recordPhotoSeen & getPhotoLastSeenMap", () => {
    it("records photo seen with current timestamp in seconds", () => {
      const nowMs = 1700000000000;
      vi.spyOn(Date, "now").mockReturnValue(nowMs);

      recordPhotoSeen("photo-1");
      const map = getPhotoLastSeenMap();

      expect(map["photo-1"]).toBe(1700000000);
    });

    it("clears photo history", () => {
      recordPhotoSeen("photo-1");
      expect(getPhotoLastSeenMap()["photo-1"]).toBeDefined();

      clearPhotoHistory();
      expect(getPhotoLastSeenMap()).toEqual({});
    });
  });

  describe("shufflePhotosWithRecency", () => {
    it("places unseen photos before recently seen photos", () => {
      const nowSec = 1700000000;
      vi.spyOn(Date, "now").mockReturnValue(nowSec * 1000);

      // Photo 1 & 2 seen 1 hour ago (< 1 day)
      // Photo 3 seen 10 days ago (7 to 30 days)
      // Photo 4 & 5 never seen
      const lastSeenMap: Record<string, number> = {
        "1": nowSec - 3600,
        "2": nowSec - 7200,
        "3": nowSec - 10 * 86400,
      };
      localStorage.setItem(LOCAL_STORAGE_LAST_SEEN_KEY, JSON.stringify(lastSeenMap));

      const photos: Photo[] = [
        createMockPhoto("1"),
        createMockPhoto("2"),
        createMockPhoto("3"),
        createMockPhoto("4"),
        createMockPhoto("5"),
      ];

      const shuffled = shufflePhotosWithRecency(photos);
      const shuffledIds = shuffled.map((p) => p.id);

      // Unseen photos (4, 5) must be in the first two slots
      expect(shuffledIds.slice(0, 2).sort()).toEqual(["4", "5"]);

      // Medium seen photo (3) must be in the 3rd slot
      expect(shuffledIds[2]).toBe("3");

      // Recently seen photos (1, 2) must be at the end (slots 3, 4)
      expect(shuffledIds.slice(3).sort()).toEqual(["1", "2"]);
    });

    it("handles an array with a single photo or empty array gracefully", () => {
      expect(shufflePhotosWithRecency([])).toEqual([]);
      const single = [createMockPhoto("1")];
      expect(shufflePhotosWithRecency(single)).toEqual(single);
    });
  });

  describe("isInSleepWindow", () => {
    it("correctly evaluates overnight sleep window (e.g. 21:00 to 06:30)", () => {
      const start = "21:00";
      const end = "06:30";

      // 20:59 -> awake
      const d1 = new Date(2024, 0, 1, 20, 59);
      expect(isInSleepWindow(start, end, d1)).toBe(false);

      // 21:00 -> sleeping
      const d2 = new Date(2024, 0, 1, 21, 0);
      expect(isInSleepWindow(start, end, d2)).toBe(true);

      // 23:30 -> sleeping
      const d3 = new Date(2024, 0, 1, 23, 30);
      expect(isInSleepWindow(start, end, d3)).toBe(true);

      // 00:00 -> sleeping
      const d4 = new Date(2024, 0, 1, 0, 0);
      expect(isInSleepWindow(start, end, d4)).toBe(true);

      // 06:29 -> sleeping
      const d5 = new Date(2024, 0, 1, 6, 29);
      expect(isInSleepWindow(start, end, d5)).toBe(true);

      // 06:30 -> awake
      const d6 = new Date(2024, 0, 1, 6, 30);
      expect(isInSleepWindow(start, end, d6)).toBe(false);

      // 12:00 -> awake
      const d7 = new Date(2024, 0, 1, 12, 0);
      expect(isInSleepWindow(start, end, d7)).toBe(false);
    });

    it("correctly evaluates daytime sleep window (e.g. 13:00 to 15:00)", () => {
      const start = "13:00";
      const end = "15:00";

      expect(isInSleepWindow(start, end, new Date(2024, 0, 1, 12, 59))).toBe(false);
      expect(isInSleepWindow(start, end, new Date(2024, 0, 1, 13, 0))).toBe(true);
      expect(isInSleepWindow(start, end, new Date(2024, 0, 1, 14, 30))).toBe(true);
      expect(isInSleepWindow(start, end, new Date(2024, 0, 1, 15, 0))).toBe(false);
    });

    it("returns false for invalid or identical times", () => {
      expect(isInSleepWindow("21:00", "21:00")).toBe(false);
      expect(isInSleepWindow(undefined, "06:30")).toBe(false);
      expect(isInSleepWindow("invalid", "06:30")).toBe(false);
    });
  });
});
