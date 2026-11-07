import { render, screen, act } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";
import App from "../App";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_all_photos") return Promise.resolve([]);
    if (cmd === "get_all_sources") return Promise.resolve([]);
    if (cmd === "get_all_tags") return Promise.resolve([]);
    if (cmd === "get_photo_data") return Promise.resolve({ data: [1, 2, 3], mime_type: "image/jpeg" });
    if (cmd === "diff_icloud_photos") return Promise.resolve({ matched_keep: [], matched_rejected: [], orphaned: [] });
    if (cmd === "add_photos_to_icloud_album") return Promise.resolve(0);
    if (cmd === "get_inbox_count" || cmd === "update_inbox_badge") return Promise.resolve(0);
    return Promise.resolve();
  }),
  convertFileSrc: vi.fn((path) => `asset://${path}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

test("renders DamRight logo", () => {
  act(() => {
    render(<App />);
  });
  const logoElement = screen.getByAltText(/DamRight Logo/i);
  expect(logoElement).toBeInTheDocument();
});

test("native import event triggers import", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { listen } = await import("@tauri-apps/api/event");
  
  (open as any).mockResolvedValue("/mock/path");
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === "add_source") return Promise.resolve({ id: "1", path: "/mock/path", name: "mock" });
    if (cmd === "import_photos") return Promise.resolve([]);
    if (cmd === "get_all_photos") return Promise.resolve([]);
    if (cmd === "get_all_sources") return Promise.resolve([]);
    if (cmd === "get_all_tags") return Promise.resolve([]);
    if (cmd === "get_all_people") return Promise.resolve([]);
    if (cmd === "get_dir_tree") return Promise.resolve({ name: "mock", path: "/mock/path", children: [], photo_count: 0 });
    if (cmd === "diff_icloud_photos") return Promise.resolve({ matched_keep: [], matched_rejected: [], orphaned: [] });
    if (cmd === "add_photos_to_icloud_album") return Promise.resolve(0);
    return Promise.resolve();
  });

  let importCallback: any;
  (listen as any).mockImplementation((event: string, callback: any) => {
    if (event === "import") {
      importCallback = callback;
    }
    return Promise.resolve(() => {});
  });

  await act(async () => {
    render(<App />);
  });

  expect(listen).toHaveBeenCalledWith("import", expect.any(Function));

  // Simulate the native menu event
  await act(async () => {
    importCallback();
  });

  expect(open).toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("add_source", { path: "/mock/path" });
  expect(invoke).toHaveBeenCalledWith("refresh_folder", { folderPath: "/mock/path" });
});

test("restores sidebar navigation and search state from localStorage on startup", async () => {
  localStorage.setItem("selectedSidebarTab", "tags");
  localStorage.setItem("selectedTag", "Nature");
  localStorage.setItem("searchQuery", "is:edited");

  const { invoke } = await import("@tauri-apps/api/core");

  await act(async () => {
    render(<App />);
  });

  expect(invoke as any).toHaveBeenCalledWith("get_all_photos", { query: "is:edited" });
});
