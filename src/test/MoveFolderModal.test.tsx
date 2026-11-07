import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MoveFolderModal, getParentDirectoryPath } from "../components/common/MoveFolderModal";
import { DirEntry } from "../types";

describe("getParentDirectoryPath", () => {
  it("extracts parent path correctly on Unix paths", () => {
    expect(getParentDirectoryPath("/photos/2026/08-04")).toBe("/photos/2026");
    expect(getParentDirectoryPath("/photos/2026")).toBe("/photos");
  });

  it("extracts parent path correctly on Windows paths", () => {
    expect(getParentDirectoryPath("C:\\Photos\\2026\\08-04")).toBe("C:\\Photos\\2026");
  });
});

describe("MoveFolderModal", () => {
  const mockFolder: DirEntry = {
    name: "08-04",
    path: "/photos/2026/08-04",
    photo_count: 5,
    children: [
      {
        name: "Sub",
        path: "/photos/2026/08-04/Sub",
        photo_count: 2,
        children: [],
      }
    ],
  };

  const mockTrees: DirEntry[] = [
    {
      name: "Photos",
      path: "/photos",
      photo_count: 20,
      children: [
        {
          name: "2026",
          path: "/photos/2026",
          photo_count: 10,
          children: [mockFolder],
        },
        {
          name: "2025",
          path: "/photos/2025",
          photo_count: 5,
          children: [],
        },
      ],
    },
  ];

  it("renders with folder name and destination preview", () => {
    render(
      <MoveFolderModal
        isOpen={true}
        onClose={vi.fn()}
        folder={mockFolder}
        trees={mockTrees}
        onMoveFolder={vi.fn()}
      />
    );

    const input = screen.getByTestId("folder-name-input") as HTMLInputElement;
    expect(input.value).toBe("08-04");

    const preview = screen.getByTestId("folder-destination-preview");
    expect(preview).toHaveTextContent("/photos/2026/08-04");

    // Initially unchanged, so submit button is disabled
    const submitBtn = screen.getByTestId("move-folder-confirm-btn");
    expect(submitBtn).toBeDisabled();
  });

  it("handles rename in place", async () => {
    const onMoveFolder = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <MoveFolderModal
        isOpen={true}
        onClose={onClose}
        folder={mockFolder}
        trees={mockTrees}
        onMoveFolder={onMoveFolder}
      />
    );

    const input = screen.getByTestId("folder-name-input");
    fireEvent.change(input, { target: { value: "08-04 Birthday" } });

    const submitBtn = screen.getByTestId("move-folder-confirm-btn");
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveTextContent("Rename Folder");

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onMoveFolder).toHaveBeenCalledWith(
        "/photos/2026/08-04",
        "/photos/2026/08-04 Birthday"
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("handles moving to another parent folder", async () => {
    const onMoveFolder = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <MoveFolderModal
        isOpen={true}
        onClose={onClose}
        folder={mockFolder}
        trees={mockTrees}
        onMoveFolder={onMoveFolder}
      />
    );

    // Click on 2025 in tree
    const node2025 = screen.getByText("2025");
    fireEvent.click(node2025);

    const submitBtn = screen.getByTestId("move-folder-confirm-btn");
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveTextContent("Move Folder");

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onMoveFolder).toHaveBeenCalledWith(
        "/photos/2026/08-04",
        "/photos/2025/08-04"
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows error banner if onMoveFolder rejects", async () => {
    const onMoveFolder = vi.fn().mockRejectedValue("Destination folder already exists");

    render(
      <MoveFolderModal
        isOpen={true}
        onClose={vi.fn()}
        folder={mockFolder}
        trees={mockTrees}
        onMoveFolder={onMoveFolder}
      />
    );

    const input = screen.getByTestId("folder-name-input");
    fireEvent.change(input, { target: { value: "NewName" } });

    const submitBtn = screen.getByTestId("move-folder-confirm-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("move-folder-error")).toHaveTextContent("Destination folder already exists");
    });
  });
});
