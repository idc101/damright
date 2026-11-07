import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Robust Mock for Tauri v2
    await page.addInitScript(() => {
      window.localStorage.clear();
      const mockInvoke = async (cmd: string, args: any) => {
        if (cmd === 'get_all_photos') {
            console.log('Mock: get_all_photos called with', args);
            return [
                {
                    id: 'photo1',
                    path: '/test/1.jpg',
                    thumb_path: '/test/thumb1.jpg',
                    exposure: 0,
                    rating: 0,
                    rejected: false,
                    tags: '',
                    orientation: 1,
                    mime_type: 'image/jpeg',
                    faces: []
                },
                {
                    id: 'photo2',
                    path: '/test/2.jpg',
                    thumb_path: '/test/thumb2.jpg',
                    exposure: 0,
                    rating: 0,
                    rejected: false,
                    tags: '',
                    orientation: 1,
                    mime_type: 'image/jpeg',
                    faces: []
                }
            ];
        }
        if (cmd === 'get_all_sources') return [
          { id: 'src1', path: '/test', name: 'Test Source', rating_enabled: true }
        ];
        if (cmd === 'get_dir_tree') return {
            name: 'test',
            path: '/test',
            children: [],
            photo_count: 2
        };
        if (cmd === 'get_all_tags') return [];
        if (cmd === 'get_preview') return `/test/preview_${args.photo.id}.jpg`;
        if (cmd === 'update_source_sync_settings') return null;
        if (cmd === 'set_portrait_blur') return null;
        if (cmd === 'delete_photo') return null;
        if (cmd === 'move_photos') return 2;
        if (cmd === 'move_folder') return 2;
        if (cmd === 'diff_icloud_photos') return { matched_keep: [], matched_rejected: [], orphaned: [] };
        if (cmd === 'add_photos_to_icloud_album') return 0;
        if (cmd === 'get_inbox_count' || cmd === 'update_inbox_badge') return 0;
        if (cmd === 'get_sync_config') return {
          server_sync: {
            endpoint: 'http://localhost:8010',
            enabled: false,
            debounce_minutes: 30,
            folder_rules: {
              Inbox: { mode: 'pull', client_path: '/Users/user/Pictures/Inbox', server_path: 'Inbox', archive_prefix: 'Inbox/archive' },
              Library: { mode: 'push', client_path: '/Users/user/OneDrive/Pictures/Library', server_path: 'Library' },
              Documents: { mode: 'push', client_path: '/Users/user/OneDrive/Pictures/Documents', server_path: 'Documents' },
              History: { mode: 'push', client_path: '/Users/user/OneDrive/Pictures/History', server_path: 'History' },
            }
          },
          local: { web_port: 8010 }
        };
        if (cmd === 'save_sync_config') return null;
        if (cmd === 'test_server_config' || cmd === 'test_s3_config') return true;
        if (cmd === 'trigger_sync_now') return 0;
        if (cmd === 'get_sync_status') return { stage: 'Idle', enabled: false, debounce_minutes: 30 };
        if (cmd === 'get_sync_diagnostics') return { total_files: 0, total_bytes: 0, rules_breakdown: [], extension_counts: [], sample_files: [] };
        if (cmd === 'update_source_sync_settings') return null;
        if (cmd === 'delete_source') return null;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return null;
        if (cmd === 'get_ranking_pair') return {
          photo_a: { id: 'photo1', path: '/test/1.jpg', thumb_path: '/test/thumb1.jpg', exposure: 0, rating: 2, rejected: false, tags: '', orientation: 1, mime_type: 'image/jpeg', faces: [], rank_score: 1500, match_count: 0, suggested_rating: 2 },
          photo_b: { id: 'photo2', path: '/test/2.jpg', thumb_path: '/test/thumb2.jpg', exposure: 0, rating: 2, rejected: false, tags: '', orientation: 1, mime_type: 'image/jpeg', faces: [], rank_score: 1500, match_count: 0, suggested_rating: 2 }
        };
        if (cmd === 'record_ranking_match') return {
          winner_id: args.winnerId,
          winner_score: 1516,
          winner_suggested_rating: 2,
          loser_id: args.loserId,
          loser_score: 1484,
          loser_suggested_rating: 2
        };
        if (cmd === 'get_ranking_quad') return {
          photos: [
            { id: 'photo1', path: '/test/1.jpg', thumb_path: '/test/thumb1.jpg', exposure: 0, rating: 2, rejected: false, tags: '', orientation: 1, mime_type: 'image/jpeg', faces: [], rank_score: 1500, match_count: 0, suggested_rating: 2 },
            { id: 'photo2', path: '/test/2.jpg', thumb_path: '/test/thumb2.jpg', exposure: 0, rating: 2, rejected: false, tags: '', orientation: 1, mime_type: 'image/jpeg', faces: [], rank_score: 1500, match_count: 0, suggested_rating: 2 },
            { id: 'photo3', path: '/test/3.jpg', thumb_path: '/test/thumb3.jpg', exposure: 0, rating: 2, rejected: false, tags: '', orientation: 1, mime_type: 'image/jpeg', faces: [], rank_score: 1500, match_count: 0, suggested_rating: 2 },
            { id: 'photo4', path: '/test/4.jpg', thumb_path: '/test/thumb4.jpg', exposure: 0, rating: 2, rejected: false, tags: '', orientation: 1, mime_type: 'image/jpeg', faces: [], rank_score: 1500, match_count: 0, suggested_rating: 2 },
          ]
        };
        if (cmd === 'record_ranking_quad_match') {
          if (args.isTie) {
            return ((args.loserIds || []) as string[]).map((id: string) => ({ id, new_score: 1500, new_suggested_rating: 2, is_winner: false }));
          }
          return [
            { id: args.winnerId, new_score: 1524, new_suggested_rating: 2, is_winner: true },
            ...((args.loserIds || []) as string[]).map((id: string) => ({ id, new_score: 1492, new_suggested_rating: 2, is_winner: false }))
          ];
        }
        if (cmd === 'get_ranking_stats') return { total_photos: 2, total_matches: 0, progress: 0 };
        if (cmd === 'apply_suggested_ratings') return 1;
        return null;
      };

      (window as any).__TAURI_INTERNALS__ = {
        invoke: mockInvoke,
        transformCallback: (id: any) => id,
        convertFileSrc: (path: string) => `asset://${path}`,
        metadata: {},
        plugins: {
            dialog: {
                open: async () => null
            }
        }
      };

      (window as any).__TAURI__ = {
        invoke: mockInvoke,
        convertFileSrc: (path: string) => `asset://${path}`,
        dialog: {
            open: async () => null
        }
      };
    });
    
    await page.goto('/');
  });

  test('should render the app logo', async ({ page }) => {
    await expect(page.locator('img[alt="DamRight Logo"]')).toBeVisible();
  });

  test('should open filmstrip when double clicking a photo', async ({ page }) => {
    const thumb = page.locator('.photo-cell').first();
    await expect(thumb).toBeVisible({ timeout: 15000 });
    await thumb.dblclick();

    await expect(page.locator('.filmstrip-container')).toBeVisible();
    await expect(page.locator('.spinner')).not.toBeVisible();
    await expect(page.locator('.filmstrip-large-view img')).toBeVisible();
  });

  test('should navigate the grid with arrow keys', async ({ page }) => {
    const photos = page.locator('.photo-cell');
    await expect(photos).toHaveCount(2);

    // 1. Select first photo
    await photos.first().click();
    await expect(photos.first()).toHaveClass(/selected/);

    // 2. Press Right Arrow
    await page.keyboard.press('ArrowRight');

    // 3. Verify second photo is selected
    await expect(photos.nth(1)).toHaveClass(/selected/);
    await expect(photos.first()).not.toHaveClass(/selected/);

    // 4. Press Left Arrow
    await page.keyboard.press('ArrowLeft');

    // 5. Verify first photo is selected again
    await expect(photos.first()).toHaveClass(/selected/);
  });

  test('should navigate the filmstrip with arrow keys', async ({ page }) => {
    await page.locator('.photo-cell').first().dblclick();
    await expect(page.locator('.filmstrip-container')).toBeVisible();

    // Verify first photo is active in filmstrip
    await expect(page.locator('.filmstrip-thumb').first()).toHaveClass(/active/);

    // Navigate right
    await page.keyboard.press('ArrowRight');

    // Verify second photo is active
    await expect(page.locator('.filmstrip-thumb').nth(1)).toHaveClass(/active/);
    await expect(page.locator('.filmstrip-thumb').first()).not.toHaveClass(/active/);
  });

  test('should load slideshow via /slideshow route and handle exit', async ({ page }) => {
    // 1. Navigate to slideshow view
    await page.goto('/slideshow?interval=5');

    // 2. Verify slideshow is visible
    const container = page.locator('.slideshow-container');
    await expect(container).toBeVisible();
    
    // 3. Verify clock overlay is visible
    const clock = page.locator('.slideshow-clock');
    await expect(clock).toBeVisible();

    // 4. Press Escape to exit
    await page.keyboard.press('Escape');

    // 5. Verify slideshow is closed and grid is back
    await expect(container).not.toBeVisible();
    await expect(page.locator('img[alt="DamRight Logo"]')).toBeVisible();
  });

  test('should open slideshow modal, configure filters, and launch slideshow', async ({ page }) => {
    // Click header Tv button to open modal
    await page.locator('button[title="Configure & Start Slideshow"]').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await expect(page.getByText('Slideshow & Kiosk Configuration')).toBeVisible();

    // Click Start Slideshow button inside modal
    await page.locator('.modal-footer').getByRole('button', { name: 'Start Slideshow', exact: true }).click();

    // Verify slideshow container is visible
    const container = page.locator('.slideshow-container');
    await expect(container).toBeVisible();

    // Press Escape to exit
    await page.keyboard.press('Escape');
    await expect(container).not.toBeVisible();
  });

  test('should navigate to Rank view and allow voting in Best of 4 and 1 vs 1', async ({ page }) => {
    // Click header Rank button
    await page.locator('button[data-testid="nav-rank-btn"]').click();
    await expect(page.locator('[data-testid="rater-view"]')).toBeVisible();

    // Verify Best of 4 cards are rendered by default
    await expect(page.locator('[data-testid="vote-photo-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="vote-photo-2"]')).toBeVisible();

    // Vote for photo 1 in Best of 4
    await page.locator('[data-testid="vote-photo-1"]').click();

    // Switch to 1 vs 1 mode
    await page.locator('[data-testid="mode-pair-btn"]').click();
    await expect(page.locator('[data-testid="vote-photo-a"]')).toBeVisible();
    await expect(page.locator('[data-testid="vote-photo-b"]')).toBeVisible();

    // Vote for photo A in 1 vs 1
    await page.locator('[data-testid="vote-photo-a"]').click();

    // Verify rater view stays active and ready
    await expect(page.locator('[data-testid="rater-view"]')).toBeVisible();
  });
});
