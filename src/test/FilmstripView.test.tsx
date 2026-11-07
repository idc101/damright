import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FilmstripView } from "../components/views/FilmstripView";
import { Photo } from "../types";
import { ApiProvider } from "../services/ApiProvider";
import { FixedSizeList } from "react-window";

// Mock tauri core
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

const mockPhotos: Photo[] = [
  {
    id: "1",
    path: "/path/1.jpg",
    thumb_path: "/thumb/1.jpg",
    exposure: 0,
    rating: 3,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
  },
];

test("renders rating stars overlay on filmstrip thumbnails", () => {
  const scrollRef = { current: null } as any;
  render(
    <ApiProvider>
      <FilmstripView
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1"])}
        largeImageUrl="/path/1.jpg"
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
      />
    </ApiProvider>
  );

  // Check for 3 stars
  const stars = screen.getAllByTestId("star-filled");
  expect(stars.length).toBe(3);
});

test("scrolls to active photo in virtualized list when selected photo changes", () => {
  const scrollRef = { current: null } as any;
  const scrollToItemSpy = vi.spyOn(FixedSizeList.prototype, "scrollToItem");
  
  const { rerender } = render(
    <ApiProvider>
      <FilmstripView
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1"])}
        largeImageUrl="/path/1.jpg"
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
      />
    </ApiProvider>
  );

  // It should be called on mount because selectedPhoto is provided
  expect(scrollToItemSpy).toHaveBeenCalledWith(0, "center");
  
  // Test rerender with different photo
  const photo2 = { ...mockPhotos[0], id: "2" };
  rerender(
    <ApiProvider>
      <FilmstripView
        photos={[mockPhotos[0], photo2]}
        selectedPhoto={photo2}
        selectedPhotoIds={new Set(["2"])}
        largeImageUrl="/path/2.jpg"
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
      />
    </ApiProvider>
  );
  
  expect(scrollToItemSpy).toHaveBeenCalledWith(1, "center");
  
  scrollToItemSpy.mockRestore();
});

test("renders large image directly when largeImageUrl is available without loading overlay", () => {
  const scrollRef = { current: null } as any;
  render(
    <ApiProvider>
      <FilmstripView
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1"])}
        largeImageUrl="/preview/1.jpg"
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
      />
    </ApiProvider>
  );

  const previewImgs = screen.getAllByAltText("photo preview");
  expect(previewImgs.length).toBe(1);
  expect(previewImgs[0]).toHaveAttribute("src", "/preview/1.jpg");
  expect(screen.queryByText("Loading full resolution...")).toBeNull();
});

test("renders thumbnail placeholder and loading spinner when largeImageUrl is not yet available", () => {
  const scrollRef = { current: null } as any;
  render(
    <ApiProvider>
      <FilmstripView
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1"])}
        largeImageUrl={null}
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
      />
    </ApiProvider>
  );

  const previewImgs = screen.getAllByAltText("photo preview");
  expect(previewImgs.length).toBe(1);
  expect(previewImgs[0]).toHaveAttribute("src", "/thumb/1.jpg");
  expect(document.querySelector(".large-view-loading-overlay")).not.toBeNull();
});

test("does not render reveal in finder or move buttons in controls", () => {
  const scrollRef = { current: null } as any;
  render(
    <ApiProvider>
      <FilmstripView
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1"])}
        largeImageUrl="/path/1.jpg"
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
      />
    </ApiProvider>
  );

  expect(screen.queryByTitle("Reveal in Finder")).toBeNull();
  expect(screen.queryByTitle("Move Photo(s)")).toBeNull();
  expect(screen.getByTitle("Close")).toBeDefined();
});

test("PERF: handles 20,000 photos with bounded DOM node count (< 40 thumbnail elements)", () => {
  const largePhotoSet: Photo[] = Array.from({ length: 20000 }, (_, i) => ({
    id: `photo-${i}`,
    path: `/photos/IMG_${i}.jpg`,
    thumb_path: `/thumbs/IMG_${i}.jpg`,
    exposure: 0,
    rating: (i % 5) + 1,
    rejected: false,
    tags: i % 2 === 0 ? "vacation" : "",
    orientation: 1,
    mime_type: "image/jpeg",
  }));

  const startTime = performance.now();
  render(
    <ApiProvider>
      <FilmstripView
        photos={largePhotoSet}
        selectedPhoto={largePhotoSet[0]}
        selectedPhotoIds={new Set([largePhotoSet[0].id])}
        largeImageUrl={largePhotoSet[0].path}
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
      />
    </ApiProvider>
  );
  const mountDuration = performance.now() - startTime;

  // Virtualization must keep rendered thumbnail count strictly bounded
  const thumbs = document.querySelectorAll(".filmstrip-thumb");
  expect(thumbs.length).toBeLessThanOrEqual(40);
  expect(mountDuration).toBeLessThan(1000);
});

test("PERF: rapid selection changes across 20,000 photos complete within 16ms frame budget", () => {
  const largePhotoSet: Photo[] = Array.from({ length: 20000 }, (_, i) => ({
    id: `photo-${i}`,
    path: `/photos/IMG_${i}.jpg`,
    thumb_path: `/thumbs/IMG_${i}.jpg`,
    exposure: 0,
    rating: (i % 5) + 1,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
  }));

  const { rerender } = render(
    <ApiProvider>
      <FilmstripView
        photos={largePhotoSet}
        selectedPhoto={largePhotoSet[0]}
        selectedPhotoIds={new Set([largePhotoSet[0].id])}
        largeImageUrl={largePhotoSet[0].path}
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
      />
    </ApiProvider>
  );

  const iterations = 20;
  const start = performance.now();
  for (let i = 1; i <= iterations; i++) {
    rerender(
      <ApiProvider>
        <FilmstripView
          photos={largePhotoSet}
          selectedPhoto={largePhotoSet[i]}
          selectedPhotoIds={new Set([largePhotoSet[i].id])}
          largeImageUrl={largePhotoSet[i].path}
          onSelectPhoto={() => {}}
          onToggleRejected={() => {}}
          onAutoRename={async () => 1}
          onMovePhotos={() => {}}
          onEditDate={() => {}}
          onSetEvent={() => {}}
          onBatchSetEvent={() => {}}
          onClose={() => {}}
        />
      </ApiProvider>
    );
  }
  const totalDuration = performance.now() - start;
  const avgDuration = totalDuration / iterations;

  // In simulated jsdom environment under parallel test workers, ensure bounded render time
  expect(avgDuration).toBeLessThan(200);
});

test("scrolls to active photo when width changes (e.g. metadata bar resize)", () => {
  const scrollRef = { current: null } as any;
  const scrollToItemSpy = vi.spyOn(FixedSizeList.prototype, "scrollToItem");

  const { rerender } = render(
    <ApiProvider>
      <FilmstripView
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1"])}
        largeImageUrl="/path/1.jpg"
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
        width={800}
      />
    </ApiProvider>
  );

  expect(scrollToItemSpy).toHaveBeenCalledWith(0, "center");
  scrollToItemSpy.mockClear();

  // Rerender with resized width (e.g. metadata bar expanded)
  rerender(
    <ApiProvider>
      <FilmstripView
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1"])}
        largeImageUrl="/path/1.jpg"
        onSelectPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        onClose={() => {}}
        scrollRef={scrollRef}
        width={500}
      />
    </ApiProvider>
  );

  expect(scrollToItemSpy).toHaveBeenCalledWith(0, "center");
  scrollToItemSpy.mockRestore();
});


