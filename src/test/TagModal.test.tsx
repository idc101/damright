import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TagModal } from "../components/common/TagModal";

describe("TagModal", () => {
  const allTags = [
    { name: "vacation", count: 10 },
    { name: "nature", count: 5 },
    { name: "portrait", count: 2 },
  ];

  it("renders partial tags with indicator", () => {
    render(
      <TagModal
        isOpen={true}
        onClose={vi.fn()}
        allTags={allTags}
        initialTags={["nature"]}
        partialTags={["nature"]}
        onSave={vi.fn()}
        selectedCount={5}
      />
    );

    expect(screen.getByText("nature")).toBeInTheDocument();
    expect(screen.getByText("(some)")).toBeInTheDocument();
  });

  it("promotes partial tag to full when clicked", () => {
    const onSave = vi.fn();
    render(
      <TagModal
        isOpen={true}
        onClose={vi.fn()}
        allTags={allTags}
        initialTags={["nature"]}
        partialTags={["nature"]}
        onSave={onSave}
        selectedCount={5}
      />
    );

    // Click the partial tag pill to promote it to full
    const naturePill = screen.getByText("nature").closest(".tag-pill");
    expect(naturePill).toHaveClass("partial");
    fireEvent.click(naturePill!);

    // Should no longer have partial class or (some)
    expect(screen.queryByText("(some)")).not.toBeInTheDocument();
    expect(naturePill).not.toHaveClass("partial");

    // Apply
    fireEvent.click(screen.getByText(/Apply to 5 Photos/i));

    // Since it was promoted from partial to full, nature should be in added!
    expect(onSave).toHaveBeenCalledWith(["nature"], {
      added: ["nature"],
      removed: [],
    });
  });

  it("only adds new tag when partial tag is untouched", () => {
    const onSave = vi.fn();
    render(
      <TagModal
        isOpen={true}
        onClose={vi.fn()}
        allTags={allTags}
        initialTags={["nature"]}
        partialTags={["nature"]}
        onSave={onSave}
        selectedCount={5}
      />
    );

    // Add vacation
    const input = screen.getByPlaceholderText(/Search or add new tag.../i);
    fireEvent.change(input, { target: { value: "vacation" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Apply
    fireEvent.click(screen.getByText(/Apply to 5 Photos/i));

    // vacation was added, nature remained partial (untouched)
    expect(onSave).toHaveBeenCalledWith(["nature", "vacation"], {
      added: ["vacation"],
      removed: [],
    });
  });

  it("removes a tag when remove button is clicked", () => {
    const onSave = vi.fn();
    render(
      <TagModal
        isOpen={true}
        onClose={vi.fn()}
        allTags={allTags}
        initialTags={["nature"]}
        partialTags={["nature"]}
        onSave={onSave}
        selectedCount={5}
      />
    );

    const removeBtn = screen.getByTitle("Remove nature");
    fireEvent.click(removeBtn);

    const currentTagsSection = document.querySelector(".current-tags-section");
    expect(currentTagsSection?.textContent).not.toContain("nature");

    fireEvent.click(screen.getByText(/Apply to 5 Photos/i));

    expect(onSave).toHaveBeenCalledWith([], {
      added: [],
      removed: ["nature"],
    });
  });
});
