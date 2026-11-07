import { describe, it, expect } from "vitest";
import { parseSlideshowParams, buildSlideshowUrl } from "../utils/slideshowParams";

describe("slideshowParams", () => {
  it("parses empty search string with defaults", () => {
    const config = parseSlideshowParams("");
    expect(config.interval).toBe(300);
    expect(config.kenBurns).toBe(false);
    expect(config.searchQuery).toBe("");
    expect(config.includedTags).toEqual([]);
    expect(config.excludedTags).toEqual([]);
  });

  it("parses date after and specific tag with exclusions", () => {
    const config = parseSlideshowParams(
      "?after=2009&tag=Family&exclude_tag=Private&interval=15&kenBurns=true"
    );
    expect(config.interval).toBe(15);
    expect(config.kenBurns).toBe(true);
    expect(config.after).toBe("2009");
    expect(config.includedTags).toEqual(["Family"]);
    expect(config.excludedTags).toEqual(["Private"]);
    expect(config.searchQuery).toBe("after:2009 tag:Family -tag:Private");
  });

  it("parses multiple tags, people and rating", () => {
    const config = parseSlideshowParams(
      "?tags=Vacation,Beach&exclude_tags=Screenshots,Blur&person=Alice&exclude_person=Bob&min_rating=4&year=2021"
    );
    expect(config.year).toBe("2021");
    expect(config.includedTags).toEqual(["Vacation", "Beach"]);
    expect(config.excludedTags).toEqual(["Screenshots", "Blur"]);
    expect(config.includedPeople).toEqual(["Alice"]);
    expect(config.excludedPeople).toEqual(["Bob"]);
    expect(config.minRating).toBe(4);
    expect(config.searchQuery).toBe(
      "year:2021 tag:Vacation tag:Beach -tag:Screenshots -tag:Blur person:Alice -person:Bob rating:>=4"
    );
  });

  it("builds a clean slideshow URL", () => {
    const url = buildSlideshowUrl({
      after: "2009",
      includedTags: ["Family"],
      excludedTags: ["Private"],
      interval: 15,
      kenBurns: true,
    });
    expect(url).toBe(
      "/slideshow?interval=15&kenBurns=true&after=2009&tags=Family&exclude_tags=Private"
    );
  });

  it("builds a full URL with origin for Kiosk mode", () => {
    const url = buildSlideshowUrl(
      {
        after: "2009",
        includedTags: ["Family"],
        excludedTags: ["Private"],
        interval: 20,
        kenBurns: true,
      },
      "http://192.168.1.100:8010"
    );
    expect(url).toBe(
      "http://192.168.1.100:8010/slideshow?interval=20&kenBurns=true&after=2009&tags=Family&exclude_tags=Private"
    );
  });

  it("parses sleep mode parameters correctly", () => {
    const config1 = parseSlideshowParams("?sleep=21:00-06:30");
    expect(config1.sleepMode).toBe(true);
    expect(config1.sleepStart).toBe("21:00");
    expect(config1.sleepEnd).toBe("06:30");

    const config2 = parseSlideshowParams("?sleep_start=22:00&sleep_end=07:00");
    expect(config2.sleepMode).toBe(true);
    expect(config2.sleepStart).toBe("22:00");
    expect(config2.sleepEnd).toBe("07:00");
  });

  it("builds a clean slideshow URL with sleep mode", () => {
    const url = buildSlideshowUrl({
      interval: 15,
      sleepMode: true,
      sleepStart: "21:00",
      sleepEnd: "06:30",
    });
    expect(url).toBe("/slideshow?interval=15&sleep=21%3A00-06%3A30");
  });
});
