import { Photo, TagWithCount, PersonWithCount, Source, DirEntry, ICloudDiffResult, RankingPair, RankingQuad, PhotoScoreUpdate, RankingStats, RankingMatchResult } from "../types";
import { ExportConfig } from "../components/common/ExportModal";

export interface ApiService {
  getAllPhotos(query?: string): Promise<Photo[]>;
  getAllTags(): Promise<TagWithCount[]>;
  getAllPeople(): Promise<PersonWithCount[]>;
  getSources(): Promise<Source[]>;
  getDirTree(path: string): Promise<DirEntry>;
  getAssetUrl(path: string, isThumbnail?: boolean, version?: string): string;
  getPreviewUrl(photo: Photo, uncropped?: boolean): Promise<string>;
  
  // Mutations (may be no-ops in read-only web mode)
  setExposure(id: string, exposure: number): Promise<void>;
  setPortraitBlur(id: string, portraitBlur: number): Promise<void>;
  setMetadata(id: string, rating: number, tags: string, title: string, description: string): Promise<void>;
  batchSetMetadata(ids: string[], rating?: number, tags?: string, title?: string, description?: string, addTags?: string[], removeTags?: string[]): Promise<void>;
  batchSetCaptureDate(updates: { id: string; captureTime: string }[]): Promise<void>;
  setCrop(id: string, top: number | null, left: number | null, bottom: number | null, right: number | null, angle: number | null): Promise<void>;
  setRejected(id: string, rejected: boolean): Promise<void>;
  setEvent(id: string, event: string | null): Promise<void>;
  batchSetEvent(ids: string[], event: string | null): Promise<void>;
  autoRename(path: string, id?: string): Promise<number>;
  movePhotos(ids: string[], destFolder: string): Promise<number>;
  moveFolder(srcPath: string, destPath: string): Promise<number>;
  exportPhotos(config: ExportConfig): Promise<number>;
  addSource(callback: (path: string) => void): Promise<void>;
  refreshFolder(path: string): Promise<Photo[]>;
  revealInFinder(path: string): Promise<void>;
  deletePhoto(id: string): Promise<void>;
  fixAllValidationIssues(ids?: string[]): Promise<number>;
  diffICloudPhotos(): Promise<ICloudDiffResult>;
  addPhotosToICloudAlbum(photoIds: string[]): Promise<number>;
  getInboxCount?(): Promise<number>;
  updateInboxBadge?(): Promise<number>;

  // Ranking & Suggestions
  getRankingPair(query?: string): Promise<RankingPair | null>;
  recordRankingMatch(winnerId: string, loserId: string, isTie?: boolean): Promise<RankingMatchResult>;
  getRankingQuad(query?: string): Promise<RankingQuad | null>;
  recordRankingQuadMatch(winnerId: string | null, loserIds: string[], isTie?: boolean): Promise<PhotoScoreUpdate[]>;
  getRankingStats(query?: string): Promise<RankingStats>;
  applySuggestedRatings(ids?: string[]): Promise<number>;
}

