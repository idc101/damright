import { test, expect } from '@playwright/test';

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      const mockInvoke = async (cmd: string, args: any) => {
        if (cmd === 'get_all_photos') {
          return [
            { id: 'p1', path: '/test/1.jpg', tags: 'vacation', rating: 0, exposure: 0, thumb_path: '', rejected: false, orientation: 1, mime_type: 'image/jpeg' },
            { id: 'p2', path: '/test/sub/2.jpg', tags: 'work', rating: 0, exposure: 0, thumb_path: '', rejected: false, orientation: 1, mime_type: 'image/jpeg' }
          ];
        }
        if (cmd === 'get_all_sources') return [
          { id: 'src1', path: '/test', name: 'Test Source' }
        ];
        if (cmd === 'get_dir_tree') {
          if (args.path === '/test') {
            return {
              name: 'test',
              path: '/test',
              children: [
                { name: 'sub', path: '/test/sub', children: [], photo_count: 1 }
              ],
              photo_count: 2
            };
          }
          return { name: 'sub', path: '/test/sub', children: [], photo_count: 1 };
        }
        if (cmd === 'get_all_tags') return [
          { name: 'vacation', count: 1 }, 
          { name: 'work', count: 1 }
        ];
        if (cmd === 'get_all_people') return [
          { name: 'Alice', count: 0 }, 
          { name: 'Bob', count: 0 }
        ];
        if (cmd === 'delete_photo') return null;
        if (cmd === 'get_sync_config') return {
          server_sync: {
            endpoint: 'http://localhost:8010',
            enabled: false,
            debounce_minutes: 30,
            folder_rules: {}
          },
          local: { web_port: 8010 }
        };
        if (cmd === 'diff_icloud_photos') return { matched_keep: [], matched_rejected: [], orphaned: [] };
        if (cmd === 'add_photos_to_icloud_album') return 0;
        if (cmd === 'get_inbox_count' || cmd === 'update_inbox_badge') return 0;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return null;
        return null;
      };

      (window as any).__TAURI_INTERNALS__ = {
        invoke: mockInvoke,
        transformCallback: (id: any) => id,
        convertFileSrc: (path: string) => path,
      };
    });
    
    await page.goto('/');
  });

  test('should render folder tree and allow navigation', async ({ page }) => {
    // 1. Verify root node
    const rootNode = page.locator('.tree-node', { hasText: 'test' }).first();
    await expect(rootNode).toBeVisible();
    // Use more specific locator to get the root's count only
    await expect(rootNode.locator('.tree-label').first().locator('.photo-count')).toHaveText('(2)');

    // 2. Sub-node should be visible by default now
    const subNode = page.locator('.tree-node', { hasText: /^sub\(1\)$/ });
    await expect(subNode).toBeVisible();
    await expect(subNode.locator('.photo-count')).toHaveText('(1)');

    // 3. Select subfolder
    await subNode.locator('.node-name').click();
    await expect(subNode.locator('.tree-label')).toHaveClass(/selected/);

    // 4. Verify grid filtered (should only show 1 photo)
    await expect(page.locator('.photo-cell')).toHaveCount(1);
  });

  test('should expand and collapse all folders', async ({ page }) => {
    const subNode = page.locator('.tree-node', { hasText: /^sub\(1\)$/ });
    
    // Should be visible by default
    await expect(subNode).toBeVisible();

    // 1. Collapse All
    await page.locator('button[title="Collapse All"]').click();
    await expect(subNode).not.toBeVisible();

    // 2. Expand All
    await page.locator('button[title="Expand All"]').click();
    await expect(subNode).toBeVisible();
  });

  test('should switch to tags tab and filter by tag', async ({ page }) => {
    // 1. Switch to Tags tab
    await page.locator('button[title="Tags"]').click();
    
    // 2. Verify tags are listed
    await expect(page.locator('.tag-item', { hasText: 'vacation' })).toBeVisible();
    await expect(page.locator('.tag-item', { hasText: 'work' })).toBeVisible();

    // 3. Select a tag
    await page.locator('.tag-item', { hasText: 'vacation' }).click();
    await expect(page.locator('.tag-item', { hasText: 'vacation' })).toHaveClass(/selected/);

    // 4. Verify grid filtered (should only show 1 photo)
    await expect(page.locator('.photo-cell')).toHaveCount(1);

    // 5. Select "All Photos" in tag list
    await page.locator('.tag-item', { hasText: 'All Photos' }).click();
    await expect(page.locator('.photo-cell')).toHaveCount(2);
  });

  test('should switch to people tab and filter by person', async ({ page }) => {
    // 1. Switch to People tab
    await page.locator('button[title="People"]').click();
    
    // 2. Verify people are listed
    await expect(page.locator('.tag-item', { hasText: 'Alice' })).toBeVisible();
    await expect(page.locator('.tag-item', { hasText: 'Bob' })).toBeVisible();

    // 3. Select a person (Note: our mock get_all_photos doesn't have faces, 
    // so we need to adjust the mock or just verify the click state)
    await page.locator('.tag-item', { hasText: 'Alice' }).click();
    await expect(page.locator('.tag-item', { hasText: 'Alice' })).toHaveClass(/selected/);
  });

  test('should collapse and expand sidebar', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggle = page.locator('button[title="Collapse Sidebar"]');

    await toggle.click();
    await expect(sidebar).toHaveClass(/collapsed/);

    const expandToggle = page.locator('button[title="Show Sidebar"]');
    await expandToggle.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  test('should switch modes via header navigation without modifying search bar', async ({ page }) => {
    const searchInput = page.locator('.search-input-wrapper input');
    await expect(searchInput).toHaveValue('');

    // 1. Switch to Duplicates mode
    await page.locator('.header-nav-btn', { hasText: 'Duplicates' }).click();
    await expect(page.locator('.sidebar-tool-header .tool-header-title')).toHaveText('Duplicates');
    await expect(page.locator('.header-nav-btn', { hasText: 'Duplicates' })).toHaveClass(/active/);
    await expect(searchInput).toHaveValue('');

    // 2. Switch to Validation mode
    await page.locator('.header-nav-btn', { hasText: 'Validation' }).click();
    await expect(page.locator('.sidebar-tool-header .tool-header-title')).toHaveText('Validation');
    await expect(page.locator('.header-nav-btn', { hasText: 'Validation' })).toHaveClass(/active/);
    await expect(page.locator('.validation-filter-item', { hasText: 'All Issues' })).toBeVisible();
    await expect(searchInput).toHaveValue('');

    // 3. Switch to iCloud mode
    await page.locator('.header-nav-btn', { hasText: 'iCloud' }).click();
    await expect(page.locator('.sidebar-tool-header .tool-header-title')).toHaveText('iCloud Sync');
    await expect(page.locator('.header-nav-btn', { hasText: 'iCloud' })).toHaveClass(/active/);
    await expect(searchInput).toHaveValue('');

    // 4. Switch back to Library mode
    await page.locator('.header-nav-btn', { hasText: 'Library' }).click();
    await expect(page.locator('button[title="Folders"]')).toBeVisible();
    await expect(page.locator('button[title="Tags"]')).toBeVisible();
    await expect(page.locator('button[title="People"]')).toBeVisible();
    await expect(page.locator('button[title="Quick Collection"]')).toBeVisible();
    await expect(page.locator('.header-nav-btn', { hasText: 'Library' })).toHaveClass(/active/);
    await expect(searchInput).toHaveValue('');
  });

  test('should open Manage Folders & Sync modal from topbar Settings button', async ({ page }) => {
    const settingsBtn = page.locator('button[title="Manage Folders & Sync"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Verify modal appears
    await expect(page.locator('.folder-sync-overlay')).toBeVisible();
    await expect(page.locator('.folder-sync-modal')).toBeVisible();

    // Close modal
    await page.locator('.folder-sync-close').click();
    await expect(page.locator('.folder-sync-overlay')).not.toBeVisible();
  });
});
