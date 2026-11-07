import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SlideshowModal } from "../components/common/SlideshowModal";
import { TagWithCount, PersonWithCount } from "../types";

const mockTags: TagWithCount[] = [
  { name: "Family", count: 42 },
  { name: "Vacation", count: 18 },
  { name: "Private", count: 5 },
];

const mockPeople: PersonWithCount[] = [
  { name: "Alice", count: 12 },
  { name: "Bob", count: 8 },
];

test("renders SlideshowModal with initial configuration", () => {
  const onStart = vi.fn();
  const onClose = vi.fn();

  render(
    <SlideshowModal
      isOpen={true}
      onClose={onClose}
      allTags={mockTags}
      allPeople={mockPeople}
      initialConfig={{
        after: "2009",
        includedTags: ["Family"],
        excludedTags: ["Private"],
        interval: 15,
        kenBurns: true,
      }}
      onStartSlideshow={onStart}
      serverOrigin="http://192.168.1.50:8010"
    />
  );

  expect(screen.getByText("Slideshow & Kiosk Configuration")).toBeInTheDocument();
  expect(screen.getByDisplayValue("2009")).toBeInTheDocument();
  expect(screen.getByText("Family")).toBeInTheDocument();
  expect(screen.getByText("- Private")).toBeInTheDocument();
  const urlElements = screen.getAllByText(/http:\/\/192\.168\.1\.50:8010\/slideshow/i);
  expect(urlElements.length).toBeGreaterThanOrEqual(1);
});

test("triggers onStartSlideshow with updated config when Start is clicked", () => {
  const onStart = vi.fn();
  const onClose = vi.fn();

  render(
    <SlideshowModal
      isOpen={true}
      onClose={onClose}
      allTags={mockTags}
      allPeople={mockPeople}
      initialConfig={{
        after: "2009",
        includedTags: ["Family"],
        interval: 10,
        kenBurns: true,
      }}
      onStartSlideshow={onStart}
    />
  );

  const startButton = screen.getByRole("button", { name: /Start Slideshow/i });
  fireEvent.click(startButton);

  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      after: "2009",
      includedTags: ["Family"],
      interval: 10,
      kenBurns: true,
      searchQuery: expect.stringContaining("after:2009 tag:Family"),
    })
  );
  expect(onClose).toHaveBeenCalled();
});

test("toggles sleep mode and configures custom sleep times", () => {
  const onStart = vi.fn();
  const onClose = vi.fn();

  render(
    <SlideshowModal
      isOpen={true}
      onClose={onClose}
      allTags={mockTags}
      allPeople={mockPeople}
      initialConfig={{
        interval: 15,
        sleepMode: true,
        sleepStart: "22:00",
        sleepEnd: "07:00",
      }}
      onStartSlideshow={onStart}
    />
  );

  expect(screen.getByDisplayValue("22:00")).toBeInTheDocument();
  expect(screen.getByDisplayValue("07:00")).toBeInTheDocument();

  const startButton = screen.getByRole("button", { name: /Start Slideshow/i });
  fireEvent.click(startButton);

  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      sleepMode: true,
      sleepStart: "22:00",
      sleepEnd: "07:00",
    })
  );
});
