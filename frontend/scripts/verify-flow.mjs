// Full user journey against the running app: draw a rectangle, create an
// export, wait for completion, download link + map preview.
//   node scripts/verify-flow.mjs [outputDir]
import { chromium } from '@playwright/test'

const base = process.env.APP_URL ?? 'http://localhost:8080'
const outDir = process.argv[2] ?? '/tmp'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(base, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Custom export' }).click()
await page.getByRole('button', { name: 'Draw rectangle' }).click()

// Draw over western Europe-ish area of the world view.
await page.mouse.click(760, 380)
await page.mouse.move(860, 460)
await page.mouse.click(860, 460)
await page.waitForTimeout(600)

const estimateVisible = await page.getByText('Estimated size').isVisible()
console.log(`estimate shown: ${estimateVisible ? 'PASS' : 'FAIL'}`)

await page.getByRole('button', { name: 'Create export job' }).click()
await page.waitForTimeout(400)
const queuedNote = await page.getByText('Export queued').isVisible()
console.log(`queued note: ${queuedNote ? 'PASS' : 'FAIL'}`)

await page.getByRole('button', { name: /Jobs/ }).click()
await page.getByRole('link', { name: 'Download' }).waitFor({ timeout: 30_000 })
console.log('job completed with download link: PASS')

await page.getByRole('button', { name: 'Preview on map' }).click()
await page.waitForTimeout(1500)
const hidePreview = await page.getByRole('button', { name: 'Hide preview' }).isVisible()
console.log(`preview layer active: ${hidePreview ? 'PASS' : 'FAIL'}`)
await page.screenshot({ path: `${outDir}/ui-flow-preview.png` })

if (errors.length > 0) {
  console.log('page errors:')
  for (const error of errors) console.log(`  ${error}`)
}
await browser.close()
process.exit(errors.length === 0 && estimateVisible && queuedNote && hidePreview ? 0 : 1)
