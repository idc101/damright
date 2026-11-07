import { render, screen, act } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import WebApp from "../WebApp";
import { ApiService } from "../services/api";

const mockPhotos = [
  {
    id: "p1",
    path: "/Users/user/Pictures/Library/2026/06-07/photo1.jpg",
    thumb_path: "/thumb/1.jpg",
    exposure: 0,
    rating: 3,
    rejected: false,
    tags: "nature,green",
    orientation: 1,
    mime_type: "image/jpeg",
    faces: [],
    capture_time: "2026-06-07 12:00:00",
    file_size: 1000,
    width: 800,
    height: 600,
  }
];

const mockSources = [
  {
    id: "s1",
    path: "/Users/user/Pictures/Library",
    name: "Library"
  }
];

const mockApi: Partial<ApiService> = {
  getAllPhotos: vi.fn().mockResolvedValue(mockPhotos),
  getSources: vi.fn().mockResolvedValue(mockSources),
  getAllTags: vi.fn().mockResolvedValue([]),
  getAllPeople: vi.fn().mockResolvedValue([]),
  getAssetUrl: vi.fn().mockImplementation((path) => `/api/asset?path=${path}`),
  getPreviewUrl: vi.fn().mockResolvedValue("/preview.jpg"),
};

vi.mock("../services/ApiProvider", () => ({
  ApiProvider: ({ children }: any) => <div>{children}</div>,
  useApi: () => mockApi,
}));

test("WebApp renders photos", async () => {
  await act(async () => {
    render(<WebApp />);
  });
  
  // Verify photos and sources are fetched
  expect(mockApi.getAllPhotos).toHaveBeenCalled();
  expect(mockApi.getSources).toHaveBeenCalled();
  
  // Verify the photos are rendered in the grid
  const gridItem = await screen.findByRole("img");
  expect(gridItem).toBeInTheDocument();
});

test("WebApp renders contextual header with dynamic month/year title", async () => {
  await act(async () => {
    render(<WebApp />);
  });

  // Verify contextual header dynamic title is present for June 2026 photo
  expect(screen.getByRole("heading", { name: "June 2026" })).toBeInTheDocument();
  // Verify no branding title or logo is in the header
  expect(screen.queryByText("DamRight Web")).not.toBeInTheDocument();
});

test("WebApp opens slideshow when pathname is /slideshow", async () => {
  delete (window as any).location;
  (window as any).location = new URL("http://localhost:8010/slideshow?interval=10");

  await act(async () => {
    render(<WebApp />);
  });

  const slideshowClock = screen.getByText(/\d{2}:\d{2}/);
  expect(slideshowClock).toBeInTheDocument();
});

test("WebApp renders bottom navigation bar with all tabs", async () => {
  await act(async () => {
    render(<WebApp />);
  });

  expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Folders" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tags" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
});

test("WebApp renders timeline segmented controls and toggles Years and Months views", async () => {
  await act(async () => {
    render(<WebApp />);
  });

  // Verify segmented control buttons
  const yearsBtn = screen.getByRole("button", { name: "Years" });
  const monthsBtn = screen.getByRole("button", { name: "Months" });
  const allBtn = screen.getByRole("button", { name: "All" });

  expect(yearsBtn).toBeInTheDocument();
  expect(monthsBtn).toBeInTheDocument();
  expect(allBtn).toBeInTheDocument();

  // Click "Years"
  await act(async () => {
    yearsBtn.click();
  });
  expect(screen.getByText("2026")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Years" })).toBeInTheDocument();

  // Click "Months"
  await act(async () => {
    monthsBtn.click();
  });
  expect(screen.getByText("June 2026")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Months" })).toBeInTheDocument();

  // Click "All" to return to flat photo grid
  await act(async () => {
    allBtn.click();
  });
  const gridItem = await screen.findByRole("img");
  expect(gridItem).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "June 2026" })).toBeInTheDocument();
});

test("WebApp renders scrubber for multi-year photos with chronological ordering", async () => {
  const multiYearPhotos = [
    {
      id: "p-2023",
      path: "/Users/user/Pictures/Library/2023/photo.jpg",
      thumb_path: "/thumb/2023.jpg",
      exposure: 0,
      rating: 0,
      rejected: false,
      tags: "",
      orientation: 1,
      mime_type: "image/jpeg",
      faces: [],
      capture_time: "2023-05-10 10:00:00",
    },
    {
      id: "p-2026",
      path: "/Users/user/Pictures/Library/2026/photo.jpg",
      thumb_path: "/thumb/2026.jpg",
      exposure: 0,
      rating: 0,
      rejected: false,
      tags: "",
      orientation: 1,
      mime_type: "image/jpeg",
      faces: [],
      capture_time: "2026-06-07 12:00:00",
    },
  ];

  mockApi.getAllPhotos = vi.fn().mockResolvedValue(multiYearPhotos);

  await act(async () => {
    render(<WebApp />);
  });

  // Check that scrubber track is rendered
  const scrubber = document.querySelector(".timeline-scrubber-rail");
  expect(scrubber).toBeInTheDocument();

  // Check scrubber labels: 23 at top, 26 at bottom (chronological ascending order)
  const nodes = document.querySelectorAll(".timeline-scrubber-node");
  expect(nodes.length).toBe(2);
  expect(nodes[0].textContent).toBe("23");
  expect(nodes[1].textContent).toBe("26");
});




