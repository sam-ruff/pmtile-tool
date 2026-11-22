import { expect, test } from '@playwright/test'
import { mapState, openDownloads } from './helpers'

test('inspecting a region shows its card and prepares a ready-made download', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand Europe' }).click()
  await page.getByTestId('region-united-kingdom').click()

  const card = page.getByTestId('region-card')
  await expect(card.getByRole('heading', { name: 'United Kingdom' })).toBeVisible()
  await expect(card).toContainText('Europe')
  await expect.poll(async () => (await mapState(page)).inspectCount).toBe(1)
  // Size before committing.
  await expect(card).toContainText(/About .* at full detail/)

  await card.getByTestId('region-generate').click()
  await expect(card.getByRole('link', { name: /Download/ })).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: 'test-results/region-generated.png' })

  // Ready-made files are listed with the rest of the downloads.
  await openDownloads(page)
  await expect(page.getByTestId('downloads')).toContainText('United Kingdom')
  await page.getByRole('button', { name: 'Close downloads' }).click()

  await card.getByRole('button', { name: 'Close region details' }).click()
  await expect(card).toBeHidden()
  expect((await mapState(page)).inspectCount).toBe(0)
})

test('the card can add the region to your area and take it out again', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Search regions').fill('devon')
  await page.getByRole('button', { name: /Devon/ }).first().click()
  const card = page.getByTestId('region-card')
  await card.getByTestId('region-toggle-area').click()
  await expect(card.getByTestId('region-toggle-area')).toHaveText(/In your area/)
  await expect.poll(async () => (await mapState(page)).regionCount).toBe(1)
  await card.getByTestId('region-toggle-area').click()
  await expect.poll(async () => (await mapState(page)).regionCount).toBe(0)
})

test('search highlights matches and shows where each region sits', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Search regions').fill('dev')
  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.locator('mark')).toHaveText('Dev')
  await expect(results).toContainText('Europe / United Kingdom / England')
  await page.screenshot({ path: 'test-results/region-search.png' })
})

test('the region tree works from the keyboard', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand Europe' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('region-germany')).toBeVisible()
  await page.getByTestId('region-germany').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('region-card').getByRole('heading', { name: 'Germany' })).toBeVisible()
})
