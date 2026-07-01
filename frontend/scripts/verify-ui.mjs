// Drives the running app at :8080 (embedded UI + real backend) at desktop and
// mobile viewports and saves screenshots. Not a test suite - a dev check:
//   node scripts/verify-ui.mjs [outputDir]
import { chromium } from '@playwright/test'

const base = process.env.APP_URL ?? 'http://localhost:8080'
const outDir = process.argv[2] ?? '/tmp'

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

const browser = await chromium.launch()
let failures = 0

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(base, { waitUntil: 'networkidle' })

  const checks = [
    ['title', (await page.title()) === 'PMTiles Extract Tool'],
    ['map canvas rendered', (await page.locator('.map canvas').count()) > 0],
    ['regions tree shows Europe', await page.getByText('Europe', { exact: true }).first().isVisible()],
  ]

  await page.getByRole('button', { name: 'Custom export' }).click()
  checks.push(['export tab shows draw controls', await page.getByRole('button', { name: 'Draw polygon' }).isVisible()])
  await page.screenshot({ path: `${outDir}/ui-${viewport.name}-export.png` })

  await page.getByRole('button', { name: /Jobs/ }).click()
  checks.push(['jobs tab renders', await page.getByText(/export jobs/i).first().isVisible()])

  await page.getByRole('button', { name: 'Regions' }).click()
  await page.getByText('Europe', { exact: true }).first().click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${outDir}/ui-${viewport.name}-regions.png` })
  checks.push(['region detail appears', await page.getByRole('button', { name: 'Generate extract' }).isVisible().catch(() => false)])

  for (const [name, ok] of checks) {
    console.log(`${viewport.name}: ${ok ? 'PASS' : 'FAIL'} - ${name}`)
    if (!ok) failures += 1
  }
  const relevantErrors = errors.filter((e) => !e.includes('favicon'))
  if (relevantErrors.length > 0) {
    console.log(`${viewport.name}: console/page errors:`)
    for (const error of relevantErrors) console.log(`  ${error}`)
    failures += 1
  }
  await page.close()
}

await browser.close()
process.exit(failures === 0 ? 0 : 1)
