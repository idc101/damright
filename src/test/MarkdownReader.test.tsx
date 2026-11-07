import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MarkdownReader } from "../components/common/MarkdownReader";
import { Photo } from "../types";
import { ApiProvider } from "../services/ApiProvider";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path) => `/api/asset?path=${path}`),
}));

const mockPhoto: Photo = {
  id: "post-1",
  path: "/photos/2024/07-14-hiking/post.md",
  thumb_path: "/thumbs/post.svg",
  exposure: 0,
  rating: 4,
  rejected: false,
  tags: "hiking,mountains",
  orientation: 1,
  mime_type: "text/markdown",
  capture_time: "2024-07-14 10:00:00",
  title: "Mount Rainier Hike",
  event: "Summer Trip 2024",
  description: "An unforgettable trek through wildflowers and alpine ridges.",
};

const sampleMarkdown = `---
title: "Mount Rainier Hike"
date: "2024-07-14 10:00:00"
---

# Skyline Trail Adventure

We started early from Paradise Visitor Center.

> The mountains are calling and I must go.

## Highlights
- **Stunning views** of the glaciers
- *Wildflowers* in full bloom
- High altitude alpine meadows

\`\`\`
GPS: 46.8523, -121.7603
\`\`\`

![Summit Peak](summit.jpg)
`;

describe("MarkdownReader", () => {
  it("renders frontmatter-stripped markdown content with headings, lists, quotes, and images", () => {
    render(
      <ApiProvider>
        <MarkdownReader photo={mockPhoto} content={sampleMarkdown} variant="lightbox" />
      </ApiProvider>
    );

    expect(screen.getByText("Mount Rainier Hike")).toBeInTheDocument();
    expect(screen.getByText("Summer Trip 2024")).toBeInTheDocument();
    expect(screen.getByText("#hiking")).toBeInTheDocument();
    expect(screen.getByText("Skyline Trail Adventure")).toBeInTheDocument();
    expect(screen.getByText("We started early from Paradise Visitor Center.")).toBeInTheDocument();
    expect(screen.getByText("The mountains are calling and I must go.")).toBeInTheDocument();
    expect(screen.getByText("Highlights")).toBeInTheDocument();
    expect(screen.getByText("Stunning views")).toBeInTheDocument();
    expect(screen.getByText("Wildflowers")).toBeInTheDocument();

    const img = screen.getByAltText("Summit Peak");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("/api/asset?path=/photos/2024/07-14-hiking/summit.jpg");
  });
});
