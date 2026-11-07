import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PhotoGrid } from "../components/views/PhotoGrid";
import { Photo } from "../types";
import { ApiProvider } from "../services/ApiProvider";

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
  {
    id: "2",
    path: "/path/2.jpg",
    thumb_path: "/thumb/2.jpg",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
  },
];

test("renders rating stars overlay on thumbnails", () => {
  render(
    <ApiProvider>
      <PhotoGrid
        photos={mockPhotos}
        selectedPhoto={null}
        selectedPhotoIds={new Set()}
        onSelectPhoto={() => {}}
        onDoubleClickPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        columnCount={3}

        columnWidth={200}
        gridWidth={400}
        gridHeight={400}
      />
    </ApiProvider>
  );

  // Check for 3 stars
  const stars = screen.getAllByTestId("star-filled");
  expect(stars.length).toBe(3);
});

test("highlights selected and active photos", () => {
  render(
    <ApiProvider>
      <PhotoGrid
        photos={mockPhotos}
        selectedPhoto={mockPhotos[0]}
        selectedPhotoIds={new Set(["1", "2"])}
        onSelectPhoto={() => {}}
        onDoubleClickPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        columnCount={3}

        columnWidth={200}
        gridWidth={400}
        gridHeight={400}
      />
    </ApiProvider>
  );

  const cells = document.querySelectorAll(".photo-thumbnail");
  expect(cells[0].classList.contains("selected")).toBe(true);
  expect(cells[0].classList.contains("active")).toBe(true);
  expect(cells[1].classList.contains("selected")).toBe(true);
  expect(cells[1].classList.contains("active")).toBe(false);
});

test("renders dynamic month/year title header and count", () => {
  const datedPhotos: Photo[] = [
    {
      id: "p1",
      path: "/path/2024/10/photo1.jpg",
      thumb_path: "/thumb/1.jpg",
      exposure: 0,
      rating: 0,
      rejected: false,
      tags: "",
      orientation: 1,
      mime_type: "image/jpeg",
      capture_time: "2024-10-15 14:00:00",
    },
    {
      id: "p2",
      path: "/path/2024/10/photo2.jpg",
      thumb_path: "/thumb/2.jpg",
      exposure: 0,
      rating: 0,
      rejected: false,
      tags: "",
      orientation: 1,
      mime_type: "image/jpeg",
      capture_time: "2024-10-16 15:00:00",
    },
  ];

  render(
    <ApiProvider>
      <PhotoGrid
        photos={datedPhotos}
        selectedPhoto={null}
        selectedPhotoIds={new Set()}
        onSelectPhoto={() => {}}
        onDoubleClickPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        columnCount={3}
        columnWidth={200}
        gridWidth={400}
        gridHeight={400}
      />
    </ApiProvider>
  );

  const title = screen.getByTestId("photo-grid-title");
  expect(title).toBeInTheDocument();
  expect(title.textContent).toBe("October 2024");

  const count = screen.getByTestId("photo-grid-count");
  expect(count).toBeInTheDocument();
  expect(count.textContent).toBe("2 items");
});

test("renders timeline scrubber for multi-year photos in PhotoGrid", () => {
  const multiYearPhotos: Photo[] = [
    {
      id: "p-2022",
      path: "/path/2022/photo.jpg",
      thumb_path: "/thumb/2022.jpg",
      exposure: 0,
      rating: 0,
      rejected: false,
      tags: "",
      orientation: 1,
      mime_type: "image/jpeg",
      capture_time: "2022-04-10 10:00:00",
    },
    {
      id: "p-2025",
      path: "/path/2025/photo.jpg",
      thumb_path: "/thumb/2025.jpg",
      exposure: 0,
      rating: 0,
      rejected: false,
      tags: "",
      orientation: 1,
      mime_type: "image/jpeg",
      capture_time: "2025-08-20 18:00:00",
    },
  ];

  render(
    <ApiProvider>
      <PhotoGrid
        photos={multiYearPhotos}
        selectedPhoto={null}
        selectedPhotoIds={new Set()}
        onSelectPhoto={() => {}}
        onDoubleClickPhoto={() => {}}
        onToggleRejected={() => {}}
        onAutoRename={async () => 1}
        onMovePhotos={() => {}}
        onEditDate={() => {}}
        onSetEvent={() => {}}
        onBatchSetEvent={() => {}}
        columnCount={3}
        columnWidth={200}
        gridWidth={400}
        gridHeight={400}
      />
    </ApiProvider>
  );

  // Scrubber rail should be rendered
  const scrubber = document.querySelector(".timeline-scrubber-rail");
  expect(scrubber).toBeInTheDocument();

  // Nodes for 22 and 25
  const nodes = document.querySelectorAll(".timeline-scrubber-node");
  expect(nodes.length).toBe(2);
  expect(nodes[0].textContent).toBe("22");
  expect(nodes[1].textContent).toBe("25");
});

