pub struct QueryPlan {
    pub where_clause: String,
    pub params: Vec<String>,
    pub post_filter_misplaced: Option<bool>, // Some(true) for misplaced, Some(false) for correctly placed, None for all
}

pub fn tokenize_query(query: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut quote_char = '"';

    for c in query.chars() {
        if (c == '"' || c == '\'') && !in_quotes {
            in_quotes = true;
            quote_char = c;
            current.push(c);
        } else if in_quotes && c == quote_char {
            in_quotes = false;
            current.push(c);
        } else if c.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                tokens.push(current);
                current = String::new();
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

pub fn build_where_clause(query: Option<&str>) -> QueryPlan {
    let mut plan = QueryPlan {
        where_clause: String::new(),
        params: Vec::new(),
        post_filter_misplaced: None,
    };

    let Some(query) = query else { return plan };
    let query = query.trim();
    if query.is_empty() { return plan };

    let mut conditions: Vec<String> = Vec::new();
    let mut params = Vec::new();

    let tokens = tokenize_query(query);
    for part in &tokens {
        let (negated, term) = if part.starts_with('-') {
            (true, &part[1..])
        } else {
            (false, part.as_str())
        };

        if term == "is:misplaced" || term == "is:misfiled" {
            plan.post_filter_misplaced = Some(!negated);
        } else if term.starts_with("tag:") {
            let val = term[4..].trim_matches(|c| c == '"' || c == '\'');
            if negated {
                conditions.push("(tags NOT LIKE ? OR tags IS NULL OR tags = '')".to_string());
            } else {
                conditions.push("tags LIKE ?".to_string());
            }
            params.push(format!("%{}%", val));
        } else if term.starts_with("after:") {
            let val = &term[6..];
            if val.len() == 4 && val.chars().all(|c| c.is_ascii_digit()) {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time <= ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time > ?)".to_string());
                }
                params.push(format!("{}-12-31 23:59:59", val));
            } else {
                let target = if val.contains(' ') || val.contains('T') {
                    val.to_string()
                } else {
                    format!("{} 00:00:00", val)
                };
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time < ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time >= ?)".to_string());
                }
                params.push(target);
            }
        } else if term.starts_with("since:") || term.starts_with("from:") {
            let val = if term.starts_with("since:") { &term[6..] } else { &term[5..] };
            let target = if val.len() == 4 && val.chars().all(|c| c.is_ascii_digit()) {
                format!("{}-01-01 00:00:00", val)
            } else if val.len() == 7 {
                format!("{}-01 00:00:00", val)
            } else if val.contains(' ') || val.contains('T') {
                val.to_string()
            } else {
                format!("{} 00:00:00", val)
            };
            if negated {
                conditions.push("(capture_time IS NULL OR capture_time < ?)".to_string());
            } else {
                conditions.push("(capture_time IS NOT NULL AND capture_time >= ?)".to_string());
            }
            params.push(target);
        } else if term.starts_with("before:") || term.starts_with("until:") || term.starts_with("to:") {
            let val = if term.starts_with("before:") {
                &term[7..]
            } else if term.starts_with("until:") {
                &term[6..]
            } else {
                &term[3..]
            };
            if val.len() == 4 && val.chars().all(|c| c.is_ascii_digit()) {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time >= ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time < ?)".to_string());
                }
                params.push(format!("{}-01-01 00:00:00", val));
            } else if val.len() == 7 {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time >= ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time < ?)".to_string());
                }
                params.push(format!("{}-01 00:00:00", val));
            } else {
                let target = if val.contains(' ') || val.contains('T') {
                    val.to_string()
                } else {
                    format!("{} 23:59:59", val)
                };
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time > ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time <= ?)".to_string());
                }
                params.push(target);
            }
        } else if term.starts_with("year:") {
            let val = &term[5..];
            let op = if val.starts_with(">=") {
                ">="
            } else if val.starts_with("<=") {
                "<="
            } else if val.starts_with('>') {
                ">"
            } else if val.starts_with('<') {
                "<"
            } else {
                "="
            };
            let y = val.trim_start_matches(|c| c == '>' || c == '<' || c == '=');
            if op == ">" {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time <= ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time > ?)".to_string());
                }
                params.push(format!("{}-12-31 23:59:59", y));
            } else if op == ">=" {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time < ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time >= ?)".to_string());
                }
                params.push(format!("{}-01-01 00:00:00", y));
            } else if op == "<" {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time >= ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time < ?)".to_string());
                }
                params.push(format!("{}-01-01 00:00:00", y));
            } else if op == "<=" {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time > ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time <= ?)".to_string());
                }
                params.push(format!("{}-12-31 23:59:59", y));
            } else if y.len() == 4 && y.chars().all(|c| c.is_ascii_digit()) {
                if negated {
                    conditions.push("(capture_time IS NULL OR capture_time < ? OR capture_time > ?)".to_string());
                } else {
                    conditions.push("(capture_time IS NOT NULL AND capture_time >= ? AND capture_time <= ?)".to_string());
                }
                params.push(format!("{}-01-01 00:00:00", y));
                params.push(format!("{}-12-31 23:59:59", y));
            } else {
                if negated {
                    conditions.push("(capture_time NOT LIKE ? OR capture_time IS NULL)".to_string());
                } else {
                    conditions.push("capture_time LIKE ?".to_string());
                }
                params.push(format!("{}%", y));
            }
        } else if term.starts_with("date:") {
            let val = &term[5..];
            let op = if val.starts_with(">=") {
                ">="
            } else if val.starts_with("<=") {
                "<="
            } else if val.starts_with('>') {
                ">"
            } else if val.starts_with('<') {
                "<"
            } else {
                "="
            };
            let d = val.trim_start_matches(|c| c == '>' || c == '<' || c == '=');
            if op == "=" {
                if negated {
                    conditions.push("(capture_time NOT LIKE ? OR capture_time IS NULL)".to_string());
                } else {
                    conditions.push("capture_time LIKE ?".to_string());
                }
                params.push(format!("{}%", d));
            } else {
                let target = if d.contains(' ') || d.contains('T') {
                    d.to_string()
                } else if op == ">=" || op == "<" {
                    format!("{} 00:00:00", d)
                } else {
                    format!("{} 23:59:59", d)
                };
                if negated {
                    conditions.push(format!("(capture_time IS NULL OR NOT capture_time {} ?)", op));
                } else {
                    conditions.push(format!("(capture_time IS NOT NULL AND capture_time {} ?)", op));
                }
                params.push(target);
            }
        } else if term.starts_with("r:") || term.starts_with("rating:") {
            let val = term.split(':').nth(1).unwrap_or("");
            let op = if val.starts_with(">=") {
                ">="
            } else if val.starts_with("<=") {
                "<="
            } else if val.starts_with(">") {
                ">"
            } else if val.starts_with("<") {
                "<"
            } else {
                "="
            };
            
            let num_str = val.trim_start_matches(|c| c == '>' || c == '<' || c == '=');
            
            if negated {
                conditions.push(format!("NOT rating {} ?", op));
            } else {
                conditions.push(format!("rating {} ?", op));
            }
            params.push(num_str.to_string());
        } else if term == "is:rejected" {
            if negated {
                conditions.push("rejected = 0".to_string());
            } else {
                conditions.push("rejected = 1".to_string());
            }
        } else if term == "is:duplicate" {
            if negated {
                conditions.push("perceptual_hash NOT IN (SELECT perceptual_hash FROM photos WHERE perceptual_hash IS NOT NULL GROUP BY perceptual_hash HAVING COUNT(*) > 1)".to_string());
            } else {
                conditions.push("perceptual_hash IN (SELECT perceptual_hash FROM photos WHERE perceptual_hash IS NOT NULL GROUP BY perceptual_hash HAVING COUNT(*) > 1)".to_string());
            }
        } else if term == "is:cropped" {
            if negated {
                conditions.push("(crop_top IS NULL AND crop_left IS NULL AND crop_bottom IS NULL AND crop_right IS NULL)".to_string());
            } else {
                conditions.push("(crop_top IS NOT NULL OR crop_left IS NOT NULL OR crop_bottom IS NOT NULL OR crop_right IS NOT NULL)".to_string());
            }
        } else if term == "is:rotated" {
            if negated {
                conditions.push("((crop_angle IS NULL OR crop_angle = 0.0) AND orientation = 1)".to_string());
            } else {
                conditions.push("((crop_angle IS NOT NULL AND crop_angle != 0.0) OR orientation != 1)".to_string());
            }
        } else if term == "is:lighting" {
            if negated {
                conditions.push("exposure = 0.0".to_string());
            } else {
                conditions.push("exposure != 0.0".to_string());
            }
        } else if term == "is:edited" {
            if negated {
                conditions.push("(exposure = 0.0 AND crop_top IS NULL AND crop_left IS NULL AND crop_bottom IS NULL AND crop_right IS NULL AND (crop_angle IS NULL OR crop_angle = 0.0) AND orientation = 1)".to_string());
            } else {
                conditions.push("(exposure != 0.0 OR crop_top IS NOT NULL OR crop_left IS NOT NULL OR crop_bottom IS NOT NULL OR crop_right IS NOT NULL OR (crop_angle IS NOT NULL AND crop_angle != 0.0) OR orientation != 1)".to_string());
            }
        } else if term == "is:video" {
            if negated {
                conditions.push("mime_type NOT LIKE ?".to_string());
            } else {
                conditions.push("mime_type LIKE ?".to_string());
            }
            params.push("video/%".to_string());
        } else if term == "is:photo" {
             if negated {
                conditions.push("mime_type NOT LIKE ?".to_string());
            } else {
                conditions.push("mime_type LIKE ?".to_string());
            }
            params.push("image/%".to_string());
        } else if term.starts_with("make:") {
            let val = term[5..].trim_matches(|c| c == '"' || c == '\'');
            if negated {
                conditions.push("camera_make NOT LIKE ?".to_string());
            } else {
                conditions.push("camera_make LIKE ?".to_string());
            }
            params.push(format!("%{}%", val));
        } else if term.starts_with("model:") {
            let val = term[6..].trim_matches(|c| c == '"' || c == '\'');
            if negated {
                conditions.push("camera_model NOT LIKE ?".to_string());
            } else {
                conditions.push("camera_model LIKE ?".to_string());
            }
            params.push(format!("%{}%", val));
        } else if term.starts_with("person:") {
            let val = term[7..].trim_matches(|c| c == '"' || c == '\'');
            if negated {
                conditions.push("id NOT IN (SELECT photo_id FROM photo_faces JOIN people ON photo_faces.person_id = people.id WHERE people.name LIKE ?)".to_string());
            } else {
                conditions.push("id IN (SELECT photo_id FROM photo_faces JOIN people ON photo_faces.person_id = people.id WHERE people.name LIKE ?)".to_string());
            }
            params.push(format!("%{}%", val));
        } else if term.starts_with("title:") {
            let val = term[6..].trim_matches(|c| c == '"' || c == '\'');
            if negated {
                conditions.push("(title NOT LIKE ? OR title IS NULL OR title = '')".to_string());
            } else {
                conditions.push("title LIKE ?".to_string());
            }
            params.push(format!("%{}%", val));
        } else if term.starts_with("exact-title:") || term.starts_with("title-exact:") {
            let val = if term.starts_with("exact-title:") { &term[12..] } else { &term[12..] };
            let val = val.trim_matches(|c| c == '"' || c == '\'');
            if negated {
                conditions.push("(title != ? OR title IS NULL)".to_string());
            } else {
                conditions.push("title = ?".to_string());
            }
            params.push(val.to_string());
        } else if term.starts_with("desc:") || term.starts_with("description:") {
            let val = if term.starts_with("desc:") { &term[5..] } else { &term[12..] };
            let val = val.trim_matches(|c| c == '"' || c == '\'');
            if negated {
                conditions.push("(description NOT LIKE ? OR description IS NULL OR description = '')".to_string());
            } else {
                conditions.push("description LIKE ?".to_string());
            }
            params.push(format!("%{}%", val));
        } else if term == "has:title" {
            if negated {
                conditions.push("(title IS NULL OR title = '')".to_string());
            } else {
                conditions.push("(title IS NOT NULL AND title != '')".to_string());
            }
        } else if term == "has:desc" || term == "has:description" {
            if negated {
                conditions.push("(description IS NULL OR description = '')".to_string());
            } else {
                conditions.push("(description IS NOT NULL AND description != '')".to_string());
            }
        } else if term == "has:tag" || term == "has:tags" {
            if negated {
                conditions.push("(tags IS NULL OR tags = '')".to_string());
            } else {
                conditions.push("(tags IS NOT NULL AND tags != '')".to_string());
            }
        } else if term == "is:camera-title" || term == "is:cameratitle" {
            let expr = "(title IS NOT NULL AND title != '' AND ((camera_model IS NOT NULL AND camera_model != '' AND LOWER(TRIM(title)) = LOWER(TRIM(camera_model))) OR (camera_make IS NOT NULL AND camera_make != '' AND LOWER(TRIM(title)) = LOWER(TRIM(camera_make))) OR (camera_make IS NOT NULL AND camera_model IS NOT NULL AND LOWER(TRIM(title)) = LOWER(TRIM(camera_make || ' ' || camera_model))) OR (camera_make IS NOT NULL AND camera_model IS NOT NULL AND LOWER(TRIM(title)) = LOWER(TRIM(camera_model || ' ' || camera_make)))))";
            if negated {
                conditions.push(format!("(title IS NULL OR title = '' OR NOT {})", expr));
            } else {
                conditions.push(expr.to_string());
            }
        } else {
            let clean = term.trim_matches(|c| c == '"' || c == '\'');
            // keyword search
            if negated {
                conditions.push("(title NOT LIKE ? AND description NOT LIKE ? AND tags NOT LIKE ? AND path NOT LIKE ?)".to_string());
            } else {
                conditions.push("(title LIKE ? OR description LIKE ? OR tags LIKE ? OR path LIKE ?)".to_string());
            }
            let p = format!("%{}%", clean);
            params.push(p.clone());
            params.push(p.clone());
            params.push(p.clone());
            params.push(p);
        }
    }

    if !conditions.is_empty() {
        plan.where_clause = format!("WHERE {}", conditions.join(" AND "));
        plan.params = params;
    }
    
    plan
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_where_clause() {
        let plan = build_where_clause(Some("nature rating:>3 -is:rejected"));
        assert!(plan.where_clause.contains("WHERE"));
        assert!(plan.where_clause.contains("title LIKE ?"));
        assert!(plan.where_clause.contains("rating > ?"));
        assert!(plan.where_clause.contains("rejected = 0"));
        assert_eq!(plan.params.len(), 5); // 4 for keyword "nature", 1 for rating "3"
        
        let plan = build_where_clause(Some("tag:landscape r:5"));
        assert!(plan.where_clause.contains("tags LIKE ?"));
        assert!(plan.where_clause.contains("rating = ?"));
        assert_eq!(plan.params.len(), 2);

        let plan = build_where_clause(Some("is:video -make:Sony"));
        assert!(plan.where_clause.contains("mime_type LIKE ?"));
        assert!(plan.where_clause.contains("camera_make NOT LIKE ?"));
        assert_eq!(plan.params.len(), 2);
    }

    #[test]
    fn test_negated_tag() {
        let plan = build_where_clause(Some("-tag:test"));
        assert!(plan.where_clause.contains("tags NOT LIKE ?"));
        assert_eq!(plan.params, vec!["%test%"]);
    }

    #[test]
    fn test_person_search() {
        let plan = build_where_clause(Some("person:John"));
        assert!(plan.where_clause.contains("id IN (SELECT photo_id FROM photo_faces JOIN people ON photo_faces.person_id = people.id WHERE people.name LIKE ?)"));
        assert_eq!(plan.params, vec!["%John%"]);
    }

    #[test]
    fn test_misplaced_search() {
        let plan = build_where_clause(Some("is:misplaced"));
        assert_eq!(plan.post_filter_misplaced, Some(true));
        assert!(plan.where_clause.is_empty());

        let plan = build_where_clause(Some("-is:misplaced"));
        assert_eq!(plan.post_filter_misplaced, Some(false));
    }

    #[test]
    fn test_duplicate_search() {
        let plan = build_where_clause(Some("is:duplicate"));
        assert!(plan.where_clause.contains("perceptual_hash IN (SELECT perceptual_hash FROM photos WHERE perceptual_hash IS NOT NULL GROUP BY perceptual_hash HAVING COUNT(*) > 1)"));
        
        let plan = build_where_clause(Some("-is:duplicate"));
        assert!(plan.where_clause.contains("perceptual_hash NOT IN (SELECT perceptual_hash FROM photos WHERE perceptual_hash IS NOT NULL GROUP BY perceptual_hash HAVING COUNT(*) > 1)"));
    }

    #[test]
    fn test_is_cropped() {
        let plan = build_where_clause(Some("is:cropped"));
        assert!(plan.where_clause.contains("crop_top IS NOT NULL"));
        
        let plan = build_where_clause(Some("-is:cropped"));
        assert!(plan.where_clause.contains("crop_top IS NULL"));
    }

    #[test]
    fn test_is_rotated() {
        let plan = build_where_clause(Some("is:rotated"));
        assert!(plan.where_clause.contains("crop_angle IS NOT NULL AND crop_angle != 0.0"));
        assert!(plan.where_clause.contains("orientation != 1"));
        
        let plan = build_where_clause(Some("-is:rotated"));
        assert!(plan.where_clause.contains("crop_angle IS NULL OR crop_angle = 0.0"));
        assert!(plan.where_clause.contains("orientation = 1"));
    }

    #[test]
    fn test_is_lighting() {
        let plan = build_where_clause(Some("is:lighting"));
        assert!(plan.where_clause.contains("exposure != 0.0"));
        
        let plan = build_where_clause(Some("-is:lighting"));
        assert!(plan.where_clause.contains("exposure = 0.0"));
    }

    #[test]
    fn test_is_edited() {
        let plan = build_where_clause(Some("is:edited"));
        assert!(plan.where_clause.contains("exposure != 0.0"));
        assert!(plan.where_clause.contains("crop_top IS NOT NULL"));
        
        let plan = build_where_clause(Some("-is:edited"));
        assert!(plan.where_clause.contains("exposure = 0.0"));
        assert!(plan.where_clause.contains("crop_top IS NULL"));
    }

    #[test]
    fn test_date_filters() {
        let plan = build_where_clause(Some("after:2009 tag:vacation -tag:private"));
        assert!(plan.where_clause.contains("capture_time > ?"));
        assert!(plan.where_clause.contains("tags LIKE ?"));
        assert!(plan.where_clause.contains("(tags NOT LIKE ? OR tags IS NULL OR tags = '')"));
        assert_eq!(plan.params, vec![
            "2009-12-31 23:59:59".to_string(),
            "%vacation%".to_string(),
            "%private%".to_string()
        ]);

        let plan_year = build_where_clause(Some("year:2020"));
        assert!(plan_year.where_clause.contains("capture_time >= ?"));
        assert!(plan_year.where_clause.contains("capture_time <= ?"));
        assert_eq!(plan_year.params, vec![
            "2020-01-01 00:00:00".to_string(),
            "2020-12-31 23:59:59".to_string()
        ]);

        let plan_before = build_where_clause(Some("before:2024"));
        assert!(plan_before.where_clause.contains("capture_time < ?"));
        assert_eq!(plan_before.params, vec!["2024-01-01 00:00:00".to_string()]);

        let plan_since = build_where_clause(Some("since:2010"));
        assert!(plan_since.where_clause.contains("capture_time >= ?"));
        assert_eq!(plan_since.params, vec!["2010-01-01 00:00:00".to_string()]);
    }

    #[test]
    fn test_title_and_description_filters() {
        let plan = build_where_clause(Some("title:Sunset desc:Ocean"));
        assert!(plan.where_clause.contains("title LIKE ?"));
        assert!(plan.where_clause.contains("description LIKE ?"));
        assert_eq!(plan.params, vec!["%Sunset%", "%Ocean%"]);

        let plan_neg = build_where_clause(Some("-title:Draft -desc:Temporary"));
        assert!(plan_neg.where_clause.contains("(title NOT LIKE ? OR title IS NULL OR title = '')"));
        assert!(plan_neg.where_clause.contains("(description NOT LIKE ? OR description IS NULL OR description = '')"));

        let plan_exact = build_where_clause(Some("exact-title:\"ILCE-7M3\""));
        assert!(plan_exact.where_clause.contains("title = ?"));
        assert_eq!(plan_exact.params, vec!["ILCE-7M3"]);
    }

    #[test]
    fn test_has_metadata_filters() {
        let plan = build_where_clause(Some("has:title has:desc has:tags"));
        assert!(plan.where_clause.contains("(title IS NOT NULL AND title != '')"));
        assert!(plan.where_clause.contains("(description IS NOT NULL AND description != '')"));
        assert!(plan.where_clause.contains("(tags IS NOT NULL AND tags != '')"));

        let plan_neg = build_where_clause(Some("-has:title -has:desc -has:tags"));
        assert!(plan_neg.where_clause.contains("(title IS NULL OR title = '')"));
        assert!(plan_neg.where_clause.contains("(description IS NULL OR description = '')"));
        assert!(plan_neg.where_clause.contains("(tags IS NULL OR tags = '')"));
    }

    #[test]
    fn test_is_camera_title_filter() {
        let plan = build_where_clause(Some("is:camera-title"));
        assert!(plan.where_clause.contains("LOWER(TRIM(title)) = LOWER(TRIM(camera_model))"));
        assert!(plan.where_clause.contains("LOWER(TRIM(title)) = LOWER(TRIM(camera_make))"));

        let plan_neg = build_where_clause(Some("-is:camera-title"));
        assert!(plan_neg.where_clause.contains("title IS NULL OR title = '' OR NOT"));
    }

    #[test]
    fn test_tokenize_query_with_quotes() {
        let tokens = tokenize_query("title:\"Canon EOS\" tag:'family vacation' -is:rejected");
        assert_eq!(tokens, vec!["title:\"Canon EOS\"", "tag:'family vacation'", "-is:rejected"]);

        let plan = build_where_clause(Some("title:\"Canon EOS\" tag:'family vacation'"));
        assert!(plan.where_clause.contains("title LIKE ?"));
        assert!(plan.where_clause.contains("tags LIKE ?"));
        assert_eq!(plan.params, vec!["%Canon EOS%", "%family vacation%"]);
    }
}
