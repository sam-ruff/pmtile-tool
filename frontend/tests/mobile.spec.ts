import { expect, test } from '@playwright/test'
import { mapState } from './helpers'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

async function sheetHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => document.querySelector('[data-map-inset]')?.getBoundingClientRect().height ?? 0)
}

/// Height once the sheet's snap transition has settled.
async function settledHeight(page: import('@playwright/test').Page): Promise<number> {
  let last = -1
  await expect
    .poll(async () => {
      const now = await sheetHeight(page)
      const stable = now === last
      last = now
      return stable
    })
    .toBe(true)
  return last
}

test('the steps live in a bottom sheet that resizes from its handle', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.map canvas').first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible()
  await expect(page.getByLabel('Search regions')).toBeVisible()

  const half = await settledHeight(page)
  await page.getByRole('button', { name: 'Expand panel' }).click()
  const full = await settledHeight(page)
  expect(full).toBeGreaterThan(half)
  await page.getByRole('button', { name: 'Shrink panel' }).click()
  const peek = await settledHeight(page)
  expect(peek).toBeLessThan(half)
  await page.screenshot({ path: 'test-results/mobile-peek.png' })
})

test('picking a drawing tool tucks the sheet away and drawing works', async ({ page }) => {
  await page.goto('/')
  const before = await settledHeight(page)
  await page.getByTestId('tool-rectangle').click()
  const tucked = await settledHeight(page)
  expect(tucked).toBeLessThan(before)

  await page.mouse.click(120, 260)
  await page.mouse.move(240, 360)
  await page.mouse.click(240, 360)
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(1)
  await expect(page.getByTestId('next-step')).toBeEnabled()
  await page.screenshot({ path: 'test-results/mobile-drawn.png' })
})

test('the region card button is reachable and responds on a phone', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Search regions').fill('Cornwall')
  await page.getByRole('button', { name: /Cornwall/ }).first().click()
  const card = page.getByTestId('region-card')
  await expect(card).toBeVisible()

  const onTop = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="region-generate"]') as HTMLElement
    const box = button.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return top === button || button.contains(top)
  })
  expect(onTop).toBe(true)
  await card.getByTestId('region-generate').click()
  await expect(card.getByText(/Waiting in the queue|Being prepared now/)).toBeVisible()
})

test('downloads open as a sheet from the toolbar', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('open-downloads').click()
  await expect(page.getByText('No downloads yet')).toBeVisible()
  await page.getByRole('button', { name: 'Close downloads' }).click()
  await expect(page.getByTestId('downloads')).toBeHidden()
})
