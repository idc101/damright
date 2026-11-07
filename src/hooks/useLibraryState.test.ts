import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLibraryState } from "./useLibraryState";
import { Photo, Source } from "../types";

const mockPhotos: Photo[] = [
  {
    id: "p1",
    path: "/photos/nature/2026/01-01/photo1.jpg",
    thumb_path: "t1",
    exposure: 0,
    rating: 3,
    rejected: false,
    tags: "forest, trees",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-01-01 10:00:00",
    faces: [{ name: "Bob", area_x: 0, area_y: 0, area_w: 0.1, area_h: 0.1 }],
  },
  {
    id: "p2",
    path: "/photos/nature/2026/01-02/photo2.jpg",
    thumb_path: "t2",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "mountain",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-01-02 11:00:00",
  },
  {
    id: "p3",
    path: "/photos/nature/root_photo.jpg",
    thumb_path: "t3",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "nature",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-01-03 12:00:00",
  },
];

const mockSources: Source[] = [
  { id: "s1", path: "/photos/nature", name: "Nature Source" },
];

vi.mock("./usePhotos", () => ({
  usePhotos: () => ({
    photos: mockPhotos,
    searchQuery: "",
    fetchPhotos: vi.fn(),
    tags: [{ name: "forest", count: 1 }],
    people: [{ name: "Bob", count: 1 }],
    fetchAllTags: vi.fn(),
    fetchAllPeople: vi.fn(),
    updateExposure: vi.fn(),
    updatePortraitBlur: vi.fn(),
    updateMetadata: vi.fn(),
    batchUpdateMetadata: vi.fn(),
    batchUpdateCaptureTime: vi.fn(),
    updateCrop: vi.fn(),
    toggleRejected: vi.fn(),
    setEvent: vi.fn(),
    batchSetEvent: vi.fn(),
    autoRename: vi.fn(),
    movePhotos: vi.fn(),
  }),
}));

vi.mock("./useSources", () => ({
  useSources: () => ({
    sources: mockSources,
    trees: {},
    fetchSources: vi.fn(),
    fetchTree: vi.fn(),
    addSource: vi.fn(),
    moveFolder: vi.fn(),
  }),
}));

describe("useLibraryState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes with defaults or localStorage values", () => {
    localStorage.setItem("selectedSidebarTab", "tags");
    localStorage.setItem("selectedTag", "forest");

    const { result } = renderHook(() => useLibraryState());

    expect(result.current.activeTab).toBe("tags");
    expect(result.current.selectedTag).toBe("forest");
    expect(result.current.headerTitle).toBe("forest");
    expect(result.current.headerBackButton?.label).toBe("Tags");
  });

  it("handles folder selection and drill-down currentLevelItems", () => {
    const { result } = renderHook(() => useLibraryState());

    act(() => {
      result.current.setActiveTab("folders");
      result.current.selectFolder("/photos/nature");
    });

    expect(result.current.selectedPath).toBe("/photos/nature");
    expect(result.current.headerTitle).toBe("nature");
    expect(result.current.headerBackButton?.label).toBe("Folders");

    // Subfolders under /photos/nature: 2026
    expect(result.current.currentLevelItems.subfolders).toHaveLength(1);
    expect(result.current.currentLevelItems.subfolders[0].name).toBe("2026");

    // Direct photos under /photos/nature: root_photo.jpg
    expect(result.current.currentLevelItems.photos).toHaveLength(1);
    expect(result.current.currentLevelItems.photos[0].id).toBe("p3");
  });

  it("navigates back correctly for nested folders and source roots", () => {
    const { result } = renderHook(() => useLibraryState());

    act(() => {
      result.current.setActiveTab("folders");
      result.current.selectFolder("/photos/nature/2026/01-01");
    });

    // Back from nested folder -> parent folder (/photos/nature/2026)
    act(() => {
      result.current.navigateBack();
    });
    expect(result.current.selectedPath).toBe("/photos/nature/2026");

    // Back from /photos/nature/2026 -> source root (/photos/nature)
    act(() => {
      result.current.navigateBack();
    });
    expect(result.current.selectedPath).toBe("/photos/nature");

    // Back from source root -> null
    act(() => {
      result.current.navigateBack();
    });
    expect(result.current.selectedPath).toBeNull();
  });

  it("handles tag and people selection and clearance via navigateBack", () => {
    const { result } = renderHook(() => useLibraryState());

    act(() => {
      result.current.setActiveTab("tags");
      result.current.selectTag("forest");
    });
    expect(result.current.selectedTag).toBe("forest");

    act(() => {
      result.current.navigateBack();
    });
    expect(result.current.selectedTag).toBeNull();

    act(() => {
      result.current.setActiveTab("people");
      result.current.selectPerson("Bob");
    });
    expect(result.current.selectedPerson).toBe("Bob");

    act(() => {
      result.current.navigateBack();
    });
    expect(result.current.selectedPerson).toBeNull();
  });
});
