import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PhotoLightbox } from "../components/common/PhotoLightbox";
import { Photo } from "../types";
import { ApiService } from "../services/api";

const mockPhotos: Photo[] = [
  {
    id: "p1",
    path: "/photos/nature.jpg",
    thumb_path: "/thumbs/nature.jpg",
    exposure: 0,
    rating: 4,
    rejected: false,
    tags: "forest, trees",
    orientation: 1,
    mime_type: "image/jpeg",
    title: "Misty Forest",
    description: "A misty morning in the pine woods",
    capture_time: "2026-05-10 08:30:00",
    width: 4000,
    height: 3000,
    file_size: 5 * 1024 * 1024,
    camera_make: "Sony",
    camera_model: "A7IV",
    event: "Morning Hike",
    faces: [{ name: "Alice", area_x: 0, area_y: 0, area_w: 0.1, area_h: 0.1 }],
  },
  {
    id: "p2",
    path: "/photos/video.mp4",
    thumb_path: "/thumbs/video.jpg",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "river",
    orientation: 1,
    mime_type: "video/mp4",
    title: "River Stream",
  },
  {
    id: "p3",
    path: "/photos/sunset.jpg",
    thumb_path: "/thumbs/sunset.jpg",
    exposure: 0,
    rating: 5,
    rejected: false,
    tags: "sunset",
    orientation: 1,
    mime_type: "image/jpeg",
    title: "Golden Sunset",
  },
  {
    id: "p4",
    path: "/photos/journal.md",
    thumb_path: "/thumbs/journal.svg",
    exposure: 0,
    rating: 5,
    rejected: false,
    tags: "journal",
    orientation: 1,
    mime_type: "text/markdown",
    title: "Trip Journal",
    description: "Reflections on our wonderful mountain trip.",
  },
];

const mockApi: Partial<ApiService> = {
  getAssetUrl: vi.fn().mockImplementation((path) => `/api/asset?path=${path}`),
  getPreviewUrl: vi.fn().mockResolvedValue("/api/preview.jpg"),
};

vi.mock("../services/ApiProvider", () => ({
  useApi: () => mockApi,
}));

describe("PhotoLightbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when isOpen is false or photo is null", () => {
    const { container, rerender } = render(
      <PhotoLightbox
        photo={mockPhotos[0]}
        photos={mockPhotos}
        currentIndex={0}
        isOpen={false}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <PhotoLightbox
        photo={null as any}
        photos={mockPhotos}
        currentIndex={0}
        isOpen={true}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders image preview and handles keyboard navigation", async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      render(
        <PhotoLightbox
          photo={mockPhotos[1]}
          photos={mockPhotos}
          currentIndex={1}
          isOpen={true}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      );
    });

    // ArrowLeft -> Navigate to 0
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenCalledWith(0);

    // ArrowRight -> Navigate to 2
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(2);

    // Escape -> Close
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders video element for video mime types", async () => {
    let renderedContainer: HTMLElement;
    await act(async () => {
      const { container } = render(
        <PhotoLightbox
          photo={mockPhotos[1]}
          photos={mockPhotos}
          currentIndex={1}
          isOpen={true}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
        />
      );
      renderedContainer = container;
    });

    const video = renderedContainer!.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.getAttribute("src")).toBe("/api/asset?path=/photos/video.mp4");
  });

  it("opens metadata drawer and displays photo EXIF info and triggers callbacks", async () => {
    const onTagClick = vi.fn();
    const onPersonClick = vi.fn();

    await act(async () => {
      render(
        <PhotoLightbox
          photo={mockPhotos[0]}
          photos={mockPhotos}
          currentIndex={0}
          isOpen={true}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          onTagClick={onTagClick}
          onPersonClick={onPersonClick}
        />
      );
    });

    // Toggle Info Drawer
    const infoBtn = screen.getByRole("button", { name: /Details/i });
    fireEvent.click(infoBtn);

    // Verify metadata drawer content
    expect(screen.getByText("Misty Forest")).toBeInTheDocument();
    expect(screen.getByText("A misty morning in the pine woods")).toBeInTheDocument();
    expect(screen.getByText(/4000 × 3000/)).toBeInTheDocument();
    expect(screen.getByText(/Sony A7IV/)).toBeInTheDocument();
    expect(screen.getByText("Morning Hike")).toBeInTheDocument();

    // Tags
    const forestTag = screen.getByText("forest");
    expect(forestTag).toBeInTheDocument();
    fireEvent.click(forestTag);
    expect(onTagClick).toHaveBeenCalledWith("forest");

    // People
    const alicePill = screen.getByText("Alice");
    expect(alicePill).toBeInTheDocument();
    fireEvent.click(alicePill);
    expect(onPersonClick).toHaveBeenCalledWith("Alice");
  });

  it("handles touch swipe navigation", async () => {
    const onNavigate = vi.fn();
    let renderedContainer: HTMLElement;

    await act(async () => {
      const { container } = render(
        <PhotoLightbox
          photo={mockPhotos[1]}
          photos={mockPhotos}
          currentIndex={1}
          isOpen={true}
          onClose={vi.fn()}
          onNavigate={onNavigate}
        />
      );
      renderedContainer = container;
    });

    const viewerBody = renderedContainer!.querySelector(".web-viewer-body");
    expect(viewerBody).toBeInTheDocument();

    // Swipe left (next)
    fireEvent.touchStart(viewerBody!, { targetTouches: [{ clientX: 300 }] });
    fireEvent.touchMove(viewerBody!, { targetTouches: [{ clientX: 200 }] });
    fireEvent.touchEnd(viewerBody!);
    expect(onNavigate).toHaveBeenCalledWith(2);

    // Swipe right (prev)
    fireEvent.touchStart(viewerBody!, { targetTouches: [{ clientX: 100 }] });
    fireEvent.touchMove(viewerBody!, { targetTouches: [{ clientX: 200 }] });
    fireEvent.touchEnd(viewerBody!);
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it("renders markdown reader for markdown mime types", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Mountain Journal\n\nA beautiful day in the high country.",
    }));

    let renderedContainer: HTMLElement;
    await act(async () => {
      const { container } = render(
        <PhotoLightbox
          photo={mockPhotos[3]}
          photos={mockPhotos}
          currentIndex={3}
          isOpen={true}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
        />
      );
      renderedContainer = container;
    });

    const markdownReader = renderedContainer!.querySelector(".markdown-reader");
    expect(markdownReader).toBeInTheDocument();
    expect(screen.getAllByText("Trip Journal").length).toBeGreaterThanOrEqual(1);
    expect(renderedContainer!.querySelector(".markdown-reader-title")?.textContent).toBe("Trip Journal");
  });
});
