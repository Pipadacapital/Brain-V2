// @paradigm: sql
// Playwright smoke test — CF-C6-RUNNABLE-HARNESS-1.
// "I can SEE it run" acceptance gate.
// Runs against the LOCAL harness (pnpm dev + StubDataPlane).
//
// Flow: login → workspace → Command Center renders → P&L waterfall renders
//   → open drill drawer → see source rows → close drawer.
//
// These tests require the LOCAL harness to be running:
//   cd Brain && pnpm dev (starts api-gateway on :3001 + web on :3000)

import { test, expect } from '@playwright/test';

const STUB_EMAIL = 'founder@sugandhlok.com';
const STUB_PASSWORD = 'brain-local-dev';

test.describe('Command Center — Sugandh-Lok seed render smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Brain' })).toBeVisible();
  });

  test('login → dashboard renders Sugandh-Lok KPI values', async ({ page }) => {
    // Login with stub credentials
    await page.getByLabel('Work email').fill(STUB_EMAIL);
    await page.getByLabel('Password').fill(STUB_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Dashboard should load
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();

    // KPI strip renders — the Sugandh-Lok seed has net_revenue_mu = 185_000_000n paise
    // formatMoney(185_000_000n, 'INR') → "₹18.50 L"
    await expect(page.getByText('₹18.50 L')).toBeVisible({ timeout: 10_000 });

    // CM2 = 32_000_000n paise → "₹3.20 L"
    await expect(page.getByText('₹3.20 L')).toBeVisible();

    // ROAS = 285 (scale=100) → "2.85×"
    await expect(page.getByText('2.85×')).toBeVisible();

    // Orders = 1247n → "1,247"
    await expect(page.getByText('1,247')).toBeVisible();
  });

  test('P&L waterfall renders and shows chart', async ({ page }) => {
    await page.getByLabel('Work email').fill(STUB_EMAIL);
    await page.getByLabel('Password').fill(STUB_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/dashboard/);

    // Waterfall section is visible
    await expect(page.getByRole('region', { name: /P&L \/ CM Waterfall/i })).toBeVisible();

    // SVG chart with accessible title is present
    await expect(page.locator('[role="img"]').filter({ hasText: /waterfall/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('drill drawer opens on "Source rows" click and shows metric rows', async ({ page }) => {
    await page.getByLabel('Work email').fill(STUB_EMAIL);
    await page.getByLabel('Password').fill(STUB_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText('₹18.50 L')).toBeVisible({ timeout: 10_000 });

    // Click "Source rows" on Net Revenue card
    const drillBtn = page.getByRole('button', { name: /source rows for net revenue/i });
    await drillBtn.click();

    // Drawer opens
    await expect(page.getByRole('dialog', { name: /source rows/i })).toBeVisible();

    // Drawer shows date-stamped rows
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('table')).toBeVisible({ timeout: 8_000 });

    // Close the drawer via the close button
    await page.getByRole('button', { name: /close source rows drawer/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('escape key closes drill drawer (a11y)', async ({ page }) => {
    await page.getByLabel('Work email').fill(STUB_EMAIL);
    await page.getByLabel('Password').fill(STUB_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText('₹18.50 L')).toBeVisible({ timeout: 10_000 });

    // Open drill
    await page.getByRole('button', { name: /source rows for net revenue/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Escape closes it
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('workspace switcher renders workspace info', async ({ page }) => {
    await page.getByLabel('Work email').fill(STUB_EMAIL);
    await page.getByLabel('Password').fill(STUB_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/dashboard/);

    // Top nav contains workspace switcher
    await expect(page.getByRole('button', { name: /current workspace/i })).toBeVisible();
  });

  test('unauthenticated visit to /dashboard redirects to sign-in', async ({ page }) => {
    // No login — directly navigate to dashboard
    await page.goto('/dashboard');

    // Should see the sign-in link or login page prompt
    await expect(page.getByText(/sign in/i)).toBeVisible({ timeout: 5_000 });
  });
});
