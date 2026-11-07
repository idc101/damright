import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Photo, TagWithCount, PersonWithCount, Source, DirEntry, ICloudDiffResult, RankingPair, RankingQuad, PhotoScoreUpdate, RankingStats, RankingMatchResult } from "../types";
import { ApiService } from "./api";

export class TauriApiService implements ApiService {
  async getAllPhotos(query?: string): Promise<Photo[]> {
    return await invoke("get_all_photos", { query });
  }

  async getAllTags(): Promise<TagWithCount[]> {
    return await invoke("get_all_tags");
  }

  async getAllPeople(): Promise<PersonWithCount[]> {
    return await invoke("get_all_people");
  }

  async getSources(): Promise<Source[]> {
    return await invoke("get_all_sources");
  }

  async getDirTree(path: string): Promise<DirEntry> {
    return await invoke("get_dir_tree", { path });
  }

  getAssetUrl(path: string, _isThumbnail?: boolean, _version?: string): string {
    return convertFileSrc(path);
  }

  async getPreviewUrl(photo: Photo, uncropped?: boolean): Promise<string> {
    const path = await invoke<string | null>("get_preview", { photo, uncropped });
    if (!path) {
      return convertFileSrc(photo.path);
    }
    return convertFileSrc(path);
  }

  async setExposure(id: string, exposure: number): Promise<void> {
    await invoke("set_exposure", { id, exposure });
  }

  async setPortraitBlur(id: string, portraitBlur: number): Promise<void> {
    await invoke("set_portrait_blur", { id, portrait_blur: portraitBlur });
  }

  async setMetadata(id: string, rating: number, tags: string, title: string, description: string): Promise<void> {
    await invoke("set_metadata", { id, rating, tags, title, description });
  }

  async batchSetMetadata(ids: string[], rating?: number, tags?: string, title?: string, description?: string, addTags?: string[], removeTags?: string[]): Promise<void> {
    await invoke("batch_set_metadata", { ids, rating, tags, title, description, addTags, removeTags });
  }

  async batchSetCaptureDate(updates: { id: string; captureTime: string }[]): Promise<void> {
    await invoke("batch_set_capture_date", { updates });
  }

  async setCrop(id: string, top: number | null, left: number | null, bottom: number | null, right: number | null, angle: number | null): Promise<void> {
    await invoke("set_crop", { id, top, left, bottom, right, angle });
  }

  async setRejected(id: string, rejected: boolean): Promise<void> {
    await invoke("set_rejected", { id, rejected });
  }

  async setEvent(id: string, event: string | null): Promise<void> {
    await invoke("set_event", { id, event });
  }

  async batchSetEvent(ids: string[], event: string | null): Promise<void> {
    await invoke("batch_set_event", { ids, event });
  }

  async autoRename(path: string, id?: string): Promise<number> {
    return await invoke("auto_rename", { path, id });
  }

  async movePhotos(ids: string[], destFolder: string): Promise<number> {
    return await invoke("move_photos", { ids, destFolder });
  }

  async moveFolder(srcPath: string, destPath: string): Promise<number> {
    return await invoke("move_folder", { srcPath, destPath });
  }

  async exportPhotos(config: any): Promise<number> {
    return await invoke("export_photos", { config });
  }

  async addSource(callback: (path: string) => void): Promise<void> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected && typeof selected === "string") {
      await invoke("add_source", { path: selected });
      callback(selected);
    }
  }

  async refreshFolder(path: string): Promise<Photo[]> {
    return await invoke("refresh_folder", { folderPath: path });
  }

  async revealInFinder(path: string): Promise<void> {
    return await invoke("reveal_in_finder", { path });
  }

  async deletePhoto(id: string): Promise<void> {
    await invoke("delete_photo", { id });
  }

  async fixAllValidationIssues(ids?: string[]): Promise<number> {
    return await invoke("fix_all_validation_issues", { ids: ids || null });
  }

  async diffICloudPhotos(): Promise<ICloudDiffResult> {
    return await invoke("diff_icloud_photos");
  }

  async addPhotosToICloudAlbum(photoIds: string[]): Promise<number> {
    return await invoke("add_photos_to_icloud_album", { photoIds });
  }

  async getInboxCount(): Promise<number> {
    return await invoke("get_inbox_count");
  }

  async updateInboxBadge(): Promise<number> {
    return await invoke("update_inbox_badge");
  }

  async getRankingPair(query?: string): Promise<RankingPair | null> {
    return await invoke("get_ranking_pair", { query });
  }

  async recordRankingMatch(winnerId: string, loserId: string, isTie?: boolean): Promise<RankingMatchResult> {
    return await invoke("record_ranking_match", { winnerId, loserId, isTie });
  }

  async getRankingQuad(query?: string): Promise<RankingQuad | null> {
    return await invoke("get_ranking_quad", { query });
  }

  async recordRankingQuadMatch(winnerId: string | null, loserIds: string[], isTie?: boolean): Promise<PhotoScoreUpdate[]> {
    return await invoke("record_ranking_quad_match", { winnerId, loserIds, isTie: isTie || false });
  }

  async getRankingStats(query?: string): Promise<RankingStats> {
    return await invoke("get_ranking_stats", { query });
  }

  async applySuggestedRatings(ids?: string[]): Promise<number> {
    return await invoke("apply_suggested_ratings", { ids: ids || null });
  }
}
