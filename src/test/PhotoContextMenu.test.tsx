import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PhotoContextMenu } from "../components/common/PhotoContextMenu";
import { Photo } from "../types";
import userEvent from "@testing-library/user-event";

// Mock tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  message: vi.fn(),
}));

const mockPhoto: Photo = {
  id: "1",
  path: "/path/to/photos/1.jpg",
  thumb_path: "/thumb/1.jpg",
  exposure: 0,
  rating: 3,
  rejected: false,
  tags: "",
  orientation: 1,
  mime_type: "image/jpeg",
};

test("renders Show in Folder when single photo selected and calls callback on click", async () => {
  const onShowInFolder = vi.fn();
  const onClose = vi.fn();

  render(
    <PhotoContextMenu
      x={10}
      y={10}
      photo={mockPhoto}
      selectedIds={new Set(["1"])}
      onClose={onClose}
      onToggleRejected={() => {}}
      onAutoRename={async () => 1}
      onMovePhotos={() => {}}
      onEditDate={() => {}}
      onSetEvent={() => {}}
      onBatchSetEvent={() => {}}
      onShowInFolder={onShowInFolder}
    />
  );

  const btn = screen.getByRole("button", { name: /Show in Folder/i });
  expect(btn).toBeInTheDocument();

  await userEvent.click(btn);

  expect(onShowInFolder).toHaveBeenCalledWith(mockPhoto);
  expect(onClose).toHaveBeenCalled();
});

test("does not render Show in Folder when onShowInFolder is not provided", () => {
  render(
    <PhotoContextMenu
      x={10}
      y={10}
      photo={mockPhoto}
      selectedIds={new Set(["1"])}
      onClose={() => {}}
      onToggleRejected={() => {}}
      onAutoRename={async () => 1}
      onMovePhotos={() => {}}
      onEditDate={() => {}}
      onSetEvent={() => {}}
      onBatchSetEvent={() => {}}
    />
  );

  expect(screen.queryByRole("button", { name: /Show in Folder/i })).not.toBeInTheDocument();
});

test("renders Delete File button and calls confirm and delete_photo on click without second message dialog", async () => {
  const onPhotosDeleted = vi.fn();
  const onClose = vi.fn();
  
  const { confirm, message } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(message).mockClear();

  render(
    <PhotoContextMenu
      x={10}
      y={10}
      photo={mockPhoto}
      selectedIds={new Set(["1"])}
      onClose={onClose}
      onToggleRejected={() => {}}
      onAutoRename={async () => 1}
      onMovePhotos={() => {}}
      onEditDate={() => {}}
      onSetEvent={() => {}}
      onBatchSetEvent={() => {}}
      onPhotosDeleted={onPhotosDeleted}
    />
  );

  const btn = screen.getByRole("button", { name: /Delete File/i });
  expect(btn).toBeInTheDocument();

  await userEvent.click(btn);

  expect(confirm).toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("delete_photo", { id: "1" });
  expect(message).not.toHaveBeenCalled();
  expect(onPhotosDeleted).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test("renders batch Delete Files button and deletes all selected photos without second message dialog", async () => {
  const onPhotosDeleted = vi.fn();
  const onClose = vi.fn();
  
  const { confirm, message } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(message).mockClear();

  render(
    <PhotoContextMenu
      x={10}
      y={10}
      photo={mockPhoto}
      selectedIds={new Set(["1", "2"])}
      onClose={onClose}
      onToggleRejected={() => {}}
      onAutoRename={async () => 1}
      onMovePhotos={() => {}}
      onEditDate={() => {}}
      onSetEvent={() => {}}
      onBatchSetEvent={() => {}}
      onPhotosDeleted={onPhotosDeleted}
    />
  );

  const btn = screen.getByRole("button", { name: /Delete 2 Files/i });
  expect(btn).toBeInTheDocument();

  await userEvent.click(btn);

  expect(confirm).toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("delete_photo", { id: "1" });
  expect(invoke).toHaveBeenCalledWith("delete_photo", { id: "2" });
  expect(message).not.toHaveBeenCalled();
  expect(onPhotosDeleted).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

