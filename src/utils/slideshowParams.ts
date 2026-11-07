export interface SlideshowConfig {
  interval: number;
  kenBurns: boolean;
  searchQuery: string;
  after?: string;
  before?: string;
  year?: string;
  includedTags: string[];
  excludedTags: string[];
  includedPeople: string[];
  excludedPeople: string[];
  minRating?: number;
  shuffle: boolean;
  story: boolean;
  sleepMode?: boolean;
  sleepStart?: string;
  sleepEnd?: string;
}

/**
 * Splits comma-separated or multi-value query strings into trimmed arrays.
 */
function splitList(val: string | null): string[] {
  if (!val) return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse URL search parameters into a normalized SlideshowConfig object.
 */
export function parseSlideshowParams(
  search?: string | URLSearchParams | Location
): SlideshowConfig {
  let params: URLSearchParams;
  if (!search) {
    params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  } else if (typeof search === "string") {
    const qIndex = search.indexOf("?");
    params = new URLSearchParams(qIndex !== -1 ? search.slice(qIndex) : search);
  } else if (search instanceof URLSearchParams) {
    params = search;
  } else if ("search" in search) {
    params = new URLSearchParams(search.search);
  } else {
    params = new URLSearchParams();
  }

  // Parse interval
  const intervalParam = params.get("interval") || params.get("speed");
  const parsedInterval = intervalParam ? parseInt(intervalParam, 10) : 300;
  const interval = isNaN(parsedInterval) || parsedInterval <= 0 ? 300 : parsedInterval;

  // Parse kenBurns
  const kbParam = params.get("kenBurns") || params.get("kenburns") || params.get("kb");
  const kenBurns = kbParam === "true" || kbParam === "1";

  // Parse shuffle
  const shuffleParam = params.get("shuffle");
  const shuffle = shuffleParam !== "false" && shuffleParam !== "0";

  // Parse story
  const storyParam = params.get("story");
  const story = storyParam !== "false" && storyParam !== "0";

  // Parse dates
  const after = params.get("after") || params.get("since") || params.get("from") || undefined;
  const before = params.get("before") || params.get("until") || params.get("to") || undefined;
  const year = params.get("year") || params.get("years") || undefined;

  // Parse tags
  const rawTags = params.get("tag") || params.get("tags") || "";
  const includedTags = splitList(rawTags);

  const rawExcludeTags =
    params.get("exclude_tag") ||
    params.get("exclude_tags") ||
    params.get("not_tag") ||
    params.get("not_tags") ||
    "";
  const excludedTags = splitList(rawExcludeTags);

  // Parse people
  const rawPeople = params.get("person") || params.get("people") || "";
  const includedPeople = splitList(rawPeople);

  const rawExcludePeople =
    params.get("exclude_person") ||
    params.get("exclude_people") ||
    params.get("not_person") ||
    params.get("not_people") ||
    "";
  const excludedPeople = splitList(rawExcludePeople);

  // Parse rating
  const ratingParam = params.get("min_rating") || params.get("rating");
  const parsedRating = ratingParam ? parseInt(ratingParam, 10) : undefined;
  const minRating = parsedRating && !isNaN(parsedRating) ? parsedRating : undefined;

  // Compose search query tokens
  const queryTokens: string[] = [];

  // If a raw query param is provided, start with it
  const rawQuery = params.get("query") || params.get("q");
  if (rawQuery) {
    queryTokens.push(rawQuery.trim());
  }

  if (after) {
    queryTokens.push(`after:${after}`);
  }
  if (before) {
    queryTokens.push(`before:${before}`);
  }
  if (year) {
    queryTokens.push(`year:${year}`);
  }

  includedTags.forEach((t) => queryTokens.push(`tag:${t}`));
  excludedTags.forEach((t) => queryTokens.push(`-tag:${t}`));

  includedPeople.forEach((p) => queryTokens.push(`person:${p}`));
  excludedPeople.forEach((p) => queryTokens.push(`-person:${p}`));

  if (minRating !== undefined) {
    queryTokens.push(`rating:>=${minRating}`);
  }

  const searchQuery = queryTokens.join(" ").trim();

  // Parse sleep mode
  const sleepParam = params.get("sleep") || params.get("sleep_mode") || params.get("night");
  let sleepMode = false;
  let sleepStart = "21:00";
  let sleepEnd = "06:30";

  if (sleepParam) {
    if (sleepParam.includes("-")) {
      const [s, e] = sleepParam.split("-");
      if (s && e) {
        sleepMode = true;
        sleepStart = s.trim();
        sleepEnd = e.trim();
      }
    } else if (sleepParam === "true" || sleepParam === "1") {
      sleepMode = true;
    }
  }

  const sleepStartParam = params.get("sleep_start");
  if (sleepStartParam) {
    sleepStart = sleepStartParam.trim();
    sleepMode = true;
  }
  const sleepEndParam = params.get("sleep_end");
  if (sleepEndParam) {
    sleepEnd = sleepEndParam.trim();
    sleepMode = true;
  }

  return {
    interval,
    kenBurns,
    searchQuery,
    after,
    before,
    year,
    includedTags,
    excludedTags,
    includedPeople,
    excludedPeople,
    minRating,
    shuffle,
    story,
    sleepMode,
    sleepStart,
    sleepEnd,
  };
}

/**
 * Serialize a SlideshowConfig or filter options into a URL query string or full URL.
 */
export function buildSlideshowUrl(
  config: Partial<SlideshowConfig>,
  origin?: string
): string {
  const params = new URLSearchParams();

  if (config.interval && config.interval !== 300) {
    params.set("interval", config.interval.toString());
  }

  if (config.kenBurns) {
    params.set("kenBurns", "true");
  }

  if (config.sleepMode) {
    const s = config.sleepStart || "21:00";
    const e = config.sleepEnd || "06:30";
    params.set("sleep", `${s}-${e}`);
  }

  if (config.after) {
    params.set("after", config.after);
  }

  if (config.before) {
    params.set("before", config.before);
  }

  if (config.year) {
    params.set("year", config.year);
  }

  if (config.includedTags && config.includedTags.length > 0) {
    params.set("tags", config.includedTags.join(","));
  }

  if (config.excludedTags && config.excludedTags.length > 0) {
    params.set("exclude_tags", config.excludedTags.join(","));
  }

  if (config.includedPeople && config.includedPeople.length > 0) {
    params.set("people", config.includedPeople.join(","));
  }

  if (config.excludedPeople && config.excludedPeople.length > 0) {
    params.set("exclude_people", config.excludedPeople.join(","));
  }

  if (config.minRating) {
    params.set("min_rating", config.minRating.toString());
  }

  if (config.shuffle === false) {
    params.set("shuffle", "false");
  }

  if (config.story === false) {
    params.set("story", "false");
  }

  const queryString = params.toString();
  const path = `/slideshow${queryString ? `?${queryString}` : ""}`;

  if (origin) {
    const cleanOrigin = origin.replace(/\/+$/, "");
    return `${cleanOrigin}${path}`;
  }

  return path;
}
