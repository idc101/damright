import { describe, it, expect } from "vitest";
import { filenameToDescription, formatExifDate } from "../utils/slideshow";
import { generateKenBurnsState } from "../utils/kenBurns";
import { Face } from "../types";

describe("Slideshow Utils", () => {
  describe("filenameToDescription", () => {
    const picturesBase = "/base/path";

    it("should extract description correctly", () => {
      expect(
        filenameToDescription(
          "/base/path/2025-02 Skiing - La Rosiere/IMG_9969.jpg",
          picturesBase
        )
      ).toBe("Skiing - La Rosiere");

      expect(
        filenameToDescription(
          "/base/path/2025/2025-02 Skiing - La Rosiere/IMG_9969.jpg",
          picturesBase
        )
      ).toBe("Skiing - La Rosiere");

      expect(
        filenameToDescription(
          "/base/path/2024-12 December-20241224T100546-019.jpg",
          picturesBase
        )
      ).toBe("December");

      expect(
        filenameToDescription(
          "/base/path/2024-12-25 Christmas-20241224T100546-019.jpg",
          picturesBase
        )
      ).toBe("Christmas");
    });

    it("should strip hash and timestamp from standardized filenames (YYYYMMDDTHHMMSS-hash)", () => {
      expect(
        filenameToDescription(
          "/base/path/Album1/20241225T100546-05c.jpg",
          picturesBase
        )
      ).toBe("Album1");

      expect(
        filenameToDescription(
          "/base/path/2024/12-25/Album1/20241225T100546-05c.jpg",
          picturesBase
        )
      ).toBe("Album1");

      expect(
        filenameToDescription(
          "/base/path/2024-12-25 Christmas/20241225T100546-05c.jpg",
          picturesBase
        )
      ).toBe("Christmas");

      expect(
        filenameToDescription(
          "/base/path/20241225T100546-05c.jpg",
          picturesBase
        )
      ).toBeNull();
    });
  });

  describe("formatExifDate", () => {
    it("should format valid EXIF date strings", () => {
      expect(formatExifDate("2024:10:28 10:08:33")).toBe("Mon 28 Oct 2024");
      expect(formatExifDate("2025-12-25 15:30:00")).toBe("Thu 25 Dec 2025");
    });

    it("should fallback gracefully for invalid or raw date formats", () => {
      expect(formatExifDate("Just a string")).toBe("Just a string");
      expect(formatExifDate(null)).toBeNull();
    });
  });

  describe("generateKenBurnsState", () => {
    const vw = 1920;
    const vh = 1080;
    const baseWidth = 2000;
    const baseHeight = 1125; // landscape

    it("should generate random zoom and pan within constraints without faces", () => {
      const state = generateKenBurnsState(baseWidth, baseHeight, vw, vh);
      expect(state.S).toBeGreaterThanOrEqual(1.0);
      expect(state.tx).toBeLessThanOrEqual(0);
      expect(state.ty).toBeLessThanOrEqual(0);
    });

    it("should pan targeting valid face bounds", () => {
      const faces: Face[] = [
        {
          name: "Alice",
          area_x: 0.3,
          area_y: 0.4,
          area_w: 0.1,
          area_h: 0.1,
        },
      ];
      const state = generateKenBurnsState(baseWidth, baseHeight, vw, vh, faces);
      expect(state.S).toBeGreaterThanOrEqual(1.0);
      // Translation should be bounded appropriately
      expect(state.tx).toBeLessThanOrEqual(0);
      expect(state.ty).toBeLessThanOrEqual(0);
    });
  });
});
