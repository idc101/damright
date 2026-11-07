import { Photo, Source } from "../types";

export const normalizePath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

export const getPathParts = (fullPath: string): { folder: string; filename: string } => {
  const lastSlash = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
  if (lastSlash === -1) {
    return { folder: "", filename: fullPath };
  }
  const folder = fullPath.substring(0, lastSlash);
  const filename = fullPath.substring(lastSlash + 1);
  return { folder, filename };
};

export const getRelativeFolderPath = (fullPath: string, sources?: Source[]): string => {
  const { folder } = getPathParts(fullPath);
  if (!sources || sources.length === 0) return folder;

  const normalizedFolderPath = normalizePath(folder);
  const sortedSources = [...sources].sort((a, b) => b.path.length - a.path.length);
  for (const src of sortedSources) {
    const normalizedSourcePath = normalizePath(src.path);
    const rootName = src.name || normalizedSourcePath.split('/').filter(Boolean).pop() || '';
    if (normalizedFolderPath === normalizedSourcePath) {
      return rootName;
    }
    if (normalizedFolderPath.startsWith(normalizedSourcePath + '/')) {
      const sub = folder.substring(src.path.length).replace(/^[/\\]+/, '');
      return rootName ? `${rootName}/${sub}` : sub;
    }
  }
  return folder;
};

export const getRelativeFilePath = (fullPath: string, sources?: Source[]): string => {
  if (!sources || sources.length === 0) return fullPath;
  const normalizedPath = normalizePath(fullPath);
  const sortedSources = [...sources].sort((a, b) => b.path.length - a.path.length);
  for (const src of sortedSources) {
    const normalizedSourcePath = normalizePath(src.path);
    const rootName = src.name || normalizedSourcePath.split('/').filter(Boolean).pop() || '';
    if (normalizedPath === normalizedSourcePath) {
      return rootName;
    }
    if (normalizedPath.startsWith(normalizedSourcePath + '/')) {
      const sub = fullPath.substring(src.path.length).replace(/^[/\\]+/, '');
      return rootName ? `${rootName}/${sub}` : sub;
    }
  }
  return fullPath;
};

export const isInboxPhoto = (photo: Photo, sources?: Source[]): boolean => {
  const normPath = photo.path.replace(/\\/g, '/').toLowerCase();

  if (normPath.includes('/inbox/') || normPath.startsWith('inbox/') || normPath === 'inbox') {
    return true;
  }

  if (sources && sources.length > 0) {
    for (const src of sources) {
      const srcPath = src.path.replace(/\\/g, '/').toLowerCase();
      const srcName = src.name.toLowerCase();
      if (src.sync_mode === 'pull' || srcName === 'inbox' || srcPath.endsWith('/inbox')) {
        if (normPath === srcPath || normPath.startsWith(srcPath + '/')) {
          return true;
        }
      }
    }
  }

  return false;
};

export const getFormatRank = (photo: Photo): number => {
  const mime = photo.mime_type.toLowerCase();
  const ext = photo.path.split(".").pop()?.toLowerCase() || "";
  if (mime.includes("raw") || mime.includes("dng") || ["raw", "dng", "cr2", "nef", "arw"].includes(ext)) return 4;
  if (mime.includes("heic") || mime.includes("heif") || ext === "heic" || ext === "heif") return 3;
  if (mime.includes("jpeg") || mime.includes("jpg") || ext === "jpg" || ext === "jpeg") return 1;
  return 2;
};

export const comparePhotoQuality = (a: Photo, b: Photo, sources?: Source[]): number => {
  // 1. Non-inbox photos (sorted) have higher priority than Inbox photos
  const aInInbox = isInboxPhoto(a, sources);
  const bInInbox = isInboxPhoto(b, sources);
  if (aInInbox !== bInInbox) {
    return aInInbox ? -1 : 1;
  }

  // 2. Format rank (higher is better)
  const rankA = getFormatRank(a);
  const rankB = getFormatRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  // 3. Resolution (width * height)
  const resA = (a.width || 0) * (a.height || 0);
  const resB = (b.width || 0) * (b.height || 0);
  if (resA !== resB) {
    return resA - resB;
  }

  // 4. File size (larger size is better)
  const sizeA = a.file_size || 0;
  const sizeB = b.file_size || 0;
  if (sizeA !== sizeB) {
    return sizeA - sizeB;
  }

  // 5. Fallback tie-break by path
  return b.path.localeCompare(a.path);
};
