import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('mobile layout keeps the panel usable as a bottom sheet', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'PMTiles Extract Tool' })).toBeVisible()
  await expect(page.locator('.map canvas').first()).toBeVisible()

  // All three tabs reachable.
  await page.getByRole('button', { name: 'Custom export' }).click()
  await expect(page.getByRole('button', { name: 'Draw rectangle' })).toBeVisible()
  await page.getByRole('button', { name: /Jobs/ }).click()
  await expect(page.getByText(/No export jobs yet/)).toBeVisible()
  await page.getByRole('button', { name: 'Regions' }).click()
  await expect(page.getByLabel('Search regions')).toBeVisible()

  // The panel collapses out of the way of the map.
  await page.getByRole('button', { name: 'Collapse panel' }).click()
  await expect(page.getByLabel('Search regions')).toBeHidden()
  await page.screenshot({ path: 'test-results/mobile-collapsed.png' })
  await page.getByRole('button', { name: 'Expand panel' }).click()
  await expect(page.getByLabel('Search regions')).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile-regions.png' })
})
