import { test, expect } from '@playwright/test';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    // Robust Mock for Tauri v2
    await page.addInitScript(() => {
      window.localStorage.clear();
      let photoRating = 0;
      let tagsOpen = false;
      let moveOpen = false;
      let quickCollectionIds: string[] = [];
      let deletedIds: string[] = [];

      const mockInvoke = async (cmd: string, args: any) => {
        if (cmd === 'get_all_photos') {
            return [
                {
                    id: 'photo1',
                    path: '/test/1.jpg',
                    thumb_path: '/test/thumb1.jpg',
                    exposure: 0,
                    rating: photoRating,
                    rejected: false,
                    tags: '',
                    orientation: 1,
                    mime_type: 'image/jpeg',
                    faces: [],
                    in_quick_collection: quickCollectionIds.includes('photo1')
                },
                {
                    id: 'photo2',
                    path: '/test/2.jpg',
                    thumb_path: '/test/thumb2.jpg',
                    exposure: 0,
                    rating: photoRating,
                    rejected: false,
                    tags: '',
                    orientation: 1,
                    mime_type: 'image/jpeg',
                    faces: [],
                    in_quick_collection: quickCollectionIds.includes('photo2')
                }
            ].filter(p => !deletedIds.includes(p.id));
        }
        if (cmd === 'toggle_quick_collection') {
            const ids: string[] = args.ids || [];
            const allIn = ids.length > 0 && ids.every(id => quickCollectionIds.includes(id));
            if (allIn) {
                quickCollectionIds = quickCollectionIds.filter(id => !ids.includes(id));
            } else {
                ids.forEach(id => {
                    if (!quickCollectionIds.includes(id)) quickCollectionIds.push(id);
                });
            }
            return null;
        }
        if (cmd === 'export_photos') return (args.config?.photo_ids || []).length;
        if (cmd === 'get_all_sources') return [
          { id: 'src1', path: '/test', name: 'Test Source' }
        ];
        if (cmd === 'get_dir_tree') return {
            name: 'test',
            path: '/test',
            children: [],
            photo_count: 1
        };
        if (cmd === 'get_all_tags') return [];
        if (cmd === 'get_all_people') return [];
        if (cmd === 'batch_set_metadata') {
            if (args.rating !== undefined) photoRating = args.rating;
            return null;
        }
        if (cmd === 'delete_photo') {
            deletedIds.push(args.id);
            return null;
        }
        if (cmd === 'diff_icloud_photos') return { matched_keep: [], matched_rejected: [], orphaned: [] };
        if (cmd === 'add_photos_to_icloud_album') return 0;
        if (cmd === 'get_inbox_count' || cmd === 'update_inbox_badge') return 0;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return args?.buttons === 'YesNo' ? 'Yes' : 'Ok';
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

  test('should update rating with 1-5 keys', async ({ page }) => {
    const photo = page.locator('.photo-cell').first();
    await expect(photo).toBeVisible();
    await photo.click();
    await expect(photo).toHaveClass(/selected/);

    // Press '5' to set rating to 5
    await page.keyboard.press('5');
    
    // The PhotoGrid shows ratings if they are > 0.
    await expect(page.locator('.rating-overlay .star-icon')).toHaveCount(5);

    // Press '3' to set rating to 3
    await page.keyboard.press('3');
    await expect(page.locator('.rating-overlay .star-icon')).toHaveCount(3);

    // Press '0' to clear rating
    await page.keyboard.press('0');
    await expect(page.locator('.rating-overlay')).not.toBeVisible();
  });

  test('should open move dialog with "m" key', async ({ page }) => {
    const photo = page.locator('.photo-cell').first();
    await expect(photo).toBeVisible();
    await photo.click();

    await page.keyboard.press('m');
    // Title is dynamic: "Move 1 Photo"
    await expect(page.locator('.modal-header h2', { hasText: /Move/ })).toBeVisible();
    
    // Close modal via Cancel button
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal-header h2', { hasText: /Move/ })).not.toBeVisible();
  });

  test('should open tag dialog with "t" key and keep search input empty', async ({ page }) => {
    const photo = page.locator('.photo-cell').first();
    await expect(photo).toBeVisible();
    await photo.click();

    await page.keyboard.press('t');
    await expect(page.locator('.modal-header h2', { hasText: 'Edit Tags' })).toBeVisible();
    await expect(page.locator('.tag-search-wrapper input')).toHaveValue('');

    // Close modal via Cancel button
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal-header h2', { hasText: 'Edit Tags' })).not.toBeVisible();
  });

  test('should show context menu when right clicking in filmstrip view', async ({ page }) => {
    const thumb = page.locator('.photo-cell').first();
    await thumb.dblclick();

    await expect(page.locator('.filmstrip-container')).toBeVisible();
    
    // Right click the large image
    const largeImage = page.locator('.large-photo');
    await expect(largeImage).toBeVisible();
    await largeImage.click({ button: 'right' });

    await expect(page.locator('.context-menu')).toBeVisible();
    await expect(page.locator('.context-menu button', { hasText: 'Reveal in Finder' })).toBeVisible();
  });

  test('should update rating with 1-5 keys in filmstrip mode', async ({ page }) => {
    const thumb = page.locator('.photo-cell').first();
    await thumb.dblclick();
    await expect(page.locator('.filmstrip-container')).toBeVisible();

    // Press '4' to set rating to 4
    await page.keyboard.press('4');
    
    // Check in the bottom bar thumbnail
    await expect(page.locator('.filmstrip-thumb.active .rating-overlay .star-icon')).toHaveCount(4);
  });

  test('should open move dialog with "m" key in filmstrip mode', async ({ page }) => {
    const thumb = page.locator('.photo-cell').first();
    await thumb.dblclick();
    await expect(page.locator('.filmstrip-container')).toBeVisible();

    await page.keyboard.press('m');
    await expect(page.locator('.modal-header h2', { hasText: /Move/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('should show Delete File in context menu and close menu on click', async ({ page }) => {
    const thumb = page.locator('.photo-cell').first();
    await thumb.click({ button: 'right' });

    await expect(page.locator('.context-menu')).toBeVisible();
    const deleteBtn = page.locator('.context-menu button', { hasText: 'Delete File' });
    await expect(deleteBtn).toBeVisible();

    await deleteBtn.click();
    await expect(page.locator('.context-menu')).not.toBeVisible();
  });

  test('should select all photos with Cmd+A or Ctrl+A shortcut', async ({ page }) => {
    const photos = page.locator('.photo-cell');
    await expect(photos).toHaveCount(2);
    await photos.first().click();

    await page.keyboard.press('Control+a');

    await expect(photos.nth(0)).toHaveClass(/selected/);
    await expect(photos.nth(1)).toHaveClass(/selected/);
  });

  test('should toggle photo in/out of Quick Collection with "b" key', async ({ page }) => {
    const photo = page.locator('.photo-cell').first();
    await expect(photo).toBeVisible();
    await photo.click();

    // Press 'b' to add to quick collection
    await page.keyboard.press('b');
    await expect(page.locator('[data-testid="quick-collection-badge"]').first()).toBeVisible();

    // Press 'b' again to remove from quick collection
    await page.keyboard.press('b');
    await expect(page.locator('[data-testid="quick-collection-badge"]')).not.toBeVisible();
  });

  test('should open Export dialog with Cmd+E or Ctrl+E shortcut', async ({ page }) => {
    const photo = page.locator('.photo-cell').first();
    await expect(photo).toBeVisible();
    await photo.click();

    await page.keyboard.press('Control+e');
    await expect(page.locator('[data-testid="export-modal"]')).toBeVisible();
  });

  test('should delete selected photo with Delete key', async ({ page }) => {
    const photos = page.locator('.photo-cell');
    await expect(photos).toHaveCount(2);
    await photos.first().click();

    await page.keyboard.press('Delete');
    await expect(photos).toHaveCount(1);
  });

  test('should delete selected photo with Backspace key', async ({ page }) => {
    const photos = page.locator('.photo-cell');
    await expect(photos).toHaveCount(2);
    await photos.first().click();

    await page.keyboard.press('Backspace');
    await expect(photos).toHaveCount(1);
  });
});
