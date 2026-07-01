import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export interface MapProbe {
  previewUrl: string | null
  highlightVisible: boolean
  drawVisible: boolean
  highlightCount: number
  drawnCount: number
}

/// State probes installed by the map controller in mock/dev builds.
export async function mapState(page: Page): Promise<MapProbe> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __pmtilesTest: {
          previewUrl: () => string | null
          highlightLayerVisible: () => boolean
          drawLayerVisible: () => boolean
          highlightCount: () => number
          drawnCount: () => number
        }
      }
    ).__pmtilesTest
    return {
      previewUrl: hooks.previewUrl(),
      highlightVisible: hooks.highlightLayerVisible(),
      drawVisible: hooks.drawLayerVisible(),
      highlightCount: hooks.highlightCount(),
      drawnCount: hooks.drawnCount(),
    }
  })
}

/// Draw a rectangle on the map and submit it as an export job.
export async function createExportViaDraw(page: Page, name?: string) {
  await page.getByRole('button', { name: 'Custom export' }).click()
  await page.getByRole('button', { name: 'Draw rectangle' }).click()
  await page.mouse.click(760, 380)
  await page.mouse.move(880, 470)
  await page.mouse.click(880, 470)
  await expect(page.getByText('Estimated size')).toBeVisible()
  if (name) {
    await page.getByLabel(/Name/).fill(name)
  }
  await page.getByRole('button', { name: 'Create export job' }).click()
  await expect(page.getByText('Export queued')).toBeVisible()
}
