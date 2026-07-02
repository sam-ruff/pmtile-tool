import { expect, test } from '@playwright/test'
import { mapState } from './helpers'

test('browsing the tree selects a region and generates its extract', async ({ page }) => {
  await page.goto('/')

  // Expand Europe, pick the UK: the floating card and highlight appear.
  await page.getByRole('button', { name: 'Expand' }).first().click()
  await page.getByText('United Kingdom', { exact: true }).click()

  const card = page.getByTestId('region-card')
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading', { name: 'United Kingdom' })).toBeVisible()
  expect((await mapState(page)).highlightCount).toBe(1)

  // The card floats horizontally centred near the bottom of the map.
  const box = await card.boundingBox()
  const vp = page.viewportSize()
  expect(box).not.toBeNull()
  if (box && vp) {
    expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(20)
    expect(box.y + box.height).toBeGreaterThan(vp.height * 0.6)
  }

  // Generate: queued -> done with a download link (mock finishes in seconds).
  await card.getByRole('button', { name: 'Generate extract' }).click()
  await expect(card.getByRole('link', { name: /Download/ })).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: 'test-results/region-generated.png' })

  // Closing the card clears the selection and the highlight.
  await card.getByRole('button', { name: 'Close region details' }).click()
  await expect(card).toBeHidden()
  expect((await mapState(page)).highlightCount).toBe(0)
})

test('search finds nested regions directly', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Search regions').fill('devon')
  await page.getByText('Devon', { exact: true }).click()

  const card = page.getByTestId('region-card')
  await expect(card.getByRole('heading', { name: 'Devon' })).toBeVisible()
  expect((await mapState(page)).highlightCount).toBe(1)
  await page.screenshot({ path: 'test-results/region-search.png' })
})
