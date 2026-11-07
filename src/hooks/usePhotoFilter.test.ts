import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePhotoFilter } from "./usePhotoFilter";
import { Photo, Source } from "../types";

const mockSources: Source[] = [
  { id: "src1", path: "/library/nature", name: "Nature" },
];

const mockPhotos: Photo[] = [
  {
    id: "p1",
    path: "/library/nature/20260509T123045-abc.jpg",
    thumb_path: "t1",
    exposure: 0,
    rating: 3,
    rejected: false,
    tags: "landscape, green",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-05-09 12:30:45",
    event: "Hike",
    faces: [{ name: "Alice", area_x: 0, area_y: 0, area_w: 0.1, area_h: 0.1 }],
    perceptual_hash: "hash123",
  },
  {
    id: "p2",
    path: "/library/nature/20260509T123500-def.jpg",
    thumb_path: "t2",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "flower",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-05-09 12:35:00",
    event: "Garden Visit",
    perceptual_hash: "hash123", // Duplicate hash with p1
  },
  {
    id: "p3",
    path: "/library/external/other.jpg", // Outside mockSources
    thumb_path: "t3",
    exposure: 0,
    rating: 5,
    rejected: false,
    tags: "city",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-05-09 12:00:00", // Earlier capture time
    faces: [{ name: "Bob", area_x: 0, area_y: 0, area_w: 0.1, area_h: 0.1 }],
  },
  {
    id: "p4",
    path: "/library/nature/badname.jpg", // Misfiled naming convention & no event
    thumb_path: "t4",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-05-09 12:40:00",
  }
];

describe("usePhotoFilter", () => {
  it("should return search results directly if search query is active", () => {
    const { result } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "is:edited", "folders", null, null, null)
    );
    // When search query is active, the hook returns photos as-is (database handles search)
    expect(result.current).toHaveLength(4);
  });

  it("should filter by path under folders tab", () => {
    const { result: folderFiltered } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "folders", "/library/nature", null, null)
    );
    // Only p1, p2, p4 are under /library/nature
    expect(folderFiltered.current).toHaveLength(3);
    expect(folderFiltered.current.map(p => p.id)).toContain("p1");
    expect(folderFiltered.current.map(p => p.id)).toContain("p2");
    expect(folderFiltered.current.map(p => p.id)).toContain("p4");
  });

  it("should filter to sources only under folders tab if no path is selected", () => {
    const { result } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "folders", null, null, null)
    );
    // p3 is under /library/external (not in mockSources)
    expect(result.current).toHaveLength(3);
    expect(result.current.map(p => p.id)).not.toContain("p3");
  });

  it("should filter by tag under tags tab", () => {
    const { result } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "tags", null, "green", null)
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("p1");
  });

  it("should filter by person under people tab", () => {
    const { result } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "people", null, null, "Bob")
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("p3");
  });

  it("should filter photos in quick collection under quick tab", () => {
    const photosWithQuick: Photo[] = [
      ...mockPhotos,
      {
        id: "p_quick",
        path: "/library/nature/quick.jpg",
        thumb_path: "tq",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        capture_time: "2026-05-09 13:00:00",
        in_quick_collection: true,
      }
    ];

    const { result } = renderHook(() => 
      usePhotoFilter(photosWithQuick, mockSources, "", "quick", null, null, null)
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("p_quick");
  });

  it("should filter and sort duplicates under duplicates tab", () => {
    const { result } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "duplicates", null, null, null)
    );
    // p1 and p2 have same hash: "hash123"
    expect(result.current).toHaveLength(2);
    expect(result.current.map(p => p.id)).toContain("p1");
    expect(result.current.map(p => p.id)).toContain("p2");
  });

  it("should filter validation photos under validation tab", () => {
    const valMockPhotos: Photo[] = [
      {
        id: "p_ok",
        path: "/library/nature/20260509T123045-abc.jpg",
        thumb_path: "t1",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        capture_time: "2026-05-09 12:30:45",
        event: "Hike",
        validation_is_valid: true,
        validation_issues: "",
      },
      {
        id: "p_missing_event",
        path: "/library/nature/20260509T123045-abc.jpg",
        thumb_path: "t1",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        capture_time: "2026-05-09 12:30:45",
        event: "", // Missing event!
        validation_is_valid: false,
        validation_issues: "missing_event",
      },
      {
        id: "p_missing_capture_time",
        path: "/library/nature/20260509T123045-abc.jpg",
        thumb_path: "t1",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        capture_time: "", // Missing capture time!
        event: "Hike",
        validation_is_valid: false,
        validation_issues: "missing_capture_time",
      },
      {
        id: "p_bad_name",
        path: "/library/nature/badname.jpg",
        thumb_path: "t1",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        capture_time: "2026-05-09 12:30:45",
        event: "Hike",
        validation_is_valid: false,
        validation_issues: "bad_name",
      },
      {
        id: "p_bad_folder",
        path: "/library/nature/2026-06-01/20260509T123045-abc.jpg",
        thumb_path: "t1",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        capture_time: "2026-05-09 12:30:45",
        event: "Hike",
        validation_is_valid: false,
        validation_issues: "bad_folder",
      }
    ];

    const { result: allResult } = renderHook(() => 
      usePhotoFilter(valMockPhotos, mockSources, "", "validation", null, null, null, "all")
    );
    expect(allResult.current).toHaveLength(4);
    expect(allResult.current.map(p => p.id)).toContain("p_missing_event");
    expect(allResult.current.map(p => p.id)).toContain("p_missing_capture_time");
    expect(allResult.current.map(p => p.id)).toContain("p_bad_name");
    expect(allResult.current.map(p => p.id)).toContain("p_bad_folder");

    const { result: missingEventResult } = renderHook(() => 
      usePhotoFilter(valMockPhotos, mockSources, "", "validation", null, null, null, "missing_event")
    );
    expect(missingEventResult.current).toHaveLength(1);
    expect(missingEventResult.current[0].id).toBe("p_missing_event");

    const { result: missingCaptureTimeResult } = renderHook(() => 
      usePhotoFilter(valMockPhotos, mockSources, "", "validation", null, null, null, "missing_capture_time")
    );
    expect(missingCaptureTimeResult.current).toHaveLength(1);
    expect(missingCaptureTimeResult.current[0].id).toBe("p_missing_capture_time");

    const { result: badNameResult } = renderHook(() => 
      usePhotoFilter(valMockPhotos, mockSources, "", "validation", null, null, null, "bad_name")
    );
    expect(badNameResult.current).toHaveLength(1);
    expect(badNameResult.current[0].id).toBe("p_bad_name");

    const { result: badFolderResult } = renderHook(() => 
      usePhotoFilter(valMockPhotos, mockSources, "", "validation", null, null, null, "bad_folder")
    );
    expect(badFolderResult.current).toHaveLength(1);
    expect(badFolderResult.current[0].id).toBe("p_bad_folder");
  });

  it("should sort photos by capture time ascending", () => {
    const { result } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "folders", "/library", null, null)
    );
    // Should be sorted by capture_time ascending: p3 (12:00:00), p1 (12:30:45), p2 (12:35:00), p4 (12:40:00)
    expect(result.current[0].id).toBe("p3");
    expect(result.current[1].id).toBe("p1");
    expect(result.current[2].id).toBe("p2");
    expect(result.current[3].id).toBe("p4");
  });

  it("should restrict search query results to active selection when searchScope is local", () => {
    const { result } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "is:edited", "folders", "/library/nature", null, null, "all", "local")
    );
    // Even though search query is active, searchScope is "local", so it filters by selectedPath (/library/nature)
    // Only p1, p2, p4 are under nature.
    expect(result.current).toHaveLength(3);
    expect(result.current.map(p => p.id)).not.toContain("p3");
  });

  it("should filter by media type (images vs videos vs markdown)", () => {
    const photosWithVideoAndPost: Photo[] = [
      ...mockPhotos,
      {
        id: "p5",
        path: "/library/nature/video.mp4",
        thumb_path: "t5",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "video/mp4",
        capture_time: "2026-05-09 13:00:00",
      },
      {
        id: "p6",
        path: "/library/nature/journal.md",
        thumb_path: "t6",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "text/markdown",
        capture_time: "2026-05-09 14:00:00",
      }
    ];

    const { result: onlyImages } = renderHook(() => 
      usePhotoFilter(photosWithVideoAndPost, mockSources, "", "folders", "/library/nature", null, null, "all", "global", "images")
    );
    expect(onlyImages.current.map(p => p.id)).not.toContain("p5");
    expect(onlyImages.current.map(p => p.id)).not.toContain("p6");

    const { result: onlyVideos } = renderHook(() => 
      usePhotoFilter(photosWithVideoAndPost, mockSources, "", "folders", "/library/nature", null, null, "all", "global", "videos")
    );
    expect(onlyVideos.current).toHaveLength(1);
    expect(onlyVideos.current[0].id).toBe("p5");

    const { result: onlyPosts } = renderHook(() => 
      usePhotoFilter(photosWithVideoAndPost, mockSources, "", "folders", "/library/nature", null, null, "all", "global", "markdown")
    );
    expect(onlyPosts.current).toHaveLength(1);
    expect(onlyPosts.current[0].id).toBe("p6");
  });

  it("should filter by rejected status", () => {
    const photosWithRejected: Photo[] = [
      ...mockPhotos,
      {
        id: "p5_rejected",
        path: "/library/nature/rejected.jpg",
        thumb_path: "t5",
        exposure: 0,
        rating: 0,
        rejected: true, // Rejected!
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        capture_time: "2026-05-09 13:00:00",
      }
    ];

    // Default or "hide" should hide rejected
    const { result: hideRejected } = renderHook(() => 
      usePhotoFilter(photosWithRejected, mockSources, "", "folders", "/library/nature", null, null, "all", "global", "all", "hide")
    );
    expect(hideRejected.current.map(p => p.id)).not.toContain("p5_rejected");

    // "show_all" should show rejected
    const { result: showAll } = renderHook(() => 
      usePhotoFilter(photosWithRejected, mockSources, "", "folders", "/library/nature", null, null, "all", "global", "all", "show_all")
    );
    expect(showAll.current.map(p => p.id)).toContain("p5_rejected");

    // "only_rejected" should show only rejected
    const { result: onlyRejected } = renderHook(() => 
      usePhotoFilter(photosWithRejected, mockSources, "", "folders", "/library/nature", null, null, "all", "global", "all", "only_rejected")
    );
    expect(onlyRejected.current).toHaveLength(1);
    expect(onlyRejected.current[0].id).toBe("p5_rejected");
  });

  it("should match tags case-insensitively", () => {
    const { result: upperTag } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "tags", null, "GREEN", null)
    );
    expect(upperTag.current).toHaveLength(1);
    expect(upperTag.current[0].id).toBe("p1");

    const { result: mixedTag } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "tags", null, "LaNdScApE", null)
    );
    expect(mixedTag.current).toHaveLength(1);
    expect(mixedTag.current[0].id).toBe("p1");
  });

  it("should match people case-insensitively and fall back to tags", () => {
    // Matches face case-insensitively
    const { result: upperPerson } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "people", null, null, "ALICE")
    );
    expect(upperPerson.current).toHaveLength(1);
    expect(upperPerson.current[0].id).toBe("p1");

    // Falls back to tags if no face matches
    const { result: tagFallback } = renderHook(() => 
      usePhotoFilter(mockPhotos, mockSources, "", "people", null, null, "flower")
    );
    expect(tagFallback.current).toHaveLength(1);
    expect(tagFallback.current[0].id).toBe("p2");
  });

  it("should match paths normalized across Windows backslashes and POSIX slashes", () => {
    const windowsPhotos: Photo[] = [
      {
        ...mockPhotos[0],
        id: "p_win",
        path: "C:\\library\\nature\\sub\\photo.jpg",
      }
    ];
    const windowsSources: Source[] = [
      { id: "src_win", path: "C:\\library\\nature", name: "Nature Win" }
    ];

    // Filter with POSIX selectedPath on Windows paths
    const { result: posixQuery } = renderHook(() => 
      usePhotoFilter(windowsPhotos, windowsSources, "", "folders", "C:/library/nature/sub", null, null)
    );
    expect(posixQuery.current).toHaveLength(1);
    expect(posixQuery.current[0].id).toBe("p_win");

    // Filter with Windows backslash selectedPath
    const { result: winQuery } = renderHook(() => 
      usePhotoFilter(windowsPhotos, windowsSources, "", "folders", "C:\\library\\nature", null, null)
    );
    expect(winQuery.current).toHaveLength(1);
    expect(winQuery.current[0].id).toBe("p_win");
  });
});
