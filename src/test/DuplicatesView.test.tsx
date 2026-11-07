import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, test, describe, vi, beforeEach } from "vitest";
import { DuplicatesView, formatFileSize, formatCaptureDate } from "../components/views/DuplicatesView";
import { Photo } from "../types";
import { ApiService } from "../services/api";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn().mockResolvedValue(true),
  message: vi.fn().mockResolvedValue(undefined),
}));

const mockApi: ApiService = {
  getAllPhotos: vi.fn().mockResolvedValue([]),
  getAllTags: vi.fn().mockResolvedValue([]),
  getAllPeople: vi.fn().mockResolvedValue([]),
  getSources: vi.fn().mockResolvedValue([]),
  getDirTree: vi.fn().mockResolvedValue({ name: "root", path: "/", is_dir: true, children: [] }),
  getAssetUrl: (path: string) => `/mock-asset?path=${encodeURIComponent(path)}`,
  getPreviewUrl: vi.fn().mockResolvedValue("/mock-preview"),
  setExposure: vi.fn(),
  setPortraitBlur: vi.fn(),
  setMetadata: vi.fn(),
  batchSetMetadata: vi.fn(),
  batchSetCaptureDate: vi.fn(),
  setCrop: vi.fn(),
  setRejected: vi.fn(),
  setEvent: vi.fn(),
  batchSetEvent: vi.fn(),
  autoRename: vi.fn(),
  movePhotos: vi.fn(),
  moveFolder: vi.fn(),
  exportPhotos: vi.fn(),
  addSource: vi.fn(),
  refreshFolder: vi.fn(),
  revealInFinder: vi.fn(),
  deletePhoto: vi.fn().mockResolvedValue(undefined),
  fixAllValidationIssues: vi.fn(),
  diffICloudPhotos: vi.fn(),
  addPhotosToICloudAlbum: vi.fn(),
  getRankingPair: vi.fn().mockResolvedValue(null),
  recordRankingMatch: vi.fn(),
  getRankingQuad: vi.fn().mockResolvedValue(null),
  recordRankingQuadMatch: vi.fn().mockResolvedValue([]),
  getRankingStats: vi.fn().mockResolvedValue({ total_photos: 0, total_matches: 0, progress: 0 }),
  applySuggestedRatings: vi.fn().mockResolvedValue(0),
};

const duplicatePhotos: Photo[] = [
  {
    id: "dup-1",
    path: "/photos/2024/05-12/IMG_1001.JPG",
    thumb_path: "/thumbs/IMG_1001.JPG",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
    file_size: 2500000,
    capture_time: "2024-05-12T14:30:00Z",
    perceptual_hash: "hash_abc_123",
    width: 1920,
    height: 1080,
  },
  {
    id: "dup-2",
    path: "/photos/backup/IMG_1001_copy.JPG",
    thumb_path: "/thumbs/IMG_1001_copy.JPG",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
    file_size: 2500000,
    capture_time: "2024-05-12T14:30:00Z",
    perceptual_hash: "hash_abc_123",
    width: 1920,
    height: 1080,
  },
  {
    id: "unique-1",
    path: "/photos/2024/05-12/IMG_9999.JPG",
    thumb_path: "/thumbs/IMG_9999.JPG",
    exposure: 0,
    rating: 0,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
    file_size: 1200000,
    capture_time: "2024-05-12T10:00:00Z",
    perceptual_hash: "hash_unique",
  },
];

describe("DuplicatesView Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("helper functions format file size and capture date accurately", () => {
    expect(formatFileSize(2500000)).toBe("2.38 MB");
    expect(formatFileSize(512000)).toBe("500 KB");
    expect(formatFileSize(0)).toBe("0 Bytes");
    expect(formatFileSize(null)).toBe("Unknown size");

    expect(formatCaptureDate("2024-05-12T14:30:00Z")).toContain("2024");
    expect(formatCaptureDate(null)).toBe("Unknown date");
  });

  test("renders empty state when no duplicate groups exist", () => {
    render(
      <DuplicatesView
        photos={[duplicatePhotos[2]]}
        api={mockApi}
      />
    );

    expect(screen.getByTestId("duplicates-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No Duplicate Photos Found")).toBeInTheDocument();
  });

  test("renders duplicate pairs side by side with key metadata (size, date, filename, relative filepath)", () => {
    const mockSources = [{ id: "src-1", path: "/photos", name: "Photos" }];
    render(
      <DuplicatesView
        photos={duplicatePhotos}
        api={mockApi}
        sources={mockSources}
      />
    );

    // Duplicate group header
    expect(screen.getByTestId("duplicate-group-0")).toBeInTheDocument();

    // Duplicate cards for dup-1 and dup-2
    const card1 = screen.getByTestId("duplicate-card-dup-1");
    const card2 = screen.getByTestId("duplicate-card-dup-2");
    expect(card1).toBeInTheDocument();
    expect(card2).toBeInTheDocument();

    // Key metadata checks for dup-1
    expect(screen.getByTestId("meta-filename-dup-1")).toHaveTextContent("IMG_1001.JPG");
    expect(screen.getByTestId("meta-filepath-dup-1")).toHaveTextContent("Photos/2024/05-12");
    expect(screen.getByTestId("meta-resolution-dup-1")).toHaveTextContent("1920 × 1080");
    expect(screen.getByTestId("meta-size-dup-1")).toHaveTextContent("2.38 MB");
    expect(screen.getByTestId("meta-date-dup-1")).toHaveTextContent(/2024/);

    // Key metadata checks for dup-2
    expect(screen.getByTestId("meta-filename-dup-2")).toHaveTextContent("IMG_1001_copy.JPG");
    expect(screen.getByTestId("meta-filepath-dup-2")).toHaveTextContent("Photos/backup");
    expect(screen.getByTestId("meta-resolution-dup-2")).toHaveTextContent("1920 × 1080");
    expect(screen.getByTestId("meta-size-dup-2")).toHaveTextContent("2.38 MB");

    // Selection checkboxes and top delete button
    expect(screen.getByTestId("select-checkbox-dup-1")).toBeInTheDocument();
    expect(screen.getByTestId("select-checkbox-dup-2")).toBeInTheDocument();
    expect(screen.getByTestId("delete-selected-btn")).toBeDisabled();
  });

  test("selecting photo checkboxes enables top delete button, prompting confirmation on click", async () => {
    const onPhotosDeleted = vi.fn();
    const { confirm } = await import("@tauri-apps/plugin-dialog");

    render(
      <DuplicatesView
        photos={duplicatePhotos}
        api={mockApi}
        onPhotosDeleted={onPhotosDeleted}
      />
    );

    const deleteBtn = screen.getByTestId("delete-selected-btn");
    expect(deleteBtn).toBeDisabled();

    const checkbox1 = screen.getByTestId("select-checkbox-dup-1");
    fireEvent.click(checkbox1);

    expect(deleteBtn).not.toBeDisabled();
    expect(deleteBtn).toHaveTextContent("Delete Selected (1)");

    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
      expect(mockApi.deletePhoto).toHaveBeenCalledWith("dup-1");
      expect(onPhotosDeleted).toHaveBeenCalled();
    });
  });

  test("prefers HEIC format as Best Quality over a larger JPEG copy", () => {
    const heicVsJpegPhotos: Photo[] = [
      {
        id: "heic-photo",
        path: "/photos/2024/05-12/IMG_2000.HEIC",
        thumb_path: "/thumbs/IMG_2000.HEIC",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/heic",
        file_size: 2100000, // smaller size
        perceptual_hash: "hash_heic_jpg",
        width: 4032,
        height: 3024,
      },
      {
        id: "jpg-photo",
        path: "/photos/2024/05-12/IMG_2000.JPG",
        thumb_path: "/thumbs/IMG_2000.JPG",
        exposure: 0,
        rating: 0,
        rejected: false,
        tags: "",
        orientation: 1,
        mime_type: "image/jpeg",
        file_size: 3800000, // larger converted size
        perceptual_hash: "hash_heic_jpg",
        width: 4032,
        height: 3024,
      },
    ];

    render(
      <DuplicatesView
        photos={heicVsJpegPhotos}
        api={mockApi}
      />
    );

    const heicCard = screen.getByTestId("duplicate-card-heic-photo");
    const jpgCard = screen.getByTestId("duplicate-card-jpg-photo");

    expect(heicCard).toHaveTextContent("Best Quality");
    expect(jpgCard).not.toHaveTextContent("Best Quality");
  });
});
