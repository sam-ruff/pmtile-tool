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

async function check(label, fn) {
  try {
    await fn()
    return [label, true]
  } catch {
    return [label, false]
  }
}

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
    await check('drawing tools on the map', () =>
      page.getByTestId('tool-freehand').waitFor({ timeout: 15_000 }),
    ),
    await check('region tree shows Europe', () =>
      page.getByTestId('region-europe').waitFor({ timeout: 15_000 }),
    ),
  ]
  await page.screenshot({ path: `${outDir}/ui-${viewport.name}-start.png` })

  checks.push(
    await check('region card appears', async () => {
      await page.getByTestId('region-europe').click()
      await page.getByTestId('region-card').waitFor({ timeout: 15_000 })
      await page.waitForLoadState('networkidle')
    }),
  )
  await page.screenshot({ path: `${outDir}/ui-${viewport.name}-region.png` })

  checks.push(
    await check('downloads open', async () => {
      await page.getByTestId('open-downloads').first().click()
      await page.getByTestId('downloads').waitFor({ timeout: 15_000 })
    }),
  )

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
