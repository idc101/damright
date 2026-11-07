export function filenameToDescription(filename: string, picturesBase: string): string | null {
  // Handle differences in forward/backward slashes
  const normalizedFilename = filename.replace(/\\/g, '/');
  const normalizedBase = picturesBase.replace(/\\/g, '/');

  let baseName: string | null = null;
  if (normalizedBase && normalizedFilename.startsWith(normalizedBase)) {
    baseName = normalizedFilename.substring(normalizedBase.length);
  } else if (filename.startsWith(picturesBase) && picturesBase !== "") {
    baseName = filename.substring(picturesBase.length);
  } else {
    // Fallback if no matching base, use basename of folder + file
    const parts = normalizedFilename.split('/');
    if (parts.length > 1) {
      baseName = parts.slice(-2).join('/');
    } else {
      baseName = filename;
    }
  }

  if (baseName.startsWith('/')) baseName = baseName.substring(1);

  let current = baseName;
  // Remove file extension
  current = current.replace(/\.[^/.]+$/, "");
  // Strip YYYY/ directories prefix
  current = current.replace(/^\d{4}\//g, "");
  // Strip YYYY-MM-DD or YYYY-MM or MM-DD prefixes or folder components
  current = current.replace(/^(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{2}-\d{2})[\/ -]/g, "");
  // Strip YYYYMMDDTHHMMSS timestamp with optional -hash suffix
  current = current.replace(/\d{8}T\d{6}(-\w+)?/g, "");
  // Strip remaining hash suffixes e.g. -abc
  current = current.replace(/-\w{1,4}$/g, "");
  // Strip device names
  current = current.replace(/IMG_\d{4}/g, "");
  // Strip other common camera names
  current = current.replace(/DCS_\d{4}/g, "");

  // Strip non-alphanumeric characters from start and end
  current = current.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");

  return current || null;
}

/**
 * Formats a Date or EXIF timestamp into the standard format: Day DD Month YYYY (e.g. "Sun 28 Oct 2024")
 */
export function formatExifDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  // EXIF format is typically "YYYY:MM:DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS"
  const match = dateStr.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const monthIndex = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const seconds = parseInt(match[6], 10);

    const d = new Date(year, monthIndex, day, hours, minutes, seconds);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Validate if the Date parsed correctly
    if (!isNaN(d.getTime())) {
      return `${days[d.getDay()]} ${day} ${months[monthIndex]} ${year}`;
    }
  }

  // Fallback to standard javascript date parser if possible
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[parsed.getDay()]} ${parsed.getDate()} ${months[parsed.getMonth()]} ${parsed.getFullYear()}`;
  }

  return dateStr;
}
