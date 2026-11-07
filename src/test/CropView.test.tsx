import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CropView } from "../components/views/CropView";
import { Photo } from "../types";

const mockPhoto: Photo = {
  id: "1",
  path: "test.jpg",
  thumb_path: "thumb.jpg",
  exposure: 0,
  rating: 0,
  rejected: false,
  tags: "",
  orientation: 1,
  mime_type: "image/jpeg",
  width: 1000,
  height: 1000,
};

describe("CropView", () => {
  it("renders correctly", () => {
    render(
      <CropView
        photo={mockPhoto}
        imageUrl="test.jpg"
        onCancel={() => {}}
        onApply={() => {}}
      />
    );
    expect(screen.getByText(/Aspect Ratio:/)).toBeDefined();
    expect(screen.getByText(/Apply Crop/)).toBeDefined();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <CropView
        photo={mockPhoto}
        imageUrl="test.jpg"
        onCancel={onCancel}
        onApply={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/Cancel/));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onApply with crop coordinates when apply button is clicked", () => {
    const onApply = vi.fn();
    render(
      <CropView
        photo={mockPhoto}
        imageUrl="test.jpg"
        onCancel={() => {}}
        onApply={onApply}
      />
    );
    const img = screen.getByAltText("To crop");
    fireEvent.load(img);

    fireEvent.click(screen.getByText(/Apply Crop/));
    expect(onApply).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
    });
  });
});
