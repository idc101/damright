import { Photo, TagWithCount, PersonWithCount, Source, DirEntry, ICloudDiffResult, RankingPair, RankingQuad, PhotoScoreUpdate, RankingStats, RankingMatchResult } from "../types";
import { ApiService } from "./api";

export class HttpApiService implements ApiService {
  async getAllPhotos(query?: string): Promise<Photo[]> {
    const url = new URL("/api/photos", window.location.origin);
    if (query) url.searchParams.append("query", query);
    const res = await fetch(url.toString());
    return await res.json();
  }

  async getAllTags(): Promise<TagWithCount[]> {
    const res = await fetch("/api/tags");
    return await res.json();
  }

  async getAllPeople(): Promise<PersonWithCount[]> {
    const res = await fetch("/api/people");
    return await res.json();
  }

  async getSources(): Promise<Source[]> {
    const res = await fetch("/api/sources");
    return await res.json();
  }

  async getDirTree(path: string): Promise<DirEntry> {
    const res = await fetch(`/api/tree?path=${encodeURIComponent(path)}`);
    return await res.json();
  }

  getAssetUrl(path: string, isThumbnail?: boolean, version?: string): string {
    const params = new URLSearchParams();
    params.set("path", path);
    if (isThumbnail) params.set("thumb", "true");
    if (version) params.set("v", version);
    return `/api/asset?${params.toString()}`;
  }

  async getPreviewUrl(photo: Photo, uncropped?: boolean): Promise<string> {
    const version = [
      photo.exposure,
      photo.crop_top,
      photo.crop_left,
      photo.crop_bottom,
      photo.crop_right,
      photo.crop_angle,
      photo.portrait_blur,
      photo.orientation,
    ]
      .filter((v) => v !== undefined && v !== null && v !== 0)
      .join("_");
    const vParam = version ? `&v=${encodeURIComponent(version)}` : "";
    return `/api/preview?id=${photo.id}${uncropped ? "&uncropped=true" : ""}${vParam}`;
  }

  async setExposure(_id: string, _exposure: number): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async setPortraitBlur(_id: string, _portraitBlur: number): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async setMetadata(_id: string, _rating: number, _tags: string, _title: string, _description: string): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async batchSetMetadata(_ids: string[], _rating?: number, _tags?: string, _title?: string, _description?: string, _addTags?: string[], _removeTags?: string[]): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async batchSetCaptureDate(_updates: { id: string; captureTime: string }[]): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async setCrop(_id: string, _top: number | null, _left: number | null, _bottom: number | null, _right: number | null, _angle: number | null): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async setRejected(_id: string, _rejected: boolean): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async setEvent(_id: string, _event: string | null): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async batchSetEvent(_ids: string[], _event: string | null): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async autoRename(_path: string, _id?: string): Promise<number> {
    console.warn("Mutations not implemented in HTTP mode");
    return 0;
  }

  async movePhotos(_ids: string[], _destFolder: string): Promise<number> {
    console.warn("Mutations not implemented in HTTP mode");
    return 0;
  }

  async moveFolder(_srcPath: string, _destPath: string): Promise<number> {
    console.warn("Mutations not implemented in HTTP mode");
    return 0;
  }

  async exportPhotos(_config: any): Promise<number> {
    console.warn("exportPhotos not implemented in HTTP mode");
    return 0;
  }

  async addSource(_callback: (path: string) => void): Promise<void> {
    console.warn("Mutations not implemented in HTTP mode");
  }

  async refreshFolder(_path: string): Promise<Photo[]> {
    console.warn("Mutations not implemented in HTTP mode");
    return [];
  }

  async revealInFinder(_path: string): Promise<void> {
    console.warn("revealInFinder not supported in HTTP mode");
  }

  async deletePhoto(_id: string): Promise<void> {
    console.warn("deletePhoto not supported in HTTP mode");
  }

  async fixAllValidationIssues(_ids?: string[]): Promise<number> {
    console.warn("Mutations not implemented in HTTP mode");
    return 0;
  }

  async diffICloudPhotos(): Promise<ICloudDiffResult> {
    console.warn("diffICloudPhotos not implemented in HTTP mode");
    return { matched_keep: [], matched_rejected: [], orphaned: [] };
  }

  async addPhotosToICloudAlbum(_photoIds: string[]): Promise<number> {
    console.warn("addPhotosToICloudAlbum not implemented in HTTP mode");
    return 0;
  }

  async getInboxCount(): Promise<number> {
    return 0;
  }

  async updateInboxBadge(): Promise<number> {
    return 0;
  }

  async getRankingPair(_query?: string): Promise<RankingPair | null> {
    console.warn("getRankingPair not implemented in HTTP mode");
    return null;
  }

  async recordRankingMatch(_winnerId: string, _loserId: string, _isTie?: boolean): Promise<RankingMatchResult> {
    console.warn("recordRankingMatch not implemented in HTTP mode");
    return {
      winner_id: _winnerId,
      winner_score: 1500,
      winner_suggested_rating: 2,
      loser_id: _loserId,
      loser_score: 1500,
      loser_suggested_rating: 2,
    };
  }

  async getRankingQuad(_query?: string): Promise<RankingQuad | null> {
    console.warn("getRankingQuad not implemented in HTTP mode");
    return null;
  }

  async recordRankingQuadMatch(_winnerId: string | null, _loserIds: string[], _isTie?: boolean): Promise<PhotoScoreUpdate[]> {
    console.warn("recordRankingQuadMatch not implemented in HTTP mode");
    return [];
  }

  async getRankingStats(_query?: string): Promise<RankingStats> {
    console.warn("getRankingStats not implemented in HTTP mode");
    return {
      total_photos: 0,
      total_matches: 0,
      progress: 0,
    };
  }

  async applySuggestedRatings(_ids?: string[]): Promise<number> {
    console.warn("applySuggestedRatings not implemented in HTTP mode");
    return 0;
  }
}
