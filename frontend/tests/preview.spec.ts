import { expect, test } from '@playwright/test'
import { createExportViaDraw, mapState } from './helpers'

test('preview shows only the previewed archive and hides other selections', async ({ page }) => {
  await page.goto('/')

  // Select a region: highlight appears and the floating card shows.
  await page.getByRole('button', { name: 'Expand' }).first().click()
  await page.getByText('United Kingdom', { exact: true }).click()
  await expect(page.getByTestId('region-card')).toBeVisible()
  expect((await mapState(page)).highlightCount).toBe(1)

  // Draw and submit an export so a drawn polygon also exists on the map.
  await createExportViaDraw(page, 'playwright preview test')

  // The mock job finishes in a few seconds.
  await page.getByRole('button', { name: /Jobs/ }).click()
  await expect(page.getByText('playwright preview test')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview on map' })).toBeVisible({
    timeout: 10_000,
  })

  // Draw again without submitting so a highlight AND a drawn shape are on the map.
  await page.getByRole('button', { name: 'Custom export' }).click()
  await page.getByRole('button', { name: 'Draw rectangle' }).click()
  await page.mouse.click(700, 500)
  await page.mouse.move(820, 580)
  await page.mouse.click(820, 580)
  await expect(page.getByText('Estimated size')).toBeVisible()
  expect((await mapState(page)).drawnCount).toBe(1)
  await expect(page.getByTestId('region-card')).toBeVisible()

  // Turn the preview on: every other selection must disappear.
  await page.getByRole('button', { name: /Jobs/ }).click()
  await page.getByRole('button', { name: 'Preview on map' }).click()

  await expect(page.getByTestId('region-card')).toBeHidden()
  const previewing = await mapState(page)
  expect(previewing.previewUrl).toContain('/download')
  expect(previewing.highlightVisible).toBe(false)
  expect(previewing.drawVisible).toBe(false)
  await expect(page.getByRole('button', { name: 'Hide preview' })).toBeVisible()
  await page.screenshot({ path: 'test-results/preview-active.png' })

  // Turning it off restores the hidden selections.
  await page.getByRole('button', { name: 'Hide preview' }).click()
  const restored = await mapState(page)
  expect(restored.previewUrl).toBeNull()
  expect(restored.highlightVisible).toBe(true)
  expect(restored.drawVisible).toBe(true)
  await expect(page.getByTestId('region-card')).toBeVisible()
  await page.screenshot({ path: 'test-results/preview-restored.png' })
})

test('deleting a job requires confirmation', async ({ page }) => {
  await page.goto('/')
  await createExportViaDraw(page)

  await page.getByRole('button', { name: /Jobs/ }).click()
  const deleteButton = page.getByRole('button', { name: 'Delete' })
  await expect(deleteButton).toBeVisible()

  // First click arms the button; the job must survive.
  await deleteButton.click()
  const confirm = page.getByRole('button', { name: 'Confirm delete?' })
  await expect(confirm).toBeVisible()
  await page.screenshot({ path: 'test-results/delete-confirmation.png' })

  // Second click deletes.
  await confirm.click()
  await expect(page.getByText('No export jobs yet', { exact: false })).toBeVisible()
})
