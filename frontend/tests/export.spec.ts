import { expect, test } from '@playwright/test'
import {
  createExportViaDraw,
  drawFreehand,
  drawRectangle,
  finishExport,
  mapState,
  openDownloads,
} from './helpers'

test('the area step cannot advance until something is chosen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('next-step')).toBeDisabled()
  await drawRectangle(page, [760, 380], [880, 470])
  await expect(page.getByTestId('next-step')).toBeEnabled()
})

test('two separate shapes become one named extract', async ({ page }) => {
  await page.goto('/')
  await drawRectangle(page, [600, 300], [680, 360])
  await drawRectangle(page, [1000, 500], [1100, 580])

  expect((await mapState(page)).drawnCount).toBe(2)
  await expect(page.getByTestId('area-item-drawn')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: 'Your area (2)' })).toBeVisible()

  await page.getByTestId('next-step').click()
  await expect(page.getByTestId('estimate').locator('.size')).toBeVisible()
  await page.getByTestId('next-step').click()
  await expect(page.getByText('2 drawn shapes')).toBeVisible()
  // The public-output warning sits next to the action that publishes.
  await expect(page.getByRole('note')).toContainText('Extracts are public')
  await page.getByLabel(/File name/).fill('two areas')
  await page.getByTestId('create-extract').click()
  await expect(page.getByTestId('export-created')).toContainText('two areas')

  await page.getByRole('button', { name: 'Open downloads' }).click()
  const job = page.locator('li', { hasText: 'two areas' })
  await expect(job).toBeVisible()
  await expect(job.getByRole('link', { name: 'Download' })).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: 'test-results/export-done.png' })
})

test('freehand drawing is simplified well under the vertex cap', async ({ page }) => {
  await page.goto('/')
  await drawFreehand(page, [900, 450], 80, 120)
  const [vertices] = (await mapState(page)).drawnVertexCounts
  expect(vertices).toBeGreaterThan(3)
  expect(vertices).toBeLessThan(120)
  await expect(page.getByText(/Freehand 1/)).toBeVisible()
})

test('Escape cancels a polygon in progress, then leaves the tool', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tool-polygon').click()
  await page.mouse.click(700, 400)
  await page.mouse.click(800, 420)
  await expect(page.getByRole('button', { name: 'Finish shape' })).toBeVisible()

  await page.keyboard.press('Escape')
  let state = await mapState(page)
  expect(state.drawnCount).toBe(0)
  expect(state.tool).toBe('polygon')

  await page.keyboard.press('Escape')
  state = await mapState(page)
  expect(state.tool).toBe('select')
})

test('a polygon can be finished with the toolbar after undoing a point', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tool-polygon').click()
  await page.mouse.click(700, 400)
  await page.mouse.click(820, 400)
  await page.mouse.click(900, 480)
  await page.mouse.click(760, 560)
  await page.getByRole('button', { name: 'Remove last point' }).click()
  await page.getByRole('button', { name: 'Finish shape' }).click()
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(1)
})

test('shapes are removed with Delete, the toolbar and the list', async ({ page }) => {
  await page.goto('/')
  await drawRectangle(page, [600, 300], [680, 360])
  await drawRectangle(page, [900, 300], [980, 360])
  await drawRectangle(page, [1100, 500], [1180, 560])

  // Newest shape is selected: Delete removes it.
  await page.getByText('Rectangle 3').click()
  await expect.poll(async () => (await mapState(page)).selectedShape).not.toBeNull()
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(2)

  await page.getByText('Rectangle 2').click()
  await page.getByTestId('tool-delete').click()
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(1)

  await page.getByTestId('area-item-remove').click()
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(0)
  await expect(page.getByText('Nothing in your area yet')).toBeVisible()
})

test('shapes can be renamed in the list', async ({ page }) => {
  await page.goto('/')
  await drawRectangle(page, [600, 300], [680, 360])
  await page.getByRole('button', { name: 'Rename Rectangle 1' }).click()
  const input = page.getByRole('textbox', { name: 'Rename Rectangle 1' })
  await input.fill('Lake District')
  await input.press('Enter')
  await expect(page.getByText('Lake District')).toBeVisible()
})

test('a catalogue region can be combined with a drawn shape', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Expand Europe' }).click()
  await page.getByRole('button', { name: 'Expand United Kingdom' }).click()
  await page.getByRole('button', { name: 'Add Wales to your area' }).click()
  await expect.poll(async () => (await mapState(page)).regionCount).toBe(1)

  await drawRectangle(page, [1000, 500], [1100, 580])
  await expect(page.getByTestId('area-item-region')).toContainText('Wales')
  await expect(page.getByTestId('area-item-drawn')).toHaveCount(1)

  await page.getByTestId('next-step').click()
  await expect(page.getByTestId('estimate').locator('.size')).toBeVisible()
  await page.getByTestId('next-step').click()
  await expect(page.getByText('1 drawn shape and 1 region')).toBeVisible()
})

test('an omitted name is autogenerated and jobs persist across a reload', async ({ page }) => {
  await page.goto('/')
  await createExportViaDraw(page)
  await expect(page.getByTestId('export-created').locator('strong')).not.toHaveText('')

  await page.reload()
  await openDownloads(page)
  await expect(page.locator('[data-testid^="job-mock-export"]')).toHaveCount(1)
})

test('a toast announces when an extract is ready', async ({ page }) => {
  await page.goto('/')
  await createExportViaDraw(page, 'toast check')
  await expect(page.getByText('toast check is ready to download')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Extract ready' })).toBeVisible()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByTestId('downloads')).toBeVisible()
})

test('the circle tool adds a round shape', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tool-circle').click()
  await page.mouse.click(900, 450)
  await page.mouse.move(960, 450)
  await page.mouse.click(960, 450)
  await expect.poll(async () => (await mapState(page)).drawnCount).toBe(1)
  await expect(page.getByText(/Circle 1/)).toBeVisible()
  const [vertices] = (await mapState(page)).drawnVertexCounts
  expect(vertices).toBeGreaterThan(8)
})

test('single-key shortcuts pick each drawing tool', async ({ page }) => {
  await page.goto('/')
  const expected: Record<string, string> = {
    r: 'rectangle',
    p: 'polygon',
    f: 'freehand',
    c: 'circle',
    v: 'select',
  }
  for (const [key, tool] of Object.entries(expected)) {
    await page.keyboard.press(key)
    await expect.poll(async () => (await mapState(page)).tool).toBe(tool)
  }
})

test('shortcuts are ignored while typing a file name', async ({ page }) => {
  await page.goto('/')
  await drawRectangle(page, [600, 300], [680, 360])
  await page.getByTestId('next-step').click()
  await page.getByTestId('next-step').click()
  await page.getByLabel(/File name/).fill('roads')
  expect((await mapState(page)).tool).toBe('select')
  await expect(page.getByLabel(/File name/)).toHaveValue('roads')
})

test('dragging a corner of a selected shape changes its area', async ({ page }) => {
  await page.goto('/')
  await drawRectangle(page, [700, 350], [800, 450])
  const item = page.getByTestId('area-item-drawn')
  const before = await item.textContent()
  await item.click()
  await expect.poll(async () => (await mapState(page)).selectedShape).not.toBeNull()
  await page.mouse.move(800, 450)
  await page.mouse.down()
  await page.mouse.move(860, 500, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => item.textContent()).not.toBe(before)
})

test('an area over the size limit cannot be exported', async ({ page }) => {
  await page.goto('/')
  await drawRectangle(page, [500, 200], [1300, 800])
  await page.getByTestId('next-step').click()
  await page.getByLabel(/Max zoom/).fill('15')
  await expect(page.getByTestId('estimate')).toContainText(/Over the .* limit/)
  await expect(page.getByTestId('next-step')).toBeDisabled()

  await page.getByLabel(/Max zoom/).fill('4')
  await expect(page.getByTestId('estimate')).not.toContainText(/Over the .* limit/)
  await expect(page.getByTestId('next-step')).toBeEnabled()
})

test('starting over clears the area and returns to the first step', async ({ page }) => {
  await page.goto('/')
  await drawRectangle(page, [600, 300], [680, 360])
  await finishExport(page, 'first')
  await page.getByRole('button', { name: 'Start a new extract' }).click()
  await expect(page.getByText('Choose what to include')).toBeVisible()
  expect((await mapState(page)).drawnCount).toBe(0)
})
