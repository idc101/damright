import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";
import { RaterView } from "../components/views/RaterView";
import { MetadataInspectSection } from "../components/layout/MetadataInspectSection";
import { ApiService } from "../services/api";
import { ApiProvider } from "../services/ApiProvider";
import { Photo, RankingPair, RankingQuad, RankingStats } from "../types";
import { clearPreviewCache } from "../utils/previewCache";

beforeEach(() => {
  clearPreviewCache();
  localStorage.clear();
});

const mockPhotoA: Photo = {
  id: "photo_a",
  path: "/photos/beach.jpg",
  thumb_path: "/thumbs/beach.jpg",
  exposure: 0,
  rating: 2,
  rejected: false,
  tags: "vacation",
  orientation: 1,
  mime_type: "image/jpeg",
  rank_score: 1520,
  match_count: 3,
  suggested_rating: 2,
};

const mockPhotoB: Photo = {
  id: "photo_b",
  path: "/photos/mountain.jpg",
  thumb_path: "/thumbs/mountain.jpg",
  exposure: 0,
  rating: 1,
  rejected: false,
  tags: "nature",
  orientation: 1,
  mime_type: "image/jpeg",
  rank_score: 1680,
  match_count: 5,
  suggested_rating: 3,
};

const mockPhotoC: Photo = {
  id: "photo_c",
  path: "/photos/forest.jpg",
  thumb_path: "/thumbs/forest.jpg",
  exposure: 0,
  rating: 3,
  rejected: false,
  tags: "forest",
  orientation: 1,
  mime_type: "image/jpeg",
  rank_score: 1510,
  match_count: 2,
  suggested_rating: 3,
};

const mockPhotoD: Photo = {
  id: "photo_d",
  path: "/photos/city.jpg",
  thumb_path: "/thumbs/city.jpg",
  exposure: 0,
  rating: 4,
  rejected: false,
  tags: "city",
  orientation: 1,
  mime_type: "image/jpeg",
  rank_score: 1495,
  match_count: 1,
  suggested_rating: 4,
};

const mockPair: RankingPair = {
  photo_a: mockPhotoA,
  photo_b: mockPhotoB,
};

const mockQuad: RankingQuad = {
  photos: [mockPhotoA, mockPhotoB, mockPhotoC, mockPhotoD],
};

const mockStats: RankingStats = {
  total_photos: 10,
  total_matches: 4,
  progress: 40,
};

const createMockApi = (): ApiService => ({
  getAllPhotos: vi.fn().mockResolvedValue([mockPhotoA, mockPhotoB, mockPhotoC, mockPhotoD]),
  getAllTags: vi.fn().mockResolvedValue([]),
  getAllPeople: vi.fn().mockResolvedValue([]),
  getSources: vi.fn().mockResolvedValue([]),
  getDirTree: vi.fn().mockResolvedValue({ name: "root", path: "/", children: [], photo_count: 0 }),
  getAssetUrl: vi.fn((path) => `asset://${path}`),
  getPreviewUrl: vi.fn().mockResolvedValue("blob:http://localhost/mock"),
  setExposure: vi.fn().mockResolvedValue(undefined),
  setPortraitBlur: vi.fn().mockResolvedValue(undefined),
  setMetadata: vi.fn().mockResolvedValue(undefined),
  batchSetMetadata: vi.fn().mockResolvedValue(undefined),
  batchSetCaptureDate: vi.fn().mockResolvedValue(undefined),
  setCrop: vi.fn().mockResolvedValue(undefined),
  setRejected: vi.fn().mockResolvedValue(undefined),
  setEvent: vi.fn().mockResolvedValue(undefined),
  batchSetEvent: vi.fn().mockResolvedValue(undefined),
  autoRename: vi.fn().mockResolvedValue(0),
  movePhotos: vi.fn().mockResolvedValue(0),
  moveFolder: vi.fn().mockResolvedValue(0),
  exportPhotos: vi.fn().mockResolvedValue(0),
  addSource: vi.fn().mockResolvedValue(undefined),
  refreshFolder: vi.fn().mockResolvedValue([]),
  revealInFinder: vi.fn().mockResolvedValue(undefined),
  deletePhoto: vi.fn().mockResolvedValue(undefined),
  fixAllValidationIssues: vi.fn().mockResolvedValue(0),
  diffICloudPhotos: vi.fn().mockResolvedValue({ matched_keep: [], matched_rejected: [], orphaned: [] }),
  addPhotosToICloudAlbum: vi.fn().mockResolvedValue(0),
  getRankingPair: vi.fn().mockResolvedValue(mockPair),
  recordRankingMatch: vi.fn().mockResolvedValue({
    winner_id: "photo_a",
    winner_score: 1536,
    winner_suggested_rating: 2,
    loser_id: "photo_b",
    loser_score: 1664,
    loser_suggested_rating: 3,
  }),
  getRankingQuad: vi.fn().mockResolvedValue(mockQuad),
  recordRankingQuadMatch: vi.fn().mockResolvedValue([
    { id: "photo_a", new_score: 1544, new_suggested_rating: 2, is_winner: true },
    { id: "photo_b", new_score: 1672, new_suggested_rating: 3, is_winner: false },
    { id: "photo_c", new_score: 1502, new_suggested_rating: 3, is_winner: false },
    { id: "photo_d", new_score: 1487, new_suggested_rating: 4, is_winner: false },
  ]),
  getRankingStats: vi.fn().mockResolvedValue(mockStats),
  applySuggestedRatings: vi.fn().mockResolvedValue(2),
});

test("RaterView renders candidate pair and progress bar in 1 vs 1 mode", async () => {
  localStorage.setItem("rater_mode", "pair");
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByText("beach.jpg")).toBeInTheDocument();
    expect(screen.getByText("mountain.jpg")).toBeInTheDocument();
  });

  expect(screen.getByText(/Ranking Progress: 40%/i)).toBeInTheDocument();
  expect(screen.getByText(/4 duels completed/i)).toBeInTheDocument();
});

test("RaterView records vote when clicking card in 1 vs 1 mode", async () => {
  localStorage.setItem("rater_mode", "pair");
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-photo-a")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("vote-photo-a"));
  });

  expect(api.recordRankingMatch).toHaveBeenCalledWith("photo_a", "photo_b", false);
});

test("RaterView allows applying all suggestions", async () => {
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  const applyBtn = screen.getByRole("button", { name: /Apply All Suggestions/i });
  await act(async () => {
    fireEvent.click(applyBtn);
  });

  expect(api.applySuggestedRatings).toHaveBeenCalled();
});

test("RaterView loads and renders preview images for candidate photos", async () => {
  localStorage.setItem("rater_mode", "pair");
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(api.getPreviewUrl).toHaveBeenCalledWith(mockPhotoA, false);
    expect(api.getPreviewUrl).toHaveBeenCalledWith(mockPhotoB, false);
  });

  const previewImgs = screen.getAllByAltText("photo preview");
  expect(previewImgs).toHaveLength(2);
});

test("RaterView transitions smoothly to next pair after voting without spinner unmounting", async () => {
  localStorage.setItem("rater_mode", "pair");
  const nextPair: RankingPair = {
    photo_a: mockPhotoC,
    photo_b: mockPhotoD,
  };

  const api = createMockApi();
  let firstCall = true;
  api.getRankingPair = vi.fn().mockImplementation(async () => {
    if (firstCall) {
      firstCall = false;
      return mockPair;
    }
    return nextPair;
  });

  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByText("beach.jpg")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("vote-photo-a"));
  });

  await waitFor(() => {
    expect(screen.getByText("forest.jpg")).toBeInTheDocument();
    expect(screen.getByText("city.jpg")).toBeInTheDocument();
  });

  expect(screen.queryByText("Finding candidate pair...")).not.toBeInTheDocument();
  expect(api.getPreviewUrl).toHaveBeenCalledWith(mockPhotoC, false);
  expect(api.getPreviewUrl).toHaveBeenCalledWith(mockPhotoD, false);
});

test("RaterView renders candidate quad and key badges in Best of 4 mode", async () => {
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByText("beach.jpg")).toBeInTheDocument();
    expect(screen.getByText("mountain.jpg")).toBeInTheDocument();
    expect(screen.getByText("forest.jpg")).toBeInTheDocument();
    expect(screen.getByText("city.jpg")).toBeInTheDocument();
  });

  expect(screen.getByTestId("vote-photo-1")).toBeInTheDocument();
  expect(screen.getByTestId("vote-photo-2")).toBeInTheDocument();
  expect(screen.getByTestId("vote-photo-3")).toBeInTheDocument();
  expect(screen.getByTestId("vote-photo-4")).toBeInTheDocument();
});

test("RaterView records vote in Best of 4 mode when clicking card", async () => {
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-photo-2")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("vote-photo-2"));
  });

  expect(api.recordRankingQuadMatch).toHaveBeenCalledWith("photo_b", ["photo_a", "photo_c", "photo_d"], false);
});

test("RaterView records tie in Best of 4 mode when clicking Equal/Tie button", async () => {
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-quad-tie")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("vote-quad-tie"));
  });

  expect(api.recordRankingQuadMatch).toHaveBeenCalledWith(null, ["photo_a", "photo_b", "photo_c", "photo_d"], true);
});

test("RaterView records tie in Best of 4 mode with keyboard shortcut T", async () => {
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-quad-tie")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.keyDown(window, { key: "t" });
  });

  expect(api.recordRankingQuadMatch).toHaveBeenCalledWith(null, ["photo_a", "photo_b", "photo_c", "photo_d"], true);
});

test("RaterView votes with keyboard shortcut 3 in Best of 4 mode", async () => {
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-photo-3")).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.keyDown(window, { key: "3" });
  });

  expect(api.recordRankingQuadMatch).toHaveBeenCalledWith("photo_c", ["photo_a", "photo_b", "photo_d"], false);
});

test("RaterView toggles Unrated Only filter and appends rating:0 query", async () => {
  localStorage.setItem("rater_unrated_only", "false");
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} searchQuery="event:Vacation" />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("filter-unrated-btn")).toBeInTheDocument();
  });

  // Toggle Unrated Only on
  await act(async () => {
    fireEvent.click(screen.getByTestId("filter-unrated-btn"));
  });

  expect(localStorage.getItem("rater_unrated_only")).toBe("true");
  expect(api.getRankingQuad).toHaveBeenCalledWith("event:Vacation rating:0");
  expect(api.getRankingStats).toHaveBeenCalledWith("event:Vacation rating:0");
});

test("RaterView switches between Best of 4 and 1 vs 1 modes", async () => {
  const api = createMockApi();
  await act(async () => {
    render(
      <ApiProvider service={api}>
        <RaterView api={api} />
      </ApiProvider>
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-photo-1")).toBeInTheDocument();
  });

  // Switch to 1 vs 1
  await act(async () => {
    fireEvent.click(screen.getByTestId("mode-pair-btn"));
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-photo-a")).toBeInTheDocument();
  });
  expect(localStorage.getItem("rater_mode")).toBe("pair");

  // Switch back to Best of 4
  await act(async () => {
    fireEvent.click(screen.getByTestId("mode-quad-btn"));
  });

  await waitFor(() => {
    expect(screen.getByTestId("vote-photo-1")).toBeInTheDocument();
  });
  expect(localStorage.getItem("rater_mode")).toBe("quad");
});

test("MetadataInspectSection renders suggested rating and applies when requested", () => {
  const updateMetadata = vi.fn();
  render(
    <MetadataInspectSection
      photo={mockPhotoB}
      updateMetadata={updateMetadata}
    />
  );

  expect(screen.getByText(/Manual Rating/i)).toBeInTheDocument();
  expect(screen.getByText(/Suggested \(3★, 5 duels\)/i)).toBeInTheDocument();

  const applyBtn = screen.getByTestId("apply-suggested-rating-btn");
  expect(applyBtn).toBeInTheDocument();

  fireEvent.click(applyBtn);
  expect(updateMetadata).toHaveBeenCalledWith("photo_b", 3, "nature", "", "");
});

test("MetadataInspectSection hides suggested rating for video files", () => {
  const updateMetadata = vi.fn();
  const videoPhoto: Photo = {
    ...mockPhotoB,
    mime_type: "video/mp4",
    path: "/videos/vacation.mp4",
  };

  render(
    <MetadataInspectSection
      photo={videoPhoto}
      updateMetadata={updateMetadata}
    />
  );

  expect(screen.getByText(/Manual Rating/i)).toBeInTheDocument();
  expect(screen.queryByTestId("suggested-rating-group")).not.toBeInTheDocument();
});
