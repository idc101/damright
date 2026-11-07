import { test, expect } from '@playwright/test';

test.describe('Mobile Web Experience', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the HTTP API (Fetch) for the web version
    await page.route('**/api/photos*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
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
        ]),
      });
    });

    await page.route('**/api/tags', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/people', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/api/sources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'src1', path: '/test', name: 'Test Source' }]),
      });
    });

    await page.route('**/api/tree*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'test',
          path: '/test',
          children: [],
          photo_count: 2
        }),
      });
    });

    await page.route('**/api/preview*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/jpeg', body: '' });
    });

    // Go to web.html instead of root /
    await page.goto('/web.html');
  });

  test('should render the bottom navigation bar', async ({ page }) => {
    const bottomNav = page.locator('.web-nav');
    await expect(bottomNav).toBeVisible();
    
    // Check for the main web-nav items
    await expect(page.getByRole('button', { name: 'Photos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Folders' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tags' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'People' })).toBeVisible();
  });

  test('should switch between tabs via bottom nav', async ({ page }) => {
    // Click Folders tab
    await page.getByRole('button', { name: 'Folders' }).click();
    await expect(page.getByRole('button', { name: 'Folders' })).toHaveClass(/active/);
    
    // In Folders mode, we should see the list section
    await expect(page.locator('.web-list-section')).toBeVisible();

    // Click Photos tab to go back
    await page.getByRole('button', { name: 'Photos' }).click();
    await expect(page.getByRole('button', { name: 'Photos' })).toHaveClass(/active/);
    
    // Check that we're back in the grid
    await expect(page.locator('.web-grid')).toBeVisible();
    await expect(page.locator('.web-grid-item')).toHaveCount(2);
  });

  test('should show metadata overlay when a photo is selected and info is opened', async ({ page }) => {
    // Switch to Photos tab
    await page.getByRole('button', { name: 'Photos' }).click();

    // Select the first photo
    const firstPhoto = page.locator('.web-grid-item').first();
    await expect(firstPhoto).toBeVisible();
    
    // Single click to open viewer in web app
    await firstPhoto.click();
    
    await expect(page.locator('.web-viewer')).toBeVisible();
    
    // Open info drawer
    const infoBtn = page.locator('.web-viewer-info-trigger');
    await expect(infoBtn).toBeVisible();
    await infoBtn.click();
    
    // Check that metadata overlay/drawer is visible
    await expect(page.locator('.web-info-drawer')).toBeVisible();
    await expect(page.locator('.web-info-drawer')).toHaveClass(/open/);
  });

  test('should hide desktop sidebar by default in mobile layout', async ({ page }) => {
    // The desktop sidebar (aside.sidebar) should not be present in WebApp
    const sidebar = page.locator('aside.sidebar');
    await expect(sidebar).not.toBeAttached();
  });

  test('should drill into folder and navigate back via header button', async ({ page }) => {
    // Navigate to Folders
    await page.getByRole('button', { name: 'Folders' }).click();
    await expect(page.locator('.web-list-section')).toBeVisible();

    // Click the source item
    await page.locator('.web-list-item').first().click();

    // The header should now show back button and folder title
    const backBtn = page.locator('.web-nav-back-btn');
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toContainText('Folders');

    // Clicking back returns to root folders
    await backBtn.click();
    await expect(page.locator('.web-list-section')).toBeVisible();
  });

  test('should open and close search bar from header search button', async ({ page }) => {
    // In Photos tab, click Search action button in header
    const searchToggle = page.locator('.web-header-action-btn[title="Search"]');
    await expect(searchToggle).toBeVisible();
    await searchToggle.click();

    // Search input should be visible
    const searchInput = page.locator('.web-header-search-form input');
    await expect(searchInput).toBeVisible();

    // Click Cancel
    const cancelBtn = page.locator('.web-search-cancel-btn');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Search form should be dismissed and normal header visible
    await expect(page.locator('.web-header-search-form')).not.toBeVisible();
    await expect(page.locator('.web-header-title')).toBeVisible();
  });

  test('should load slideshow via /slideshow path in web app and handle exit', async ({ page }) => {
    await page.goto('/slideshow?interval=5');

    const container = page.locator('.slideshow-container');
    await expect(container).toBeVisible();

    const clock = page.locator('.slideshow-clock');
    await expect(clock).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(container).not.toBeVisible();
  });

  test('should switch timeline zoom levels between Years, Months, and All', async ({ page }) => {
    // Check that segmented control exists
    const segmentedControl = page.locator('.web-segmented-control');
    await expect(segmentedControl).toBeVisible();

    // Click Years button
    await page.getByRole('button', { name: 'Years' }).click();
    await expect(page.locator('.timeline-years-container')).toBeVisible();

    // Click Months button
    await page.getByRole('button', { name: 'Months' }).click();
    await expect(page.locator('.timeline-months-container')).toBeVisible();

    // Click All button to return to grid
    await page.getByRole('button', { name: 'All' }).click();
    await expect(page.locator('.web-grid')).toBeVisible();
  });
});

