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

test('the Generate extract button is reachable and clickable on mobile', async ({ page }) => {
  await page.goto('/')

  // Select a region from the bottom-sheet: its card floats above the sheet.
  await page.getByLabel('Search regions').fill('Europe')
  await page.getByText('Europe', { exact: true }).click()
  const card = page.getByTestId('region-card')
  await expect(card).toBeVisible()

  const button = page.getByRole('button', { name: 'Generate extract' })

  // The card must sit clear of the bottom sheet and the button must be the
  // topmost element at its centre (nothing overlays it).
  const clear = await page.evaluate(() => {
    const cardEl = document.querySelector('[data-testid="region-card"]') as HTMLElement
    const panel = document.querySelector('.panel') as HTMLElement
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Generate extract',
    ) as HTMLElement
    const b = btn.getBoundingClientRect()
    const topEl = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    return {
      aboveSheet: cardEl.getBoundingClientRect().bottom <= panel.getBoundingClientRect().top + 1,
      buttonOnTop: topEl === btn || btn.contains(topEl),
    }
  })
  expect(clear.aboveSheet).toBe(true)
  expect(clear.buttonOnTop).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-region-card.png' })

  // And it genuinely responds to a tap.
  await button.click()
  await expect(page.getByText(/Generating extract|Queued/)).toBeVisible()
})
