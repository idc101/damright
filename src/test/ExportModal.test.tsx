import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ExportModal } from "../components/common/ExportModal";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue("/export/destination"),
}));

test("renders ExportModal with selected count", () => {
  render(
    <ExportModal
      selectedCount={3}
      selectedIds={["p1", "p2", "p3"]}
      onClose={() => {}}
      onExport={async () => {}}
    />
  );

  expect(screen.getByRole("heading", { name: "Export 3 Photos" })).toBeInTheDocument();
  expect(screen.getByText("Export Destination")).toBeInTheDocument();
  expect(screen.getByText("JPEG (Re-encode processed image)")).toBeInTheDocument();
  expect(screen.getByText("Original Files (Straight Copy)")).toBeInTheDocument();
});

test("submits export configuration on form submit", async () => {
  const onExport = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();

  render(
    <ExportModal
      selectedCount={1}
      selectedIds={["p1"]}
      onClose={onClose}
      onExport={onExport}
    />
  );

  const input = screen.getByPlaceholderText("Select output folder...");
  fireEvent.change(input, { target: { value: "/my/export/path" } });

  const submitBtn = screen.getByRole("button", { name: "Export 1 Photo" });
  fireEvent.click(submitBtn);

  expect(onExport).toHaveBeenCalledWith({
    photo_ids: ["p1"],
    destination_dir: "/my/export/path",
    format_mode: "jpeg",
    jpeg_quality: 85,
    max_dimension: undefined,
    preserve_folder_structure: false,
    include_xmp: false,
  });
});
