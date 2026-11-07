import { Photo } from "../types";

export interface TimelineMonth {
  key: string;
  year: number;
  month: number;
  label: string;
  shortLabel: string;
  count: number;
  coverPhotos: Photo[];
  startIndex: number;
}

export interface TimelineYear {
  year: number | null;
  label: string;
  count: number;
  coverPhotos: Photo[];
  startIndex: number;
  months: TimelineMonth[];
}

export interface TimelineIndex {
  years: TimelineYear[];
  months: TimelineMonth[];
  totalPhotos: number;
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Formats a photo date for the header (e.g., "June 2026", "2026", "Undated", or "Photos" if undefined).
 */
export function formatPhotoDateHeader(photo: Photo | undefined): string {
  if (!photo) return "Photos";
  const parsed = parsePhotoDate(photo);
  if (parsed) {
    return `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
  }
  if (photo.capture_time && photo.capture_time.trim().length >= 4) {
    const y = photo.capture_time.trim().slice(0, 4);
    if (/^\d{4}$/.test(y)) {
      return y;
    }
  }
  return "Undated";
}

/**
 * Extracts year, month, day and normalized date string from a photo.
 */
export function parsePhotoDate(photo: Photo): {
  year: number;
  month: number;
  day: number;
  dateStr: string;
} | null {
  if (photo.capture_time) {
    const str = photo.capture_time.trim();
    const match = str.match(/^(\d{4})[-:/](\d{1,2})[-:/](\d{1,2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      if (year >= 1800 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          year,
          month,
          day,
          dateStr: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        };
      }
    }
  }

  // Fallback: Check filename for standard date prefix (e.g., YYYYMMDDTHHMMSS or YYYY-MM-DD)
  const filename = photo.path.split(/[/\\]/).pop() || "";
  const fnMatch = filename.match(/^(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  if (fnMatch) {
    const year = parseInt(fnMatch[1], 10);
    const month = parseInt(fnMatch[2], 10);
    const day = parseInt(fnMatch[3], 10);
    if (year >= 1800 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        year,
        month,
        day,
        dateStr: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
  }

  return null;
}

/**
 * Builds a chronological index of years and months from an array of photos.
 * Photos are expected to be sorted (typically ascending by capture_time).
 */
export function buildTimelineIndex(photos: Photo[]): TimelineIndex {
  const yearMap = new Map<number | null, {
    year: number | null;
    label: string;
    count: number;
    coverPhotos: Photo[];
    startIndex: number;
    monthsMap: Map<number, {
      month: number;
      label: string;
      shortLabel: string;
      count: number;
      coverPhotos: Photo[];
      startIndex: number;
    }>;
  }>();

  photos.forEach((photo, index) => {
    const parsed = parsePhotoDate(photo);
    const yearKey = parsed ? parsed.year : null;
    const yearLabel = yearKey !== null ? String(yearKey) : "Undated";

    if (!yearMap.has(yearKey)) {
      yearMap.set(yearKey, {
        year: yearKey,
        label: yearLabel,
        count: 0,
        coverPhotos: [],
        startIndex: index,
        monthsMap: new Map(),
      });
    }

    const yearData = yearMap.get(yearKey)!;
    yearData.count++;
    if (yearData.coverPhotos.length < 4) {
      yearData.coverPhotos.push(photo);
    }

    if (parsed) {
      const monthKey = parsed.month;
      if (!yearData.monthsMap.has(monthKey)) {
        yearData.monthsMap.set(monthKey, {
          month: monthKey,
          label: `${MONTH_NAMES[monthKey - 1]} ${parsed.year}`,
          shortLabel: SHORT_MONTH_NAMES[monthKey - 1],
          count: 0,
          coverPhotos: [],
          startIndex: index,
        });
      }

      const monthData = yearData.monthsMap.get(monthKey)!;
      monthData.count++;
      if (monthData.coverPhotos.length < 4) {
        monthData.coverPhotos.push(photo);
      }
    }
  });

  // Sort years (ascending: null/undated at the beginning, then earliest year to latest year)
  const sortedYears: TimelineYear[] = Array.from(yearMap.values())
    .sort((a, b) => {
      if (a.year === null) return -1;
      if (b.year === null) return 1;
      return a.year - b.year;
    })
    .map((y) => {
      // Sort months ascending (January -> December)
      const sortedMonths: TimelineMonth[] = Array.from(y.monthsMap.values())
        .sort((a, b) => a.month - b.month)
        .map((m) => ({
          key: `${y.year}-${String(m.month).padStart(2, "0")}`,
          year: y.year!,
          month: m.month,
          label: m.label,
          shortLabel: m.shortLabel,
          count: m.count,
          coverPhotos: m.coverPhotos,
          startIndex: m.startIndex,
        }));

      return {
        year: y.year,
        label: y.label,
        count: y.count,
        coverPhotos: y.coverPhotos,
        startIndex: y.startIndex,
        months: sortedMonths,
      };
    });

  // Flatten all months for direct month navigation
  const allMonths: TimelineMonth[] = [];
  sortedYears.forEach((y) => {
    y.months.forEach((m) => {
      allMonths.push(m);
    });
  });

  return {
    years: sortedYears,
    months: allMonths,
    totalPhotos: photos.length,
  };
}
