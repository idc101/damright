export interface Face {
  name: string;
  area_x?: number | null;
  area_y?: number | null;
  area_w?: number | null;
  area_h?: number | null;
}

export type MediaTypeFilter = "all" | "images" | "videos" | "markdown";

export interface Photo {
  id: string;
  path: string;
  thumb_path: string;
  exposure: number;
  rating: number;
  rejected: boolean;
  tags: string;
  orientation: number;
  mime_type: string;
  width?: number | null;
  height?: number | null;
  file_size?: number | null;
  camera_make?: string | null;
  camera_model?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  capture_time?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  location_name?: string | null;
  title?: string | null;
  description?: string | null;
  event?: string | null;
  faces?: Face[];
  crop_top?: number | null;
  crop_left?: number | null;
  crop_bottom?: number | null;
  crop_right?: number | null;
  crop_angle?: number | null;
  perceptual_hash?: string | null;
  portrait_blur?: number | null;
  validation_is_valid?: boolean;
  validation_issues?: string;
  in_quick_collection?: boolean;
  rank_score?: number;
  match_count?: number;
  suggested_rating?: number;
}

export interface RankingPair {
  photo_a: Photo;
  photo_b: Photo;
}

export interface RankingQuad {
  photos: Photo[];
}

export interface PhotoScoreUpdate {
  id: string;
  new_score: number;
  new_suggested_rating: number;
  is_winner: boolean;
}

export interface RankingStats {
  total_photos: number;
  total_matches: number;
  progress: number;
}

export interface RankingMatchResult {
  winner_id: string;
  winner_score: number;
  winner_suggested_rating: number;
  loser_id: string;
  loser_score: number;
  loser_suggested_rating: number;
}

export interface TagWithCount {
  name: string;
  count: number;
}

export interface PersonWithCount {
  name: string;
  count: number;
}

export interface Source {
  id: string;
  path: string;
  name: string;
  sync_mode?: 'push' | 'pull' | 'none';
  server_path?: string | null;
  archive_prefix?: string | null;
  rating_enabled?: boolean;
}

export interface Progress {
  message: string;
  current: number;
  total: number;
}

export interface DirEntry {
  name: string;
  path: string;
  children: DirEntry[];
  photo_count: number;
}

export interface ICloudPhoto {
  id: string;
  filename: string;
  date: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  local_path: string | null;
}

export interface ICloudDiffResult {
  matched_keep: ICloudPhoto[];
  matched_rejected: ICloudPhoto[];
  orphaned: ICloudPhoto[];
}

export interface FolderSyncRule {
  mode: 'push' | 'pull' | 'disabled' | 'none';
  archive_prefix?: string | null;
  client_path?: string | null;
  server_path?: string | null;
}

export interface ServerSyncConfig {
  endpoint: string;
  enabled: boolean;
  debounce_minutes: number;
  folder_rules?: Record<string, FolderSyncRule>;
}

export interface LocalConfig {
  library_path?: string;
  cache_path?: string;
  web_port: number;
}

export interface AppConfig {
  server_sync?: ServerSyncConfig | null;
  local: LocalConfig;
}

export interface SyncStatus {
  stage:
    | 'Idle'
    | { Debouncing: { remaining_secs: number } }
    | 'Scanning'
    | { Scanning: { current_step?: string; files_scanned?: number; current_folder?: string } }
    | { Syncing: { files_done: number; total_files: number; bytes_done: number; total_bytes: number; bytes_per_sec?: number; current_file?: string } }
    | { Success: { last_sync_time: string; files_synced: number } }
    | { Error: { message: string } };
  enabled: boolean;
  debounce_minutes: number;
}

export interface RuleDiagnostic {
  name: string;
  path: string;
  file_count: number;
  total_bytes: number;
}

export interface SyncDiagnosticsData {
  total_files: number;
  total_bytes: number;
  rules_breakdown: RuleDiagnostic[];
  extension_counts: Array<[string, number]>;
  sample_files: string[];
}
