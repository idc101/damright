import { describe, it, expect } from "vitest";
import { parsePhotoDate, buildTimelineIndex, formatPhotoDateHeader } from "./timeline";
import { Photo } from "../types";

function createPhoto(id: string, capture_time: string | null, path = `/photos/${id}.jpg`): Photo {
  return {
    id,
    path,
    thumb_path: `/thumb/${id}.jpg`,
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
    faces: [],
    capture_time,
  };
}

describe("parsePhotoDate", () => {
  it("parses standard ISO date strings", () => {
    const p = createPhoto("1", "2024-08-15 14:30:00");
    const parsed = parsePhotoDate(p);
    expect(parsed).toEqual({
      year: 2024,
      month: 8,
      day: 15,
      dateStr: "2024-08-15",
    });
  });

  it("parses EXIF colon-separated date strings", () => {
    const p = createPhoto("2", "2023:12:25 08:00:00");
    const parsed = parsePhotoDate(p);
    expect(parsed).toEqual({
      year: 2023,
      month: 12,
      day: 25,
      dateStr: "2023-12-25",
    });
  });

  it("falls back to filename with date prefix if capture_time is missing", () => {
    const p = createPhoto("3", null, "/storage/20220510T120000-abc.jpg");
    const parsed = parsePhotoDate(p);
    expect(parsed).toEqual({
      year: 2022,
      month: 5,
      day: 10,
      dateStr: "2022-05-10",
    });
  });

  it("returns null for undated photos without date prefix", () => {
    const p = createPhoto("4", null, "/storage/unnamed_pic.jpg");
    const parsed = parsePhotoDate(p);
    expect(parsed).toBeNull();
  });
});

describe("formatPhotoDateHeader", () => {
  it("formats valid photo with month and year", () => {
    const p = createPhoto("1", "2026-06-07 12:00:00");
    expect(formatPhotoDateHeader(p)).toBe("June 2026");
  });

  it("formats photo with fallback year", () => {
    const p = createPhoto("2", "2025");
    expect(formatPhotoDateHeader(p)).toBe("2025");
  });

  it("returns Undated for photos without parseable date", () => {
    const p = createPhoto("3", null, "/storage/no_date.jpg");
    expect(formatPhotoDateHeader(p)).toBe("Undated");
  });

  it("returns Photos when photo is undefined", () => {
    expect(formatPhotoDateHeader(undefined)).toBe("Photos");
  });
});

describe("buildTimelineIndex", () => {
  it("groups photos into ascending years and months with correct counts and start indices", () => {
    // Chronologically sorted photos (undated -> 2023 -> 2024)
    const photos: Photo[] = [
      createPhoto("p1", null, "/storage/legacy.jpg"),
      createPhoto("p2", "2023-11-20 13:00:00"),
      createPhoto("p3", "2024-02-14 12:00:00"),
      createPhoto("p4", "2024-08-01 10:00:00"),
      createPhoto("p5", "2024-08-15 11:00:00"),
    ];

    const index = buildTimelineIndex(photos);

    expect(index.totalPhotos).toBe(5);
    expect(index.years).toHaveLength(3); // Undated, 2023, 2024

    // Undated Year (index 0)
    expect(index.years[0].year).toBeNull();
    expect(index.years[0].label).toBe("Undated");
    expect(index.years[0].count).toBe(1);
    expect(index.years[0].startIndex).toBe(0);

    // Year 2023 (index 1)
    expect(index.years[1].year).toBe(2023);
    expect(index.years[1].count).toBe(1);
    expect(index.years[1].startIndex).toBe(1);
    expect(index.years[1].months).toHaveLength(1);
    expect(index.years[1].months[0].label).toBe("November 2023");
    expect(index.years[1].months[0].startIndex).toBe(1);

    // Year 2024 (index 2)
    expect(index.years[2].year).toBe(2024);
    expect(index.years[2].count).toBe(3);
    expect(index.years[2].startIndex).toBe(2);
    expect(index.years[2].months).toHaveLength(2); // February, August
    expect(index.years[2].months[0].label).toBe("February 2024");
    expect(index.years[2].months[0].count).toBe(1);
    expect(index.years[2].months[0].startIndex).toBe(2);
    expect(index.years[2].months[1].label).toBe("August 2024");
    expect(index.years[2].months[1].count).toBe(2);
    expect(index.years[2].months[1].startIndex).toBe(3);

    // All months flat list
    expect(index.months).toHaveLength(3); // Nov 2023, Feb 2024, Aug 2024
  });
});

