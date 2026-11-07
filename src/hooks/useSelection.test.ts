import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSelection } from "./useSelection";
import { Photo } from "../types";

const mockPhotos: Photo[] = [
  { id: "1", path: "p1", thumb_path: "t1", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg" },
  { id: "2", path: "p2", thumb_path: "t2", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg" },
  { id: "3", path: "p3", thumb_path: "t3", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg" },
  { id: "4", path: "p4", thumb_path: "t4", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg" },
];

describe("useSelection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should select a single item", () => {
    const { result } = renderHook(() => useSelection(mockPhotos));
    
    act(() => {
      result.current.handleSelect(mockPhotos[0]);
    });

    expect(result.current.selectedId).toBe("1");
    expect(result.current.selectedIds.has("1")).toBe(true);
    expect(result.current.selectedIds.size).toBe(1);
  });

  it("should handle multi-select with ctrl/meta", () => {
    const { result } = renderHook(() => useSelection(mockPhotos));
    
    act(() => {
      result.current.handleSelect(mockPhotos[0]);
    });

    act(() => {
      result.current.handleSelect(mockPhotos[2], { ctrl: true });
    });

    expect(result.current.selectedIds.has("1")).toBe(true);
    expect(result.current.selectedIds.has("3")).toBe(true);
    expect(result.current.selectedIds.size).toBe(2);
    expect(result.current.selectedId).toBe("3");
  });

  it("should handle range select with shift", () => {
    const { result } = renderHook(() => useSelection(mockPhotos));
    
    act(() => {
      result.current.handleSelect(mockPhotos[0]);
    });

    act(() => {
      result.current.handleSelect(mockPhotos[2], { shift: true });
    });

    expect(result.current.selectedIds.has("1")).toBe(true);
    expect(result.current.selectedIds.has("2")).toBe(true);
    expect(result.current.selectedIds.has("3")).toBe(true);
    expect(result.current.selectedIds.size).toBe(3);
  });

  it("should deselect an item with ctrl/meta", () => {
    const { result } = renderHook(() => useSelection(mockPhotos));
    
    act(() => {
      result.current.handleSelect(mockPhotos[0]);
    });
    act(() => {
      result.current.handleSelect(mockPhotos[1], { ctrl: true });
    });

    expect(result.current.selectedIds.size).toBe(2);

    act(() => {
      result.current.handleSelect(mockPhotos[1], { ctrl: true });
    });

    expect(result.current.selectedIds.size).toBe(1);
    expect(result.current.selectedIds.has("1")).toBe(true);
    expect(result.current.selectedId).toBe("1");
  });

  it("should initialize from localStorage and save changes to localStorage", () => {
    localStorage.setItem("selectedPhotoId", "2");

    const { result } = renderHook(() => useSelection(mockPhotos));

    expect(result.current.selectedId).toBe("2");
    expect(result.current.selectedIds.has("2")).toBe(true);
    expect(result.current.selectedItem).toEqual(mockPhotos[1]);

    act(() => {
      result.current.handleSelect(mockPhotos[3]);
    });

    expect(localStorage.getItem("selectedPhotoId")).toBe("4");

    act(() => {
      result.current.setSelectedItem(null);
    });

    expect(localStorage.getItem("selectedPhotoId")).toBeNull();
  });

  it("should select all items when selectAll is called", () => {
    const { result } = renderHook(() => useSelection(mockPhotos));

    act(() => {
      result.current.selectAll();
    });

    expect(result.current.selectedIds.size).toBe(4);
    expect(result.current.selectedIds.has("1")).toBe(true);
    expect(result.current.selectedIds.has("2")).toBe(true);
    expect(result.current.selectedIds.has("3")).toBe(true);
    expect(result.current.selectedIds.has("4")).toBe(true);
    expect(result.current.selectedId).toBe("1");
  });

  it("should preserve current selectedId when selectAll is called", () => {
    const { result } = renderHook(() => useSelection(mockPhotos));

    act(() => {
      result.current.handleSelect(mockPhotos[2]);
    });

    act(() => {
      result.current.selectAll();
    });

    expect(result.current.selectedIds.size).toBe(4);
    expect(result.current.selectedId).toBe("3");
  });

  it("should select the previous photo when selected item is removed", () => {
    let currentPhotos = [...mockPhotos];
    const { result, rerender } = renderHook(({ photos }) => useSelection(photos), {
      initialProps: { photos: currentPhotos },
    });

    act(() => {
      result.current.handleSelect(mockPhotos[2]); // Select photo "3" (index 2)
    });

    expect(result.current.selectedId).toBe("3");

    // Remove photo "3" from the list
    currentPhotos = [mockPhotos[0], mockPhotos[1], mockPhotos[3]];
    rerender({ photos: currentPhotos });

    // Should select previous photo ("2")
    expect(result.current.selectedId).toBe("2");
    expect(result.current.selectedIds.has("2")).toBe(true);
    expect(result.current.selectedItem).toEqual(mockPhotos[1]);
  });

  it("should select the first remaining photo when the first photo is removed", () => {
    let currentPhotos = [...mockPhotos];
    const { result, rerender } = renderHook(({ photos }) => useSelection(photos), {
      initialProps: { photos: currentPhotos },
    });

    act(() => {
      result.current.handleSelect(mockPhotos[0]); // Select photo "1" (index 0)
    });

    expect(result.current.selectedId).toBe("1");

    // Remove photo "1" from the list
    currentPhotos = [mockPhotos[1], mockPhotos[2], mockPhotos[3]];
    rerender({ photos: currentPhotos });

    // Should select new first photo ("2")
    expect(result.current.selectedId).toBe("2");
    expect(result.current.selectedIds.has("2")).toBe(true);
    expect(result.current.selectedItem).toEqual(mockPhotos[1]);
  });

  it("should select the photo before the batch when multiple selected photos are removed", () => {
    let currentPhotos = [...mockPhotos];
    const { result, rerender } = renderHook(({ photos }) => useSelection(photos), {
      initialProps: { photos: currentPhotos },
    });

    act(() => {
      result.current.handleSelect(mockPhotos[1]); // photo "2"
    });
    act(() => {
      result.current.handleSelect(mockPhotos[2], { shift: true }); // photos "2" and "3"
    });

    expect(result.current.selectedIds.size).toBe(2);

    // Remove photos "2" and "3"
    currentPhotos = [mockPhotos[0], mockPhotos[3]];
    rerender({ photos: currentPhotos });

    // Should select photo "1" (photo preceding "2")
    expect(result.current.selectedId).toBe("1");
    expect(result.current.selectedIds.has("1")).toBe(true);
    expect(result.current.selectedItem).toEqual(mockPhotos[0]);
  });

  it("should clear selection when all photos are removed", () => {
    let currentPhotos = [mockPhotos[0]];
    const { result, rerender } = renderHook(({ photos }) => useSelection(photos), {
      initialProps: { photos: currentPhotos },
    });

    act(() => {
      result.current.handleSelect(mockPhotos[0]);
    });

    expect(result.current.selectedId).toBe("1");

    // Remove all photos
    currentPhotos = [];
    rerender({ photos: currentPhotos });

    expect(result.current.selectedId).toBeNull();
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectedItem).toBeNull();
  });

  it("should keep selection unchanged if selected photo is still present after other items removed", () => {
    let currentPhotos = [...mockPhotos];
    const { result, rerender } = renderHook(({ photos }) => useSelection(photos), {
      initialProps: { photos: currentPhotos },
    });

    act(() => {
      result.current.handleSelect(mockPhotos[2]); // photo "3"
    });

    expect(result.current.selectedId).toBe("3");

    // Remove photo "1" and photo "2"
    currentPhotos = [mockPhotos[2], mockPhotos[3]];
    rerender({ photos: currentPhotos });

    // Should still be "3"
    expect(result.current.selectedId).toBe("3");
    expect(result.current.selectedIds.has("3")).toBe(true);
    expect(result.current.selectedItem).toEqual(mockPhotos[2]);
  });

  it("should maintain stable handleSelect and selectAll function references across selection changes", () => {
    const { result } = renderHook(() => useSelection(mockPhotos));
    const initialHandleSelect = result.current.handleSelect;
    const initialSelectAll = result.current.selectAll;

    act(() => {
      result.current.handleSelect(mockPhotos[0]);
    });

    expect(result.current.handleSelect).toBe(initialHandleSelect);
    expect(result.current.selectAll).toBe(initialSelectAll);

    act(() => {
      result.current.handleSelect(mockPhotos[1]);
    });

    expect(result.current.handleSelect).toBe(initialHandleSelect);
    expect(result.current.selectAll).toBe(initialSelectAll);
  });
});
