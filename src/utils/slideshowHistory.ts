import { Photo } from "../types";

export const LOCAL_STORAGE_LAST_SEEN_KEY = "slideshow_last_seen";

/**
 * Retrieves the map of photo IDs to last-seen timestamps (in seconds).
 */
export function getPhotoLastSeenMap(): Record<string, number> {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_LAST_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.error("Failed to parse slideshow last seen map:", err);
  }
  return {};
}

/**
 * Records that a photo was displayed at the current timestamp.
 * Automatically bounds the localStorage map to prevent memory bloat.
 */
export function recordPhotoSeen(photoId: string): void {
  if (!photoId || typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const map = getPhotoLastSeenMap();
    const nowSec = Math.floor(Date.now() / 1000);
    map[photoId] = nowSec;

    // Prune if map exceeds 20,000 entries (remove oldest entries)
    const keys = Object.keys(map);
    if (keys.length > 20000) {
      const sortedKeys = keys.sort((a, b) => (map[a] || 0) - (map[b] || 0));
      const toRemove = sortedKeys.slice(0, keys.length - 15000);
      for (const k of toRemove) {
        delete map[k];
      }
    }

    localStorage.setItem(LOCAL_STORAGE_LAST_SEEN_KEY, JSON.stringify(map));
  } catch (err) {
    console.error("Failed to record photo seen timestamp:", err);
  }
}

/**
 * Clears all slideshow history in localStorage.
 */
export function clearPhotoHistory(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.removeItem(LOCAL_STORAGE_LAST_SEEN_KEY);
  }
}

/**
 * Standard in-place Fisher-Yates shuffle on an array copy.
 */
export function fisherYatesShuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Recency-aware weighted shuffle:
 * 1. Groups photos into recency tiers based on when they were last shown.
 * 2. Unseen photos come first, followed by photos seen longest ago.
 * 3. Photos seen recently are placed at the end of the queue.
 * 4. Each tier is shuffled using Fisher-Yates to maintain complete intra-tier randomness.
 */
export function shufflePhotosWithRecency(photos: Photo[]): Photo[] {
  if (photos.length <= 1) return [...photos];

  const lastSeenMap = getPhotoLastSeenMap();
  const nowSec = Math.floor(Date.now() / 1000);

  const ONE_DAY = 86400;
  const SEVEN_DAYS = 7 * ONE_DAY;
  const THIRTY_DAYS = 30 * ONE_DAY;

  const tierUnseen: Photo[] = [];
  const tierStale: Photo[] = []; // > 30 days ago
  const tierMedium: Photo[] = []; // 7 to 30 days ago
  const tierRecent: Photo[] = []; // 1 to 7 days ago
  const tierVeryRecent: Photo[] = []; // < 1 day ago

  for (const photo of photos) {
    const seenAt = lastSeenMap[photo.id];
    if (!seenAt) {
      tierUnseen.push(photo);
    } else {
      const age = nowSec - seenAt;
      if (age >= THIRTY_DAYS) {
        tierStale.push(photo);
      } else if (age >= SEVEN_DAYS) {
        tierMedium.push(photo);
      } else if (age >= ONE_DAY) {
        tierRecent.push(photo);
      } else {
        tierVeryRecent.push(photo);
      }
    }
  }

  // If all photos fall into very recent or recent tiers (e.g. small collection),
  // subdivide them by exact seenAt timestamp into quantiles so least-recently-seen come first
  if (tierUnseen.length === 0 && tierStale.length === 0 && tierMedium.length === 0) {
    const sorted = [...photos].sort((a, b) => {
      const timeA = lastSeenMap[a.id] || 0;
      const timeB = lastSeenMap[b.id] || 0;
      return timeA - timeB;
    });

    // Chunk into 4 quantile batches and shuffle each batch
    const chunkSize = Math.max(1, Math.ceil(sorted.length / 4));
    const result: Photo[] = [];
    for (let i = 0; i < sorted.length; i += chunkSize) {
      const chunk = sorted.slice(i, i + chunkSize);
      result.push(...fisherYatesShuffle(chunk));
    }
    return result;
  }

  // Shuffle within each tier and concatenate
  return [
    ...fisherYatesShuffle(tierUnseen),
    ...fisherYatesShuffle(tierStale),
    ...fisherYatesShuffle(tierMedium),
    ...fisherYatesShuffle(tierRecent),
    ...fisherYatesShuffle(tierVeryRecent),
  ];
}

/**
 * Checks whether the current time falls inside a sleep window (e.g. "21:00" to "06:30").
 */
export function isInSleepWindow(
  sleepStart?: string,
  sleepEnd?: string,
  now: Date = new Date()
): boolean {
  if (!sleepStart || !sleepEnd || sleepStart === sleepEnd) {
    return false;
  }

  const parseTime = (str: string): number | null => {
    const parts = str.split(":");
    if (parts.length !== 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  };

  const startMinutes = parseTime(sleepStart);
  const endMinutes = parseTime(sleepEnd);

  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes > endMinutes) {
    // Overnight window (e.g. 21:00 to 06:30 -> 1260 to 390)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    // Same-day window (e.g. 13:00 to 15:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}
