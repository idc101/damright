import { render, screen, act } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";
import { SlideshowView } from "../components/views/SlideshowView";
import { Photo } from "../types";
import { ApiProvider } from "../services/ApiProvider";

// Mock tauri core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_preview") return null;
    return null;
  }),
  convertFileSrc: vi.fn((path) => path),
}));

// Mock HTMLElement.prototype.animate which is not supported by JSDOM
beforeEach(() => {
  window.HTMLElement.prototype.animate = vi.fn().mockReturnValue({
    cancel: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    finish: vi.fn(),
  });

  // Mock window.Image constructor to trigger onload instantly in JSDOM
  // @ts-ignore
  window.Image = function(this: any) {
    this.naturalWidth = 1920;
    this.naturalHeight = 1080;
    this.onload = null;
    
    let self = this;
    Object.defineProperty(this, 'src', {
      set(_val) {
        setTimeout(() => {
          if (self.onload) {
            self.onload(new Event('load'));
          }
        }, 0);
      }
    });
  } as any;
});

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
    capture_time: "2013-02-10 13:25:39",
    title: "Flight status",
    description: "Flight started off well, we all had dinner, Holly made friends...",
  },
  {
    id: "2",
    path: "/path/2.jpg",
    thumb_path: "/thumb/2.jpg",
    exposure: 0,
    rating: 4,
    rejected: false,
    tags: "",
    orientation: 1,
    mime_type: "image/jpeg",
    capture_time: "2013-02-10 13:59:58",
    title: "",
    description: "", // No description
  }
];

test("renders the book story card overlay when description is present", async () => {
  // Use vitest fake timers to control slideshow transitions
  vi.useFakeTimers();

  // Render slideshow with only the photo that has a description
  render(
    <ApiProvider>
      <SlideshowView
        photos={[mockPhotos[0]]}
        interval={5}
        kenBurns={false}
        onClose={() => {}}
        picturesBase="/path"
      />
    </ApiProvider>
  );

  // Trigger timers and flush microtasks so the slide renders
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });

  // Verify the story card and description are rendered
  const titleElement = screen.getByText("Flight status");
  const descElement = screen.getByText("Flight started off well, we all had dinner, Holly made friends...");
  
  expect(titleElement).toBeInTheDocument();
  expect(descElement).toBeInTheDocument();
  expect(titleElement.className).toBe("slideshow-story-title");
  expect(descElement.className).toBe("slideshow-story-text");

  vi.useRealTimers();
});

test("does not render the story card overlay when description is empty", async () => {
  vi.useFakeTimers();

  const { container } = render(
    <ApiProvider>
      <SlideshowView
        photos={[mockPhotos[1]]}
        interval={5}
        kenBurns={false}
        onClose={() => {}}
        picturesBase="/path"
      />
    </ApiProvider>
  );

  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });

  // Verify the story card container is not present
  const storyCard = container.querySelector(".slideshow-story-card");
  expect(storyCard).toBeNull();

  vi.useRealTimers();
});

test("fits landscape photos correctly with fit-contain when Ken Burns is disabled", async () => {
  vi.useFakeTimers();

  const { container } = render(
    <ApiProvider>
      <SlideshowView
        photos={[mockPhotos[0]]}
        interval={5}
        kenBurns={false}
        onClose={() => {}}
        picturesBase="/path"
      />
    </ApiProvider>
  );

  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });

  const activeLayerImg = container.querySelector(".slideshow-layer.active img");
  expect(activeLayerImg).not.toBeNull();
  expect(activeLayerImg?.className).toBe("fit-contain");

  vi.useRealTimers();
});

test("applies landscape class and triggers Ken Burns animation when Ken Burns is enabled", async () => {
  vi.useFakeTimers();

  const { container } = render(
    <ApiProvider>
      <SlideshowView
        photos={[mockPhotos[0]]}
        interval={5}
        kenBurns={true}
        onClose={() => {}}
        picturesBase="/path"
      />
    </ApiProvider>
  );

  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });

  const activeLayerImg = container.querySelector(".slideshow-layer.active img");
  expect(activeLayerImg).not.toBeNull();
  expect(activeLayerImg?.className).toBe("landscape");

  vi.useRealTimers();
});

test("applies portrait class and clears inline sizing for portrait photos", async () => {
  vi.useFakeTimers();

  // Save current Image constructor mock
  const originalImage = window.Image;
  // Mock Image for portrait orientation (naturalHeight > naturalWidth)
  // @ts-ignore
  window.Image = function(this: any) {
    this.naturalWidth = 1080;
    this.naturalHeight = 1920;
    this.onload = null;
    let self = this;
    Object.defineProperty(this, "src", {
      set(_val) {
        setTimeout(() => {
          if (self.onload) {
            self.onload(new Event("load"));
          }
        }, 0);
      },
    });
  } as any;

  const portraitPhoto: Photo = {
    ...mockPhotos[0],
    id: "portrait_1",
    path: "/path/portrait.jpg",
  };

  const { container } = render(
    <ApiProvider>
      <SlideshowView
        photos={[portraitPhoto]}
        interval={5}
        kenBurns={true}
        onClose={() => {}}
        picturesBase="/path"
      />
    </ApiProvider>
  );

  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });

  const activeLayerImg = container.querySelector(".slideshow-layer.active img") as HTMLImageElement;
  expect(activeLayerImg).not.toBeNull();
  expect(activeLayerImg?.className).toBe("portrait");
  // Ensure inline sizing is cleared so CSS object-fit/max-width/max-height scale to fit window
  expect(activeLayerImg?.style.width).toBe("");
  expect(activeLayerImg?.style.height).toBe("");

  window.Image = originalImage;
  vi.useRealTimers();
});

test("records photo seen timestamp in localStorage when photo is displayed", async () => {
  vi.useFakeTimers();
  localStorage.clear();

  render(
    <ApiProvider>
      <SlideshowView
        photos={[mockPhotos[0]]}
        interval={5}
        kenBurns={false}
        onClose={() => {}}
        picturesBase="/path"
      />
    </ApiProvider>
  );

  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });

  const lastSeenRaw = localStorage.getItem("slideshow_last_seen");
  expect(lastSeenRaw).not.toBeNull();
  const lastSeen = JSON.parse(lastSeenRaw!);
  expect(lastSeen["1"]).toBeDefined();

  vi.useRealTimers();
});

test("displays sleep mode overlay during sleep schedule and wakes on click", async () => {
  vi.useFakeTimers();
  // Mock current system time to 23:00 (inside 21:00 - 06:30 window)
  vi.setSystemTime(new Date(2024, 0, 1, 23, 0, 0));

  const { getByTestId, queryByTestId } = render(
    <ApiProvider>
      <SlideshowView
        photos={mockPhotos}
        interval={5}
        kenBurns={false}
        sleepMode={true}
        sleepStart="21:00"
        sleepEnd="06:30"
        onClose={() => {}}
        picturesBase="/path"
      />
    </ApiProvider>
  );

  await act(async () => {
    vi.advanceTimersByTime(1000);
  });

  const overlay = getByTestId("slideshow-sleep-overlay");
  expect(overlay).toBeInTheDocument();
  expect(overlay.textContent).toContain("Night Mode (21:00 – 06:30)");

  // Click on the overlay to temporarily wake
  await act(async () => {
    overlay.click();
    vi.advanceTimersByTime(1000);
  });

  expect(queryByTestId("slideshow-sleep-overlay")).toBeNull();

  vi.useRealTimers();
});

test("renders dedicated full-screen markdown slide for text/markdown media asset", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "# Rainier Expedition\n\nCrossing the glacier at dawn was magical.",
  }));

  const markdownPhoto: Photo = {
    id: "md-1",
    path: "/photos/rainier.md",
    thumb_path: "/thumbs/rainier.svg",
    exposure: 0,
    rating: 5,
    rejected: false,
    tags: "climbing,mountains",
    orientation: 1,
    mime_type: "text/markdown",
    capture_time: "2024-07-14 06:00:00",
    title: "Rainier Expedition",
    description: "Crossing the glacier at dawn was magical.",
  };

  const { getByTestId } = render(
    <ApiProvider>
      <SlideshowView
        photos={[markdownPhoto]}
        interval={5}
        kenBurns={false}
        shuffle={false}
        onClose={() => {}}
      />
    </ApiProvider>
  );

  await act(async () => {
    vi.advanceTimersByTime(1000);
  });

  const slide = getByTestId("slideshow-markdown-slide");
  expect(slide).toBeInTheDocument();
  expect(slide.textContent).toContain("Rainier Expedition");

  vi.useRealTimers();
});


