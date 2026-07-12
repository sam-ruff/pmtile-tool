import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createExportViaDraw, mapState } from './helpers'

// The mock build has no basemap layer (no /tiles backend), so assertions rely
// on the controller style probes plus the preview applyStyle path.

test('preset switch restyles the map and persists across reloads', async ({ page }) => {
  await page.goto('/')
  expect((await mapState(page)).styleId).toBe('light')
  const lightBackground = (await mapState(page)).styleBackground

  await page.getByTestId('style-picker-button').click()
  await page.getByTestId('style-option-dark').click()

  const dark = await mapState(page)
  expect(dark.styleId).toBe('dark')
  expect(dark.styleBackground).not.toBe(lightBackground)

  await page.reload()
  expect((await mapState(page)).styleId).toBe('dark')
  await expect(page.getByTestId('style-picker-button')).toContainText('Dark')
})

test('custom styles can be created, edited and deleted', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('style-picker-button').click()
  await page.getByTestId('style-new').click()
  await page.getByTestId('style-name').fill('Night ops')
  await page.getByTestId('style-base').selectOption('black')
  await page.getByTestId('colour-water').fill('#123456')
  await page.getByTestId('style-save').click()

  const custom = await mapState(page)
  expect(custom.styleId).toMatch(/^custom-/)
  expect(custom.styleWater).toBe('#123456')
  await expect(page.getByTestId('style-picker-button')).toContainText('Night ops')

  await page.reload()
  expect((await mapState(page)).styleWater).toBe('#123456')

  // Advanced per-field override via the editor.
  await page.getByTestId('style-picker-button').click()
  await page.getByTestId(`style-edit-${custom.styleId}`).click()
  await page.locator('.advanced summary').click()
  await page.getByTestId('colour-field-boundaries').fill('#ff00ff')
  await page.getByTestId('style-save').click()
  await page.reload()
  await page.getByTestId('style-picker-button').click()

  // Deleting the selected custom falls back to its base preset.
  const deleteButton = page.getByTestId(`style-delete-${custom.styleId}`)
  await deleteButton.click()
  await expect(deleteButton).toContainText('Confirm?')
  await deleteButton.click()
  expect((await mapState(page)).styleId).toBe('black')
})

test('switching styles while previewing keeps the preview alive', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto('/')
  await createExportViaDraw(page, 'styled preview')
  await page.getByRole('button', { name: /Jobs/ }).click()
  await expect(page.getByRole('button', { name: 'Preview on map' })).toBeVisible({
    timeout: 10_000,
  })
  await page.getByRole('button', { name: 'Preview on map' }).click()
  const before = await mapState(page)
  expect(before.previewUrl).toContain('/download')

  await page.getByTestId('style-picker-button').click()
  await page.getByTestId('style-option-grayscale').click()

  const after = await mapState(page)
  expect(after.styleId).toBe('grayscale')
  expect(after.previewUrl).toBe(before.previewUrl)
  // The mock download URL has no backend, so the PMTiles fetch itself fails
  // with a 502; anything else (sprite loads, style application) must be clean.
  const unexpected = pageErrors.filter((e) => !/Bad response code/.test(e.message))
  expect(unexpected).toEqual([])
})

test('download style produces a paired MapLibre style.json', async ({ page }) => {
  await page.goto('/')
  await createExportViaDraw(page, 'style download test')
  await page.getByRole('button', { name: /Jobs/ }).click()
  await expect(page.getByTestId('download-style')).toBeVisible({ timeout: 10_000 })

  await page.getByTestId('style-picker-button').click()
  await page.getByTestId('style-option-dark').click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-style').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('style-download-test.style.json')

  const path = await download.path()
  const style = JSON.parse(await readFile(path, 'utf-8'))
  expect(style.version).toBe(8)
  expect(style.sources.protomaps.url).toMatch(/^pmtiles:\/\//)
  expect(style.sprite).toBe('https://protomaps.github.io/basemaps-assets/sprites/v4/dark')
  expect(style.layers.length).toBeGreaterThan(0)
  expect(style.metadata['pmtile-tool:style']).toEqual({ base: 'dark', overrides: {} })
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('style picker is reachable and works on a phone', async ({ page }) => {
    await page.goto('/')
    const button = page.getByTestId('style-picker-button')
    await expect(button).toBeVisible()
    await button.click()
    await expect(page.getByTestId('style-popover')).toBeVisible()
    await page.screenshot({ path: 'test-results/mobile-style-picker.png' })
    await page.getByTestId('style-option-dark').click()
    expect((await mapState(page)).styleId).toBe('dark')
  })
})
