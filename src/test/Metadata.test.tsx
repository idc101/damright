import { render, screen, fireEvent, act } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";
import App from "../App";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path) => `asset://${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const mockPhotos = [
  {
    id: "1",
    path: "/path/1.jpg",
    thumb_path: "/cache/1.jpg",
    exposure: 0,
    rating: 0,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2026-05-09 12:34:56",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === "get_all_photos") return Promise.resolve(mockPhotos);
    if (cmd === "get_all_sources") return Promise.resolve([
      { id: "src1", path: "/path", name: "Mock Source" }
    ]);
    if (cmd === "get_all_tags") return Promise.resolve([]);
    if (cmd === "get_dir_tree") return Promise.resolve({ name: "root", path: "/", children: [], photo_count: 0 });
    return Promise.resolve();
  });
});

test("renders photos and handles selection", async () => {
  await act(async () => {
    render(<App />);
  });

  const thumb = screen.getByAltText("thumbnail");
  expect(thumb).toBeInTheDocument();

  fireEvent.click(thumb);
  expect(screen.getByRole('heading', { name: /Metadata/i })).toBeInTheDocument();
  expect(screen.getByText(/File Info/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Tags/i).length).toBeGreaterThan(0);

  // Switch to Edit tab
  fireEvent.click(screen.getByTitle(/Edit Adjustments/i));
  expect(screen.getByText(/Adjustments/i)).toBeInTheDocument();
  expect(screen.getByText(/Crop & Rotation/i)).toBeInTheDocument();
});

test("updates rating when star is clicked", async () => {
  await act(async () => {
    render(<App />);
  });

  fireEvent.click(screen.getByAltText("thumbnail"));

  const stars = document.querySelectorAll('.lucide-star');
  // Star 3 (index 2)
  await act(async () => {
    fireEvent.click(stars[2]);
  });

  expect(invoke).toHaveBeenCalledWith("set_metadata", {
    id: "1",
    rating: 3,
    tags: "",
    title: "",
    description: "",
  });
});

test("opens tag modal and updates tags", async () => {
  await act(async () => {
    render(<App />);
  });

  fireEvent.click(screen.getByAltText("thumbnail"));

  const editBtn = screen.getByTitle(/Edit Tags/i);
  fireEvent.click(editBtn);

  expect(screen.getByText("Edit Tags")).toBeInTheDocument();

  const tagInput = screen.getByPlaceholderText(/Search or add new tag.../i);
  fireEvent.change(tagInput, { target: { value: "vacation" } });
  fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });

  const applyBtn = screen.getByText(/Apply to 1 Photo/i);
  await act(async () => {
    fireEvent.click(applyBtn);
  });

  expect(invoke).toHaveBeenCalledWith("batch_set_metadata", {
    ids: ["1"],
    rating: undefined,
    tags: undefined,
    title: undefined,
    description: undefined,
    addTags: ["vacation"],
    removeTags: [],
  });
});

test("multi-photo tagging only applies the delta change", async () => {
  const fivePhotos = [
    { id: "p1", path: "/path/1.jpg", thumb_path: "/cache/1.jpg", exposure: 0, rating: 0, tags: "tagA", orientation: 1, mime_type: "image/jpeg" },
    { id: "p2", path: "/path/2.jpg", thumb_path: "/cache/2.jpg", exposure: 0, rating: 0, tags: "tagA", orientation: 1, mime_type: "image/jpeg" },
    { id: "p3", path: "/path/3.jpg", thumb_path: "/cache/3.jpg", exposure: 0, rating: 0, tags: "", orientation: 1, mime_type: "image/jpeg" },
    { id: "p4", path: "/path/4.jpg", thumb_path: "/cache/4.jpg", exposure: 0, rating: 0, tags: "", orientation: 1, mime_type: "image/jpeg" },
    { id: "p5", path: "/path/5.jpg", thumb_path: "/cache/5.jpg", exposure: 0, rating: 0, tags: "", orientation: 1, mime_type: "image/jpeg" },
  ];

  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === "get_all_photos") return Promise.resolve(fivePhotos);
    if (cmd === "get_all_sources") return Promise.resolve([{ id: "src1", path: "/path", name: "Mock Source" }]);
    if (cmd === "get_all_tags") return Promise.resolve([{ name: "tagA", count: 2 }]);
    if (cmd === "get_dir_tree") return Promise.resolve({ name: "root", path: "/", children: [], photo_count: 5 });
    return Promise.resolve();
  });

  await act(async () => {
    render(<App />);
  });

  const thumbs = screen.getAllByAltText("thumbnail");
  expect(thumbs).toHaveLength(5);

  // Click first photo (p1 has tagA)
  fireEvent.click(thumbs[0]);
  // Cmd-click all other 4 photos to select all 5
  fireEvent.click(thumbs[1], { metaKey: true });
  fireEvent.click(thumbs[2], { metaKey: true });
  fireEvent.click(thumbs[3], { metaKey: true });
  fireEvent.click(thumbs[4], { metaKey: true });

  const editBtn = screen.getByTitle(/Edit Tags/i);
  fireEvent.click(editBtn);

  expect(screen.getByText("Edit Tags")).toBeInTheDocument();
  // tagA is shown as partial
  expect(screen.getByText("tagA")).toBeInTheDocument();
  expect(screen.getByText("(some)")).toBeInTheDocument();

  // Add tagB
  const tagInput = screen.getByPlaceholderText(/Search or add new tag.../i);
  fireEvent.change(tagInput, { target: { value: "tagB" } });
  fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });

  expect(screen.getByText("tagB")).toBeInTheDocument();

  // Apply to 5 photos
  const applyBtn = screen.getByText(/Apply to 5 Photos/i);
  await act(async () => {
    fireEvent.click(applyBtn);
  });

  // Only tagB should be added! tagA is NOT in add_tags
  expect(invoke).toHaveBeenCalledWith("batch_set_metadata", {
    ids: ["p1", "p2", "p3", "p4", "p5"],
    rating: undefined,
    tags: undefined,
    title: undefined,
    description: undefined,
    addTags: ["tagB"],
    removeTags: [],
  });
});

test("updates exposure when slider changes", async () => {
  await act(async () => {
    render(<App />);
  });

  fireEvent.click(screen.getByAltText("thumbnail"));

  // Switch to Edit tab
  fireEvent.click(screen.getByTitle(/Edit Adjustments/i));

  const slider = screen.getAllByRole("slider")[0];
  await act(async () => {
    fireEvent.change(slider, { target: { value: "0.5" } });
  });

  expect(invoke).toHaveBeenCalledWith("set_exposure", {
    id: "1",
    exposure: 0.5,
  });
});

test("displays the capture date if available", async () => {
  await act(async () => {
    render(<App />);
  });

  fireEvent.click(screen.getByAltText("thumbnail"));

  expect(screen.getByText(/Date:/i)).toBeInTheDocument();
  expect(screen.getByText("2026-05-09 12:34:56")).toBeInTheDocument();
});

test("displays relative path and copy menu", async () => {
  // Mock clipboard API
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn(() => Promise.resolve()),
    },
    writable: true,
    configurable: true
  });

  await act(async () => {
    render(<App />);
  });

  fireEvent.click(screen.getByAltText("thumbnail"));

  // The absolute path of the mock photo is `/path/1.jpg`.
  // The mock source is `{ id: "src1", path: "/path", name: "Mock Source" }`.
  // So the relative folder path should be `Mock Source`.
  expect(screen.getByText(/Folder:/i)).toBeInTheDocument();
  expect(screen.getByText("Mock Source")).toBeInTheDocument();

  // Test opening folder copy menu
  const copyFolderBtn = screen.getByTitle("Copy folder path options");
  expect(copyFolderBtn).toBeInTheDocument();
  
  fireEvent.click(copyFolderBtn);
  
  // Menu items for folder should be visible
  expect(screen.getByText("Absolute Folder Path")).toBeInTheDocument();
  expect(screen.getByText("Relative Folder Path")).toBeInTheDocument();

  // Click on absolute folder path option to copy
  const absFolderOption = screen.getByText("Absolute Folder Path");
  await act(async () => {
    fireEvent.click(absFolderOption);
  });

  // Verify writeText was called with folder path
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/path");

  // Test opening filename copy menu
  const copyFileBtn = screen.getByTitle("Copy filename options");
  expect(copyFileBtn).toBeInTheDocument();
  
  fireEvent.click(copyFileBtn);
  
  // Menu items for filename should be visible
  expect(screen.getByText("Filename")).toBeInTheDocument();
  expect(screen.getByText("Absolute File Path")).toBeInTheDocument();
  expect(screen.getByText("Relative File Path")).toBeInTheDocument();

  // Click on filename option to copy
  const filenameOption = screen.getByText("Filename");
  await act(async () => {
    fireEvent.click(filenameOption);
  });

  // Verify writeText was called with filename
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("1.jpg");
});
