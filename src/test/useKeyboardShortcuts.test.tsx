import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { Photo } from "../types";

const mockPhoto: Photo = {
  id: "photo-1",
  path: "/path/to/photo1.jpg",
  thumb_path: "/thumb/1.jpg",
  exposure: 0,
  rating: 0,
  rejected: false,
  tags: "",
  orientation: 1,
  mime_type: "image/jpeg",
};

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    selectedPhoto: mockPhoto,
    selectedIds: new Set(["photo-1"]),
    filteredPhotos: [mockPhoto],
    viewMode: "grid" as const,
    columnCount: 4,
    isMoveModalOpen: false,
    isTagModalOpen: false,
    isDateModalOpen: false,
    isExportModalOpen: false,
    handleSelect: vi.fn(),
    selectAll: vi.fn(),
    toggleQuickCollection: vi.fn(),
    toggleRejected: vi.fn(),
    batchUpdateMetadata: vi.fn(),
    deleteSelectedPhotos: vi.fn(),
    setIsMoveModalOpen: vi.fn(),
    setIsTagModalOpen: vi.fn(),
    setIsExportModalOpen: vi.fn(),
    setViewMode: vi.fn(),
  };

  it("calls deleteSelectedPhotos when Delete key is pressed", () => {
    const deleteSelectedPhotos = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        ...defaultProps,
        deleteSelectedPhotos,
      })
    );

    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(deleteSelectedPhotos).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("calls deleteSelectedPhotos when Backspace key is pressed", () => {
    const deleteSelectedPhotos = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        ...defaultProps,
        deleteSelectedPhotos,
      })
    );

    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(deleteSelectedPhotos).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not call deleteSelectedPhotos when focus is in an input field", () => {
    const deleteSelectedPhotos = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        ...defaultProps,
        deleteSelectedPhotos,
      })
    );

    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true });
    Object.defineProperty(event, "target", { value: input, enumerable: true });
    window.dispatchEvent(event);

    expect(deleteSelectedPhotos).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does not call deleteSelectedPhotos when a modal is open", () => {
    const deleteSelectedPhotos = vi.fn();
    const { rerender } = renderHook(
      (props) => useKeyboardShortcuts(props),
      {
        initialProps: {
          ...defaultProps,
          deleteSelectedPhotos,
          isMoveModalOpen: true,
        },
      }
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(deleteSelectedPhotos).not.toHaveBeenCalled();

    rerender({
      ...defaultProps,
      deleteSelectedPhotos,
      isMoveModalOpen: false,
      isDateModalOpen: true,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(deleteSelectedPhotos).not.toHaveBeenCalled();
  });

  it("does not call deleteSelectedPhotos in slideshow mode", () => {
    const deleteSelectedPhotos = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        ...defaultProps,
        viewMode: "slideshow",
        deleteSelectedPhotos,
      })
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(deleteSelectedPhotos).not.toHaveBeenCalled();
  });
});
