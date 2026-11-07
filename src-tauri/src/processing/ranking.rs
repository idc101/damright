use rusqlite::{params, Connection};
use rand::seq::SliceRandom;
use crate::models::{Photo, RankingPair, RankingQuad, PhotoScoreUpdate, RankingStats, RankingMatchResult};
use crate::db::photo_repo;
use crate::processing::metadata::xmp::write_xmp;

pub fn calculate_initial_score(rating: u8) -> f64 {
    match rating {
        1 => 1200.0,
        2 => 1350.0,
        3 => 1500.0,
        4 => 1650.0,
        5 => 1800.0,
        _ => 1500.0,
    }
}

pub fn score_to_suggested_rating(score: f64) -> u8 {
    if score < 1275.0 {
        1
    } else if score < 1425.0 {
        2
    } else if score < 1575.0 {
        3
    } else if score < 1725.0 {
        4
    } else {
        5
    }
}

pub fn adjust_score_for_rating_change(
    current_score: f64,
    old_rating: u8,
    new_rating: u8,
    match_count: u32,
) -> (f64, u8) {
    if match_count == 0 {
        let score = calculate_initial_score(new_rating);
        let suggested = if new_rating == 0 { 3 } else { new_rating };
        (score, suggested)
    } else {
        let old_baseline = calculate_initial_score(old_rating);
        let new_baseline = calculate_initial_score(new_rating);
        let new_score = ((current_score + new_baseline - old_baseline) * 10.0).round() / 10.0;
        let suggested = score_to_suggested_rating(new_score);
        (new_score, suggested)
    }
}

pub fn calculate_elo(winner_score: f64, loser_score: f64, is_tie: bool) -> (f64, f64) {
    let k_factor = 32.0;
    let expected_win_a = 1.0 / (1.0 + 10.0_f64.powf((loser_score - winner_score) / 400.0));
    let expected_win_b = 1.0 - expected_win_a;

    let (score_a, score_b) = if is_tie {
        (0.5, 0.5)
    } else {
        (1.0, 0.0)
    };

    let new_winner_score = winner_score + k_factor * (score_a - expected_win_a);
    let new_loser_score = loser_score + k_factor * (score_b - expected_win_b);

    (
        (new_winner_score * 10.0).round() / 10.0,
        (new_loser_score * 10.0).round() / 10.0,
    )
}

pub fn calculate_plackett_luce(
    winner_score: f64,
    loser_scores: &[f64],
) -> (f64, Vec<f64>) {
    let k_factor = 32.0;
    let mut all_scores = vec![winner_score];
    all_scores.extend_from_slice(loser_scores);

    let max_score = all_scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let exps: Vec<f64> = all_scores
        .iter()
        .map(|s| 10.0_f64.powf((s - max_score) / 400.0))
        .collect();
    let sum_exp: f64 = exps.iter().sum();

    let p_winner = exps[0] / sum_exp;
    let new_winner_score = ((winner_score + k_factor * (1.0 - p_winner)) * 10.0).round() / 10.0;

    let mut new_loser_scores = Vec::new();
    for (i, loser_score) in loser_scores.iter().enumerate() {
        let p_loser = exps[i + 1] / sum_exp;
        let new_score = ((loser_score - k_factor * p_loser) * 10.0).round() / 10.0;
        new_loser_scores.push(new_score);
    }

    (new_winner_score, new_loser_scores)
}

pub fn calculate_plackett_luce_tie(scores: &[f64]) -> Vec<f64> {
    let k_factor = 32.0;
    let n = scores.len() as f64;
    let max_score = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let exps: Vec<f64> = scores
        .iter()
        .map(|s| 10.0_f64.powf((s - max_score) / 400.0))
        .collect();
    let sum_exp: f64 = exps.iter().sum();

    let mut new_scores = Vec::new();
    for &score in scores.iter() {
        let p = 10.0_f64.powf((score - max_score) / 400.0) / sum_exp;
        let new_score = ((score + k_factor * ((1.0 / n) - p)) * 10.0).round() / 10.0;
        new_scores.push(new_score);
    }
    new_scores
}

pub fn is_video_asset(photo: &Photo) -> bool {
    if photo.mime_type.starts_with("video/") {
        return true;
    }
    let ext = std::path::Path::new(&photo.path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(ext.as_str(), "mp4" | "mov" | "m4v" | "mkv" | "avi" | "webm")
}

pub fn is_markdown_asset(photo: &Photo) -> bool {
    if photo.mime_type == "text/markdown" {
        return true;
    }
    let ext = std::path::Path::new(&photo.path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(ext.as_str(), "md" | "markdown")
}

pub fn is_rankable_asset(photo: &Photo) -> bool {
    !is_video_asset(photo) && !is_markdown_asset(photo)
}

pub fn is_photo_in_rating_source(
    photo: &Photo,
    sources: &[crate::models::Source],
) -> bool {
    if sources.is_empty() {
        return true;
    }
    for source in sources {
        if !source.rating_enabled {
            continue;
        }
        let norm_photo = photo.path.replace('\\', "/");
        let norm_src = source.path.replace('\\', "/");
        let is_match = if norm_photo == norm_src {
            true
        } else if norm_src.ends_with('/') {
            norm_photo.starts_with(&norm_src)
        } else {
            norm_photo.starts_with(&format!("{}/", norm_src))
        };
        if is_match {
            return true;
        }
    }
    false
}

fn select_elo_proximity_opponents<'a>(
    anchor: &Photo,
    candidates: &'a [Photo],
    count: usize,
) -> Vec<&'a Photo> {
    let available: Vec<&'a Photo> = candidates
        .iter()
        .filter(|p| p.id != anchor.id)
        .collect();

    if available.len() <= count {
        return available;
    }

    let mut window = 75.0;
    let mut pool: Vec<&'a Photo> = Vec::new();

    while pool.len() < count && window < 1200.0 {
        pool = available
            .iter()
            .filter(|p| (p.rank_score - anchor.rank_score).abs() <= window)
            .cloned()
            .collect();
        window += 75.0;
    }

    if pool.len() < count {
        pool = available.clone();
    }

    let min_matches = pool.iter().map(|p| p.match_count).min().unwrap_or(0);
    let mut prioritized: Vec<&'a Photo> = pool
        .iter()
        .filter(|p| p.match_count <= min_matches + 1)
        .cloned()
        .collect();

    if prioritized.len() < count {
        prioritized = pool;
    }

    let mut rng = rand::thread_rng();
    prioritized.choose_multiple(&mut rng, count).cloned().collect()
}

pub fn get_ranking_pair(
    conn: &Connection,
    scope_query: Option<&str>,
) -> anyhow::Result<Option<RankingPair>> {
    let sources = crate::db::source_repo::get_all(conn).unwrap_or_default();
    let all_photos = photo_repo::get_all(conn, scope_query)?;
    let candidates: Vec<Photo> = all_photos
        .into_iter()
        .filter(|p| !p.rejected && is_rankable_asset(p) && is_photo_in_rating_source(p, &sources))
        .collect();

    if candidates.len() < 2 {
        return Ok(None);
    }

    let min_matches = candidates.iter().map(|p| p.match_count).min().unwrap_or(0);

    let mut pool: Vec<&Photo> = candidates.iter().filter(|p| p.match_count == min_matches).collect();
    if pool.is_empty() {
        pool = candidates.iter().filter(|p| p.match_count <= min_matches + 1).collect();
    }
    if pool.is_empty() {
        pool = candidates.iter().collect();
    }

    let mut rng = rand::thread_rng();
    let anchor = pool.choose(&mut rng).cloned().unwrap();
    let opponents = select_elo_proximity_opponents(anchor, &candidates, 1);
    if opponents.is_empty() {
        return Ok(None);
    }

    let mut chosen = vec![anchor.clone(), opponents[0].clone()];
    chosen.shuffle(&mut rng);

    Ok(Some(RankingPair {
        photo_a: chosen[0].clone(),
        photo_b: chosen[1].clone(),
    }))
}

pub fn get_ranking_quad(
    conn: &Connection,
    scope_query: Option<&str>,
) -> anyhow::Result<Option<RankingQuad>> {
    let sources = crate::db::source_repo::get_all(conn).unwrap_or_default();
    let all_photos = photo_repo::get_all(conn, scope_query)?;
    let candidates: Vec<Photo> = all_photos
        .into_iter()
        .filter(|p| !p.rejected && is_rankable_asset(p) && is_photo_in_rating_source(p, &sources))
        .collect();

    if candidates.len() < 4 {
        return Ok(None);
    }

    let min_matches = candidates.iter().map(|p| p.match_count).min().unwrap_or(0);

    let mut pool: Vec<&Photo> = candidates.iter().filter(|p| p.match_count == min_matches).collect();
    if pool.is_empty() {
        pool = candidates.iter().filter(|p| p.match_count <= min_matches + 1).collect();
    }
    if pool.is_empty() {
        pool = candidates.iter().collect();
    }

    let mut rng = rand::thread_rng();
    let anchor = pool.choose(&mut rng).cloned().unwrap();
    let opponents = select_elo_proximity_opponents(anchor, &candidates, 3);
    if opponents.len() < 3 {
        return Ok(None);
    }

    let mut chosen = vec![anchor.clone()];
    chosen.extend(opponents.into_iter().cloned());
    chosen.shuffle(&mut rng);

    Ok(Some(RankingQuad {
        photos: chosen,
    }))
}

pub fn record_ranking_match(
    conn: &Connection,
    winner_id: &str,
    loser_id: &str,
    is_tie: bool,
) -> anyhow::Result<RankingMatchResult> {
    let winner = photo_repo::get_by_id(conn, winner_id)?;
    let loser = photo_repo::get_by_id(conn, loser_id)?;

    let (new_winner_score, new_loser_score) = calculate_elo(winner.rank_score, loser.rank_score, is_tie);
    let winner_suggested = score_to_suggested_rating(new_winner_score);
    let loser_suggested = score_to_suggested_rating(new_loser_score);

    conn.execute(
        "UPDATE photos SET rank_score = ?, match_count = match_count + 1, suggested_rating = ? WHERE id = ?",
        params![new_winner_score, winner_suggested, winner_id],
    )?;

    conn.execute(
        "UPDATE photos SET rank_score = ?, match_count = match_count + 1, suggested_rating = ? WHERE id = ?",
        params![new_loser_score, loser_suggested, loser_id],
    )?;

    Ok(RankingMatchResult {
        winner_id: winner_id.to_string(),
        winner_score: new_winner_score,
        winner_suggested_rating: winner_suggested,
        loser_id: loser_id.to_string(),
        loser_score: new_loser_score,
        loser_suggested_rating: loser_suggested,
    })
}

pub fn record_ranking_quad_match(
    conn: &Connection,
    winner_id: Option<&str>,
    loser_ids: &[String],
    is_tie: bool,
) -> anyhow::Result<Vec<PhotoScoreUpdate>> {
    if is_tie {
        let mut all_ids = Vec::new();
        if let Some(wid) = winner_id {
            if !wid.is_empty() {
                all_ids.push(wid.to_string());
            }
        }
        for lid in loser_ids {
            if !all_ids.contains(lid) {
                all_ids.push(lid.clone());
            }
        }

        let mut photos = Vec::new();
        for id in &all_ids {
            photos.push(photo_repo::get_by_id(conn, id)?);
        }

        let scores: Vec<f64> = photos.iter().map(|p| p.rank_score).collect();
        let new_scores = calculate_plackett_luce_tie(&scores);

        let mut updates = Vec::new();
        for (photo, &new_score) in photos.iter().zip(new_scores.iter()) {
            let suggested = score_to_suggested_rating(new_score);
            conn.execute(
                "UPDATE photos SET rank_score = ?, match_count = match_count + 1, suggested_rating = ? WHERE id = ?",
                params![new_score, suggested, photo.id],
            )?;
            updates.push(PhotoScoreUpdate {
                id: photo.id.clone(),
                new_score,
                new_suggested_rating: suggested,
                is_winner: false,
            });
        }
        return Ok(updates);
    }

    let wid = winner_id.ok_or_else(|| anyhow::anyhow!("winner_id is required when not a tie"))?;
    let winner = photo_repo::get_by_id(conn, wid)?;
    let mut losers = Vec::new();
    for id in loser_ids {
        losers.push(photo_repo::get_by_id(conn, id)?);
    }

    let loser_scores: Vec<f64> = losers.iter().map(|p| p.rank_score).collect();
    let (new_winner_score, new_loser_scores) = calculate_plackett_luce(winner.rank_score, &loser_scores);

    let winner_suggested = score_to_suggested_rating(new_winner_score);
    conn.execute(
        "UPDATE photos SET rank_score = ?, match_count = match_count + 1, suggested_rating = ? WHERE id = ?",
        params![new_winner_score, winner_suggested, wid],
    )?;

    let mut updates = vec![PhotoScoreUpdate {
        id: wid.to_string(),
        new_score: new_winner_score,
        new_suggested_rating: winner_suggested,
        is_winner: true,
    }];

    for (loser, &new_score) in losers.iter().zip(new_loser_scores.iter()) {
        let loser_suggested = score_to_suggested_rating(new_score);
        conn.execute(
            "UPDATE photos SET rank_score = ?, match_count = match_count + 1, suggested_rating = ? WHERE id = ?",
            params![new_score, loser_suggested, loser.id],
        )?;
        updates.push(PhotoScoreUpdate {
            id: loser.id.clone(),
            new_score,
            new_suggested_rating: loser_suggested,
            is_winner: false,
        });
    }

    Ok(updates)
}

pub fn get_ranking_stats(
    conn: &Connection,
    scope_query: Option<&str>,
) -> anyhow::Result<RankingStats> {
    let sources = crate::db::source_repo::get_all(conn).unwrap_or_default();
    let all_photos = photo_repo::get_all(conn, scope_query)?;
    let active_photos: Vec<Photo> = all_photos
        .into_iter()
        .filter(|p| !p.rejected && is_rankable_asset(p) && is_photo_in_rating_source(p, &sources))
        .collect();

    let total_photos = active_photos.len() as u32;
    if total_photos == 0 {
        return Ok(RankingStats {
            total_photos: 0,
            total_matches: 0,
            progress: 0.0,
        });
    }

    let total_match_experiences: u32 = active_photos.iter().map(|p| p.match_count).sum();
    let target_match_experiences = total_photos * 10;
    let progress = if target_match_experiences > 0 {
        ((total_match_experiences as f64 / target_match_experiences as f64) * 100.0).min(100.0)
    } else {
        0.0
    };

    Ok(RankingStats {
        total_photos,
        total_matches: total_match_experiences / 2,
        progress: (progress * 10.0).round() / 10.0,
    })
}

pub fn apply_suggested_ratings(
    conn: &Connection,
    photo_ids: Option<Vec<String>>,
) -> anyhow::Result<u32> {
    let sources = crate::db::source_repo::get_all(conn).unwrap_or_default();
    let photos_to_update = match photo_ids {
        Some(ids) => {
            let mut list = Vec::new();
            for id in ids {
                if let Ok(p) = photo_repo::get_by_id(conn, &id) {
                    if is_rankable_asset(&p) && is_photo_in_rating_source(&p, &sources) {
                        list.push(p);
                    }
                }
            }
            list
        }
        None => {
            let all = photo_repo::get_all(conn, None)?;
            all.into_iter()
                .filter(|p| !p.rejected && is_rankable_asset(p) && is_photo_in_rating_source(p, &sources))
                .collect()
        }
    };

    let mut updated_count = 0;
    for photo in photos_to_update {
        if photo.rating != photo.suggested_rating {
            conn.execute(
                "UPDATE photos SET rating = ? WHERE id = ?",
                params![photo.suggested_rating, photo.id],
            )?;

            let _ = write_xmp(
                &photo.path,
                photo.exposure,
                photo.suggested_rating,
                &photo.tags,
                photo.title.as_deref(),
                photo.description.as_deref(),
                photo.crop_top,
                photo.crop_left,
                photo.crop_bottom,
                photo.crop_right,
                photo.crop_angle,
                photo.capture_time,
                photo.event,
                photo.portrait_blur,
            );

            updated_count += 1;
        }
    }

    Ok(updated_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    use tempfile::tempdir;

    #[test]
    fn test_initial_score_and_rating_conversion() {
        assert_eq!(calculate_initial_score(0), 1500.0);
        assert_eq!(calculate_initial_score(1), 1200.0);
        assert_eq!(calculate_initial_score(2), 1350.0);
        assert_eq!(calculate_initial_score(3), 1500.0);
        assert_eq!(calculate_initial_score(4), 1650.0);
        assert_eq!(calculate_initial_score(5), 1800.0);

        assert_eq!(score_to_suggested_rating(1199.0), 1);
        assert_eq!(score_to_suggested_rating(1275.0), 2);
        assert_eq!(score_to_suggested_rating(1350.0), 2);
        assert_eq!(score_to_suggested_rating(1500.0), 3);
        assert_eq!(score_to_suggested_rating(1650.0), 4);
        assert_eq!(score_to_suggested_rating(1800.0), 5);
    }

    #[test]
    fn test_adjust_score_for_rating_change() {
        // Zero matches: directly sets to initial score
        let (score, suggested) = adjust_score_for_rating_change(1500.0, 0, 5, 0);
        assert_eq!(score, 1800.0);
        assert_eq!(suggested, 5);

        let (score, suggested) = adjust_score_for_rating_change(1800.0, 5, 2, 0);
        assert_eq!(score, 1350.0);
        assert_eq!(suggested, 2);

        let (score, suggested) = adjust_score_for_rating_change(1350.0, 2, 0, 0);
        assert_eq!(score, 1500.0);
        assert_eq!(suggested, 3);

        // With match history: preserves match delta relative to old baseline
        // e.g. unrated photo (baseline 1500) won matches -> score 1542.0 (+42 delta).
        // User manually sets it to 5 stars (baseline 1800):
        let (score, suggested) = adjust_score_for_rating_change(1542.0, 0, 5, 3);
        assert_eq!(score, 1842.0);
        assert_eq!(suggested, 5);

        // e.g. 4-star photo (baseline 1650) lost matches -> score 1620.0 (-30 delta).
        // User manually bumps to 5 stars (baseline 1800):
        let (score, suggested) = adjust_score_for_rating_change(1620.0, 4, 5, 2);
        assert_eq!(score, 1770.0);
        assert_eq!(suggested, 5);
    }

    #[test]
    fn test_calculate_elo_equal_scores() {
        let (win, loss) = calculate_elo(1500.0, 1500.0, false);
        assert_eq!(win, 1516.0);
        assert_eq!(loss, 1484.0);

        let (tie_a, tie_b) = calculate_elo(1500.0, 1500.0, true);
        assert_eq!(tie_a, 1500.0);
        assert_eq!(tie_b, 1500.0);
    }

    #[test]
    fn test_calculate_elo_underdog_win() {
        let (win, loss) = calculate_elo(1200.0, 1800.0, false);
        assert!(win > 1228.0);
        assert!(loss < 1772.0);
    }

    #[test]
    fn test_ranking_lifecycle() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        let mut p1 = Photo::default_for_test();
        p1.id = "p1".to_string();
        p1.path = "/test/p1.jpg".to_string();
        p1.thumb_path = "/test/thumb1.jpg".to_string();
        p1.rating = 3;
        p1.rank_score = 1500.0;
        p1.suggested_rating = 3;
        photo_repo::insert(&conn, &p1).unwrap();

        let mut p2 = Photo::default_for_test();
        p2.id = "p2".to_string();
        p2.path = "/test/p2.jpg".to_string();
        p2.thumb_path = "/test/thumb2.jpg".to_string();
        p2.rating = 3;
        p2.rank_score = 1500.0;
        p2.suggested_rating = 3;
        photo_repo::insert(&conn, &p2).unwrap();

        // 1. Get initial stats
        let stats = get_ranking_stats(&conn, None).unwrap();
        assert_eq!(stats.total_photos, 2);
        assert_eq!(stats.total_matches, 0);
        assert_eq!(stats.progress, 0.0);

        // 2. Get pair
        let pair = get_ranking_pair(&conn, None).unwrap().expect("should find pair");
        assert!((pair.photo_a.id == "p1" && pair.photo_b.id == "p2") || (pair.photo_a.id == "p2" && pair.photo_b.id == "p1"));

        // 3. Record match: p1 beats p2
        let result = record_ranking_match(&conn, "p1", "p2", false).unwrap();
        assert_eq!(result.winner_score, 1516.0);
        assert_eq!(result.loser_score, 1484.0);

        let p1_after = photo_repo::get_by_id(&conn, "p1").unwrap();
        let p2_after = photo_repo::get_by_id(&conn, "p2").unwrap();
        assert_eq!(p1_after.match_count, 1);
        assert_eq!(p2_after.match_count, 1);
        assert_eq!(p1_after.rank_score, 1516.0);
        assert_eq!(p2_after.rank_score, 1484.0);

        // 4. Check stats updated
        let stats_after = get_ranking_stats(&conn, None).unwrap();
        assert_eq!(stats_after.total_matches, 1);
        assert!(stats_after.progress > 0.0);

        // 5. Apply suggested rating when suggested != manual
        let mut p3 = Photo::default_for_test();
        p3.id = "p3".to_string();
        p3.path = "/test/p3.jpg".to_string();
        p3.thumb_path = "/test/thumb3.jpg".to_string();
        p3.rating = 0; // manual 0 (unrated)
        p3.rank_score = 1680.0;
        p3.suggested_rating = 4; // suggested 4
        photo_repo::insert(&conn, &p3).unwrap();

        let updated = apply_suggested_ratings(&conn, Some(vec!["p3".to_string()])).unwrap();
        assert_eq!(updated, 1);
        let p3_applied = photo_repo::get_by_id(&conn, "p3").unwrap();
        assert_eq!(p3_applied.rating, 4);
    }

    #[test]
    fn test_ranking_excludes_videos() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        // 1 photo and 1 video
        let mut p1 = Photo::default_for_test();
        p1.id = "photo1".to_string();
        p1.path = "/test/photo1.jpg".to_string();
        p1.mime_type = "image/jpeg".to_string();
        photo_repo::insert(&conn, &p1).unwrap();

        let mut v1 = Photo::default_for_test();
        v1.id = "video1".to_string();
        v1.path = "/test/video1.mp4".to_string();
        v1.mime_type = "video/mp4".to_string();
        photo_repo::insert(&conn, &v1).unwrap();

        // Ranking pair needs at least 2 non-video photos. With only 1 photo + 1 video, pair should be None.
        let pair = get_ranking_pair(&conn, None).unwrap();
        assert!(pair.is_none());

        // Stats should only count 1 total photo (excluding video)
        let stats = get_ranking_stats(&conn, None).unwrap();
        assert_eq!(stats.total_photos, 1);

        // Applying suggested ratings directly on video should be ignored
        let updated = apply_suggested_ratings(&conn, Some(vec!["video1".to_string()])).unwrap();
        assert_eq!(updated, 0);

        // Add a second photo
        let mut p2 = Photo::default_for_test();
        p2.id = "photo2".to_string();
        p2.path = "/test/photo2.jpg".to_string();
        p2.mime_type = "image/jpeg".to_string();
        photo_repo::insert(&conn, &p2).unwrap();

        let pair2 = get_ranking_pair(&conn, None).unwrap().expect("should find pair among photos");
        assert_ne!(pair2.photo_a.id, "video1");
        assert_ne!(pair2.photo_b.id, "video1");
    }

    #[test]
    fn test_ranking_filters_by_source_rating_enabled() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        // Create 2 sources: Library (rating_enabled: true) and Inbox (rating_enabled: false)
        let src_library = crate::models::Source {
            id: "src_library".to_string(),
            path: "/test/Library".to_string(),
            name: "Library".to_string(),
            sync_mode: "push".to_string(),
            server_path: Some("Library".to_string()),
            archive_prefix: None,
            rating_enabled: true,
        };
        crate::db::source_repo::insert(&conn, &src_library).unwrap();

        let src_inbox = crate::models::Source {
            id: "src_inbox".to_string(),
            path: "/test/Inbox".to_string(),
            name: "Inbox".to_string(),
            sync_mode: "pull".to_string(),
            server_path: Some("Inbox".to_string()),
            archive_prefix: None,
            rating_enabled: false,
        };
        crate::db::source_repo::insert(&conn, &src_inbox).unwrap();

        // 2 photos in Library
        let mut p1 = Photo::default_for_test();
        p1.id = "p1".to_string();
        p1.path = "/test/Library/p1.jpg".to_string();
        p1.mime_type = "image/jpeg".to_string();
        photo_repo::insert(&conn, &p1).unwrap();

        let mut p2 = Photo::default_for_test();
        p2.id = "p2".to_string();
        p2.path = "/test/Library/p2.jpg".to_string();
        p2.mime_type = "image/jpeg".to_string();
        photo_repo::insert(&conn, &p2).unwrap();

        // 2 photos in Inbox (should be ignored by ranker)
        let mut p3 = Photo::default_for_test();
        p3.id = "p3".to_string();
        p3.path = "/test/Inbox/p3.jpg".to_string();
        p3.mime_type = "image/jpeg".to_string();
        photo_repo::insert(&conn, &p3).unwrap();

        let mut p4 = Photo::default_for_test();
        p4.id = "p4".to_string();
        p4.path = "/test/Inbox/p4.jpg".to_string();
        p4.mime_type = "image/jpeg".to_string();
        photo_repo::insert(&conn, &p4).unwrap();

        // Stats should only count the 2 photos in Library
        let stats = get_ranking_stats(&conn, None).unwrap();
        assert_eq!(stats.total_photos, 2);

        // Ranking pair should only ever pick p1 and p2
        for _ in 0..5 {
            let pair = get_ranking_pair(&conn, None).unwrap().expect("should find pair");
            assert!(pair.photo_a.id == "p1" || pair.photo_a.id == "p2");
            assert!(pair.photo_b.id == "p1" || pair.photo_b.id == "p2");
            assert_ne!(pair.photo_a.id, "p3");
            assert_ne!(pair.photo_b.id, "p3");
            assert_ne!(pair.photo_a.id, "p4");
            assert_ne!(pair.photo_b.id, "p4");
        }
    }

    #[test]
    fn test_calculate_plackett_luce_equal_scores() {
        let (winner_score, loser_scores) = calculate_plackett_luce(1500.0, &[1500.0, 1500.0, 1500.0]);
        assert_eq!(winner_score, 1524.0);
        assert_eq!(loser_scores, vec![1492.0, 1492.0, 1492.0]);

        // Net change should be zero
        let delta_winner = winner_score - 1500.0;
        let delta_losers: f64 = loser_scores.iter().map(|s| s - 1500.0).sum();
        assert!((delta_winner + delta_losers).abs() < 0.001);
    }

    #[test]
    fn test_ranking_quad_lifecycle() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        for i in 1..=4 {
            let mut p = Photo::default_for_test();
            p.id = format!("p{}", i);
            p.path = format!("/test/p{}.jpg", i);
            p.mime_type = "image/jpeg".to_string();
            p.rank_score = 1500.0;
            p.match_count = 0;
            photo_repo::insert(&conn, &p).unwrap();
        }

        let quad = get_ranking_quad(&conn, None).unwrap().expect("should find quad of 4 photos");
        assert_eq!(quad.photos.len(), 4);

        let updates = record_ranking_quad_match(
            &conn,
            Some("p1"),
            &["p2".to_string(), "p3".to_string(), "p4".to_string()],
            false,
        ).unwrap();

        assert_eq!(updates.len(), 4);
        let winner_update = updates.iter().find(|u| u.id == "p1").unwrap();
        assert!(winner_update.is_winner);
        assert_eq!(winner_update.new_score, 1524.0);

        let p1_after = photo_repo::get_by_id(&conn, "p1").unwrap();
        assert_eq!(p1_after.rank_score, 1524.0);
        assert_eq!(p1_after.match_count, 1);

        let p2_after = photo_repo::get_by_id(&conn, "p2").unwrap();
        assert_eq!(p2_after.rank_score, 1492.0);
        assert_eq!(p2_after.match_count, 1);
    }

    #[test]
    fn test_calculate_plackett_luce_tie() {
        // 4 photos of equal Elo tying
        let equal_scores = vec![1500.0, 1500.0, 1500.0, 1500.0];
        let new_scores = calculate_plackett_luce_tie(&equal_scores);
        assert_eq!(new_scores, vec![1500.0, 1500.0, 1500.0, 1500.0]);

        // Differing scores tying: 1600 underperformed, 1400 overperformed
        let diff_scores = vec![1600.0, 1500.0, 1500.0, 1400.0];
        let new_diff_scores = calculate_plackett_luce_tie(&diff_scores);
        assert!(new_diff_scores[0] < 1600.0);
        assert!(new_diff_scores[3] > 1400.0);

        // Sum of deltas should be zero
        let sum_delta: f64 = diff_scores.iter().zip(new_diff_scores.iter()).map(|(o, n)| n - o).sum();
        assert!(sum_delta.abs() < 0.001);
    }

    #[test]
    fn test_ranking_quad_tie_lifecycle() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        for i in 1..=4 {
            let mut p = Photo::default_for_test();
            p.id = format!("p{}", i);
            p.path = format!("/test/p{}.jpg", i);
            p.mime_type = "image/jpeg".to_string();
            p.rank_score = 1500.0;
            p.match_count = 0;
            photo_repo::insert(&conn, &p).unwrap();
        }

        let updates = record_ranking_quad_match(
            &conn,
            None,
            &["p1".to_string(), "p2".to_string(), "p3".to_string(), "p4".to_string()],
            true,
        ).unwrap();

        assert_eq!(updates.len(), 4);
        for update in updates {
            assert!(!update.is_winner);
            assert_eq!(update.new_score, 1500.0);
        }

        // All 4 photos must have match_count = 1
        for i in 1..=4 {
            let photo = photo_repo::get_by_id(&conn, &format!("p{}", i)).unwrap();
            assert_eq!(photo.match_count, 1);
            assert_eq!(photo.rank_score, 1500.0);
        }
    }

    #[test]
    fn test_elo_proximity_pairing() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        // 4 photos with close Elo
        for (id, score) in [("p1", 1500.0), ("p2", 1510.0), ("p3", 1490.0), ("p4", 1505.0)] {
            let mut p = Photo::default_for_test();
            p.id = id.to_string();
            p.path = format!("/test/{}.jpg", id);
            p.mime_type = "image/jpeg".to_string();
            p.rank_score = score;
            photo_repo::insert(&conn, &p).unwrap();
        }

        // 1 photo with distant Elo and already has a match
        let mut p_outlier = Photo::default_for_test();
        p_outlier.id = "p_far".to_string();
        p_outlier.path = "/test/far.jpg".to_string();
        p_outlier.mime_type = "image/jpeg".to_string();
        p_outlier.rank_score = 2200.0;
        p_outlier.match_count = 1;
        photo_repo::insert(&conn, &p_outlier).unwrap();

        // Quad selection with min_matches = 0 will select an anchor from p1..p4
        let quad = get_ranking_quad(&conn, None).unwrap().expect("should find quad");
        let ids: Vec<String> = quad.photos.iter().map(|p| p.id.clone()).collect();
        // Since there are 4 close photos within window 75, p_far should not be chosen
        assert!(!ids.contains(&"p_far".to_string()), "p_far should not be in close quad");
    }
}

