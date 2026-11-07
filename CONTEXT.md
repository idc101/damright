# DamRight Domain Glossary

This document defines the core domain terms and concepts used in DamRight. These terms should be used consistently throughout the codebase, database schema, user interface, and architectural designs.

## Core Concepts

### Photo (Media Asset)
The central media file (image or video) representing a single captured item. Photos have associated metadata including:
- **Capture Time**: The exact timestamp when the photo was taken (parsed from EXIF/XMP metadata or file parameters).
- **Event**: The event to which the photo belongs.
- **Tags**: Keyword labels applied to the photo.
- **Rating**: User evaluation rating (0 to 5 stars).
- **Rejected**: A boolean status flag indicating if the photo is marked for deletion.
- **Path**: The relative path of the physical file within its associated Source.
- **XMP Sidecar**: A companion metadata file (with `.xmp` extension) storing ratings, tags, and crop edits non-destructively.

### Event
A logical group of photos representing a real-world occurrence, activity, or date range (e.g., "Summer Party", "Family Vacation"). A photo is misfiled if it does not have a designated event.

### Source
A tracked root folder on the local file system containing photo libraries. Source records in SQLite store folder metadata and home server sync rules (`sync_mode`: `push`, `pull`, or `none`; `server_path`; `archive_prefix`), serving as the single golden source of truth for library folder configuration. Source paths are absolute, and all photos within a source are indexed relative to the source path.

### Validation (Audit)
The set of consistency checks performed on photos to ensure organization standards:
- **Missing Event**: Photos must belong to an Event.
- **Missing Capture Time**: Photos must have a parsed capture time.
- **Misplaced Folder**: A date-formatted folder component in a photo's path must match its actual capture date.
- **Misplaced Name**: The photo filename must match the deterministic format: `YYYYMMDDTHHMMSS-{3-char-hash}.ext`.
