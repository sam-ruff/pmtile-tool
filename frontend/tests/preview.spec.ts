import { expect, test } from './archive-fixture'
import { createExportViaDraw, drawRectangle, mapState, openDownloads } from './helpers'

test('preview shows only the previewed archive and hides the selection', async ({ page, archiveReads }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/')

  await createExportViaDraw(page, 'playwright preview test')
  await page.getByRole('button', { name: 'Adjust and export again' }).click()
  await drawRectangle(page, [700, 500], [820, 580])
  expect((await mapState(page)).drawnCount).toBe(2)

  await openDownloads(page)
  const job = page.locator('li', { hasText: 'playwright preview test' })
  await expect(job.getByRole('button', { name: 'Preview', exact: true })).toBeVisible({ timeout: 10_000 })
  await job.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(job.getByRole('button', { name: 'Hide', exact: true })).toBeVisible()

  const previewing = await mapState(page)
  expect(previewing.previewUrl).toContain('/download')
  expect(previewing.selectionVisible).toBe(false)
  await page.getByRole('button', { name: 'Close downloads' }).click()
  await expect(page.getByTestId('preview-banner')).toContainText('playwright preview test')
  await expect(page.getByTestId('tool-rectangle')).toBeHidden()
  await expect.poll(() => archiveReads.some((read) => read.tileData)).toBe(true)
  expect(pageErrors).toEqual([])
  await page.screenshot({ path: 'test-results/preview-active.png' })

  await page.getByRole('button', { name: 'Exit preview' }).click()
  const restored = await mapState(page)
  expect(restored.previewUrl).toBeNull()
  expect(restored.selectionVisible).toBe(true)
  await expect(page.getByTestId('preview-banner')).toBeHidden()
})

test('Escape leaves preview mode', async ({ page }) => {
  await page.goto('/')
  await createExportViaDraw(page, 'escape preview')
  await openDownloads(page)
  const job = page.locator('li', { hasText: 'escape preview' })
  await job.getByRole('button', { name: 'Preview', exact: true }).click({ timeout: 10_000 })
  await expect(job.getByRole('button', { name: 'Hide', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close downloads' }).click()
  await expect(page.getByTestId('preview-banner')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('preview-banner')).toBeHidden()
})

test('deleting a job asks for confirmation in place', async ({ page }) => {
  await page.goto('/')
  await createExportViaDraw(page, 'to delete')
  await openDownloads(page)
  const job = page.locator('li', { hasText: 'to delete' })
  await expect(job.getByRole('link', { name: 'Download' })).toBeVisible({ timeout: 10_000 })

  await job.getByRole('button', { name: 'Delete to delete' }).click()
  await expect(job.getByText('Delete this file for everyone?')).toBeVisible()
  await job.getByRole('button', { name: 'Cancel' }).click()
  await expect(job.getByRole('link', { name: 'Download' })).toBeVisible()

  await job.getByRole('button', { name: 'Delete to delete' }).click()
  await page.screenshot({ path: 'test-results/delete-confirmation.png' })
  await job.getByTestId('confirm-delete').click()
  await expect(page.getByText('No downloads yet')).toBeVisible()
})
