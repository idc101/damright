# DamRight: Agent Instructions & Standards

This document defines the foundational mandates and engineering standards for all AI agents working on the `DamRight` project. These instructions take absolute precedence over general defaults.

## Project Context
`DamRight` is a high-performance Personal Digital Asset Manager (DAM) built with **Tauri**, **Rust**, and **React (TypeScript)**. It focuses on large library organization (10,000+ items), non-destructive editing via XMP sidecars, and automated home server backups.

---

## Core Architectural Mandates
1. **Non-destructive Editing:** Original media files must NEVER be modified. All edits are stored in the SQLite database and synchronized to `.xmp` sidecar files.
2. **Golden Source:** The local file system and XMP sidecars are the ultimate source of truth. The database is a high-speed index/cache of this state.
3. **Performance First:** UI operations must remain fluid (60fps). CPU-intensive tasks (image processing, directory scanning, hashing) MUST be performed in the Rust backend, ideally in background threads to avoid blocking the main Tauri loop.
4. **Portability:** Metadata (ratings, tags, edits) must be written to XMP sidecars in a format compatible with industry standards (e.g., Adobe Camera Raw).

---

## Project Structure & Conventions

### 1. Folder Structure & Naming
- **Folder Convention:** Media folders should ideally reside in a structured path such as `/YYYY/MM-DD/` or `/YYYY/MM-DD/EventName`.
- **Deterministic Filenames:** Auto-renaming standardizes media files using the pattern:
  `YYYYMMDDTHHMMSS-{3-char-hash}.ext`
  where `{3-char-hash}` is a collision-resistant prefix computed from the file content's hash.

### 2. Validation & Audit Rules
The validation suite audits the consistency of the folder structure and metadata. A photo is flagged as **misfiled** if it meets any of the following conditions:
- **Missing Event:** No event is assigned.
- **Missing Capture Time:** No capture time is parsed from metadata or file parameters.
- **Misplaced Folder:** Any subfolder component in the file's parent path that looks like a date (`YYYY-MM-DD`, `YYYY-MM`, or a year `YYYY` between 1800-2100) does not match the actual capture date of the photo.
- **Misplaced Name:** The filename does not start with the capture date/time prefix (`YYYYMMDDTHHMMSS`) or does not match the deterministic filename format.

### 3. Context Menu Order Policy
For consistency, right-clicking a photo should always list context menu options in the following order:
1. **Show in Folder** (If applicable, navigates sidebar to parent folder)
2. **Reveal in Finder / Explorer / Files**
3. **Reject / Un-reject Photo**
4. **Auto Rename Photo**
5. **Move Photo...**
6. **Edit Capture Date...**
7. **Set Event from Folder Name**
8. **Clear Event** (If event is set)

---

## State Persistence Protocol
The application persists UI layout and view state in browser `localStorage` across page loads and desktop app restarts:
- `selectedSidebarTab`: Active sidebar view (`folders`, `tags`, `people`, `validation`).
- `selectedPath` / `selectedTag` / `selectedPerson`: Last navigated section.
- `selectedPhotoId`: Last highlighted item.
- `sidebarWidth` / `metadataWidth`: Resized panel widths.
- `expanded_node:<path>`: Individual TreeView expansion state (boolean).
- `searchQuery` / `searchScope` / `mediaTypeFilter` / `rejectedFilter`: Active search query and category filters.

---

## Platform-Specific Handling
- **macOS Native Conversion:** HEIC files are converted on-the-fly to JPEG on macOS using the native `sips` tool for compatibility with the frontend webview. Check target OS using `#[cfg(target_os = "macos")]`.
- **Reveal File:** System commands (`open`, `explorer`, `xdg-open`) are used contextually based on compiled target OS to reveal files in the system's file manager.

---

## Engineering Standards & Testing
**Automated testing is NOT optional.** Every feature, bug fix, or refactor must include verification logic.

### 1. Rust Backend
- Use `cargo test` for unit and integration tests.
- Logic in `processing.rs` must be modular and testable without a running Tauri context where possible.
- **Mandatory:** Add tests for XMP parsing/writing and database migrations.

### 2. Frontend
- Use **Vitest** and **React Testing Library** for component and logic testing.
- Verify that UI state (like the exposure slider) correctly triggers backend commands.

### 3. E2E Integration Testing (Playwright)
- When registering or invoking a new Tauri command, **you must add a mock implementation** in the initialization script inside `e2e/app.test.ts` (and other test files if needed).
- E2E tests run in a standard browser environment and will fail if Tauri commands are invoked without being mocked in `window.__TAURI__` or `window.__TAURI_INTERNALS__`.

### 4. Validation Workflow
- **Research:** Map dependencies and verify assumptions using `grep_search` and `read_file`.
- **Strategy:** Propose a plan that includes a specific testing strategy.
- **Execution:** Implement the change AND the tests.
- **Verification:** Run the full mandatory verification suite using `npm run validate`.

---

## Mandatory Verification Suite
Every change MUST be verified using the single command: `npm run validate`. 

This command performs the following checks in order:
1. **Frontend Build & Type Check:** `tsc && vite build`
2. **Frontend Tests:** `vitest --run`
3. **Frontend E2E Tests:** `playwright test`
4. **Backend Rust Check:** `cargo check`
5. **Backend Rust Tests:** `cargo test`

A change is only considered complete if this command exits successfully (status code 0).

---

## Registered Tauri Commands Reference
When interacting with the Rust backend, use the following core registered commands (located in `src-tauri/src/lib.rs` and `photo_commands.rs`):
- `import_photos` / `refresh_folder`
- `add_source` / `get_all_sources` / `update_source_sync_settings` / `delete_source`
- `get_dir_tree`
- `get_all_photos` / `get_photo_data` / `get_preview`
- `get_all_tags` / `get_all_people`
- `set_exposure` / `set_crop`
- `set_metadata` / `batch_set_metadata` / `batch_set_capture_date`
- `set_event` / `batch_set_event`
- `set_rejected` / `delete_rejected`
- `auto_rename` / `move_photos`
- `fix_all_validation_issues`
- `reveal_in_finder`
- `get_inbox_count` / `update_inbox_badge`
- `get_sync_config` / `save_sync_config` / `test_server_config` / `trigger_sync_now` / `get_sync_status` / `get_sync_diagnostics`
- `get_ranking_pair` / `record_ranking_match` / `get_ranking_quad` / `record_ranking_quad_match` / `get_ranking_stats` / `apply_suggested_ratings`

---

## Communication Style
- Be concise, direct, and technical.
- Prioritize intent and rationale over conversational filler.
- Document and outline strategy transitions between Research, Strategy, and Execution phases.
