import { describe, test, expect } from "vitest";
import { normalizePath, getPathParts, getRelativeFolderPath, getRelativeFilePath, isInboxPhoto, comparePhotoQuality } from "../utils/pathUtils";
import { Photo, Source } from "../types";

describe("pathUtils", () => {
  const sources: Source[] = [
    { id: "1", path: "/Users/user/Pictures", name: "Pictures" },
    { id: "2", path: "/Users/user/Pictures/Archive", name: "Archive" },
    { id: "3", path: "/Users/user/Pictures/Inbox", name: "Inbox", sync_mode: "pull" },
  ];

  test("normalizePath normalizes slashes and strips trailing slashes", () => {
    expect(normalizePath("C:\\Users\\test\\folder\\")).toBe("C:/Users/test/folder");
    expect(normalizePath("/photos/2024/")).toBe("/photos/2024");
  });

  test("getPathParts separates folder and filename", () => {
    expect(getPathParts("/photos/2024/05/pic.jpg")).toEqual({
      folder: "/photos/2024/05",
      filename: "pic.jpg",
    });
    expect(getPathParts("pic.jpg")).toEqual({
      folder: "",
      filename: "pic.jpg",
    });
  });

  test("getRelativeFolderPath computes folder path relative to sources including root node", () => {
    expect(getRelativeFolderPath("/Users/user/Pictures/2024/05/pic.jpg", sources)).toBe("Pictures/2024/05");
    expect(getRelativeFolderPath("/Users/user/Pictures/pic.jpg", sources)).toBe("Pictures");
    expect(getRelativeFolderPath("/Users/user/Pictures/Archive/2023/pic.jpg", sources)).toBe("Archive/2023");
    expect(getRelativeFolderPath("/other/path/pic.jpg", sources)).toBe("/other/path");
    expect(getRelativeFolderPath("/Users/user/Pictures/2024/05/pic.jpg")).toBe("/Users/user/Pictures/2024/05");

    const onedriveSource: Source[] = [
      { id: "4", path: "/Users/user/Library/CloudStorage/OneDrive-Personal/Pictures/Documents", name: "Documents" }
    ];
    expect(
      getRelativeFolderPath(
        "/Users/user/Library/CloudStorage/OneDrive-Personal/Pictures/Documents/Inbox/My iPhone/Recents/IMG_0001.JPG",
        onedriveSource
      )
    ).toBe("Documents/Inbox/My iPhone/Recents");
  });

  test("getRelativeFilePath computes file path relative to sources including root node", () => {
    expect(getRelativeFilePath("/Users/user/Pictures/2024/05/pic.jpg", sources)).toBe("Pictures/2024/05/pic.jpg");
    expect(getRelativeFilePath("/Users/user/Pictures/pic.jpg", sources)).toBe("Pictures/pic.jpg");
    expect(getRelativeFilePath("/other/path/pic.jpg", sources)).toBe("/other/path/pic.jpg");

    const onedriveSource: Source[] = [
      { id: "4", path: "/Users/user/Library/CloudStorage/OneDrive-Personal/Pictures/Documents", name: "Documents" }
    ];
    expect(
      getRelativeFilePath(
        "/Users/user/Library/CloudStorage/OneDrive-Personal/Pictures/Documents/Inbox/My iPhone/Recents/IMG_0001.JPG",
        onedriveSource
      )
    ).toBe("Documents/Inbox/My iPhone/Recents/IMG_0001.JPG");
  });

  test("isInboxPhoto correctly identifies inbox files", () => {
    const photoInbox1: Photo = { id: "p1", path: "/Users/user/Pictures/Inbox/pic1.jpg", thumb_path: "", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg" };
    const photoInbox2: Photo = { id: "p2", path: "inbox/pic2.jpg", thumb_path: "", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg" };
    const photoSorted: Photo = { id: "p3", path: "/Users/user/Pictures/2024/05/pic3.jpg", thumb_path: "", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg" };

    expect(isInboxPhoto(photoInbox1, sources)).toBe(true);
    expect(isInboxPhoto(photoInbox2, sources)).toBe(true);
    expect(isInboxPhoto(photoSorted, sources)).toBe(false);
  });

  test("comparePhotoQuality prioritizes sorted non-inbox photos over inbox photos", () => {
    const photoInbox: Photo = { id: "p-inbox", path: "/Users/user/Pictures/Inbox/pic.jpg", thumb_path: "", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/dng", file_size: 25000000 };
    const photoSorted: Photo = { id: "p-sorted", path: "/Users/user/Pictures/2024/05/pic.jpg", thumb_path: "", exposure: 0, rating: 0, rejected: false, tags: "", orientation: 1, mime_type: "image/jpeg", file_size: 2000000 };

    // photoSorted should be higher quality rank than photoInbox despite photoInbox being DNG
    expect(comparePhotoQuality(photoSorted, photoInbox, sources)).toBeGreaterThan(0);
    expect(comparePhotoQuality(photoInbox, photoSorted, sources)).toBeLessThan(0);
  });
});
