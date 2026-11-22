// Full user journey against the running app: draw two separate shapes, export
// them as one file, wait for completion, then download link and map preview.
//   node scripts/verify-flow.mjs [outputDir]
import { chromium } from '@playwright/test'

const base = process.env.APP_URL ?? 'http://localhost:8080'
const outDir = process.argv[2] ?? '/tmp'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

async function check(label, fn) {
  try {
    await fn()
    console.log(`${label}: PASS`)
    return true
  } catch (e) {
    console.log(`${label}: FAIL (${String(e).split('\n')[0]})`)
    return false
  }
}

async function rectangle(from, to) {
  await page.getByTestId('tool-rectangle').click()
  await page.mouse.click(from[0], from[1])
  await page.mouse.move(to[0], to[1])
  await page.mouse.click(to[0], to[1])
  await page.keyboard.press('Escape')
}

await page.goto(base, { waitUntil: 'networkidle' })

const results = [
  await check('two shapes in the area list', async () => {
    await rectangle([760, 380], [820, 430])
    await rectangle([1000, 500], [1060, 540])
    await page.getByRole('tab', { name: 'Your area (2)' }).waitFor({ timeout: 15_000 })
  }),
  await check('estimate shown', async () => {
    await page.getByTestId('next-step').click()
    await page.getByTestId('estimate').locator('.size').waitFor({ timeout: 15_000 })
  }),
  await check('extract created', async () => {
    await page.getByTestId('next-step').click()
    await page.getByTestId('create-extract').click()
    await page.getByTestId('export-created').waitFor({ timeout: 15_000 })
  }),
  await check('job completed with download link', async () => {
    await page.getByRole('button', { name: 'Open downloads' }).click()
    await page.getByRole('link', { name: 'Download' }).first().waitFor({ timeout: 120_000 })
  }),
  await check('preview active', async () => {
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click()
    await page.getByRole('button', { name: 'Hide', exact: true }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Close downloads' }).click()
    await page.getByTestId('preview-banner').waitFor({ timeout: 15_000 })
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${outDir}/ui-flow-preview.png` })
  }),
]

if (errors.length > 0) {
  console.log('page errors:')
  for (const error of errors) console.log(`  ${error}`)
}
await browser.close()
process.exit(errors.length === 0 && results.every(Boolean) ? 0 : 1)
