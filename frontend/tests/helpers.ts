import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

export interface MapProbe {
  previewUrl: string | null
  selectionVisible: boolean
  drawnCount: number
  regionCount: number
  inspectCount: number
  drawnVertexCounts: number[]
  tool: string
  selectedShape: string | null
  styleId: string
  styleBackground: string
  styleWater: string
}

/// State probes installed by the map controller in mock/dev builds.
export async function mapState(page: Page): Promise<MapProbe> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __pmtilesTest: Record<string, () => unknown> })
      .__pmtilesTest
    return {
      previewUrl: hooks.previewUrl(),
      selectionVisible: hooks.selectionVisible(),
      drawnCount: hooks.drawnCount(),
      regionCount: hooks.regionCount(),
      inspectCount: hooks.inspectCount(),
      drawnVertexCounts: hooks.drawnVertexCounts(),
      tool: hooks.tool(),
      selectedShape: hooks.selectedShape(),
      styleId: hooks.styleId(),
      styleBackground: hooks.styleBackground(),
      styleWater: hooks.styleWater(),
    } as MapProbe
  })
}

/// Rectangle by two clicks, then back to the select tool.
export async function drawRectangle(page: Page, from: [number, number], to: [number, number]) {
  const before = (await mapState(page)).drawnCount
  await page.getByTestId('tool-rectangle').click()
  await page.mouse.click(from[0], from[1])
  await page.mouse.move(to[0], to[1])
  await page.mouse.click(to[0], to[1])
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(before + 1)
  await page.keyboard.press('Escape')
}

/// Freehand loop dragged around a centre point.
export async function drawFreehand(page: Page, centre: [number, number], radius: number, steps = 60) {
  const before = (await mapState(page)).drawnCount
  await page.getByTestId('tool-freehand').click()
  const point = (i: number): [number, number] => {
    const t = (i / steps) * Math.PI * 2
    return [centre[0] + Math.cos(t) * radius, centre[1] + Math.sin(t) * radius]
  }
  const [sx, sy] = point(0)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  for (let i = 1; i <= steps; i += 1) {
    const [x, y] = point(i)
    await page.mouse.move(x, y)
  }
  await page.mouse.up()
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(before + 1)
  await page.keyboard.press('Escape')
}

/// From a populated area step through to a created extract.
export async function finishExport(page: Page, name?: string) {
  await page.getByTestId('next-step').click()
  await expect(page.getByTestId('estimate').locator('.size')).toBeVisible()
  await page.getByTestId('next-step').click()
  if (name) await page.getByLabel(/File name/).fill(name)
  await page.getByTestId('create-extract').click()
  await expect(page.getByTestId('export-created')).toBeVisible()
}

/// Draw one rectangle and export it.
export async function createExportViaDraw(page: Page, name?: string) {
  await drawRectangle(page, [760, 380], [880, 470])
  await finishExport(page, name)
}

export async function openDownloads(page: Page) {
  await page.getByTestId('open-downloads').first().click()
  await expect(page.getByTestId('downloads')).toBeVisible()
}

export async function closeDownloads(page: Page) {
  await page.getByRole('button', { name: 'Close downloads' }).click()
  await expect(page.getByTestId('downloads')).toBeHidden()
}
