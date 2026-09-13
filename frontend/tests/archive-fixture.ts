import { readFile } from 'node:fs/promises'
import { test as base } from '@playwright/test'

interface ArchiveRead {
  start: number
  end: number
  tileData: boolean
}

export const test = base.extend<{ archiveReads: ArchiveRead[] }>({
  archiveReads: [async ({ page }, use) => {
    const archive = await readFile(new URL('../../tests/fixtures/tiny.pmtiles', import.meta.url))
    // PMTiles v3 stores the tile-data offset at header byte 56.
    const tileDataOffset = Number(archive.readBigUInt64LE(56))
    const reads: ArchiveRead[] = []
    await page.route('**/api/v1/exports/*/download', async (route) => {
      const range = route.request().headers().range
      const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? '')
      if (!match) throw new Error(`Expected one explicit archive byte range, got ${range}`)
      const start = Number(match[1])
      const end = Math.min(match[2] ? Number(match[2]) : archive.length - 1, archive.length - 1)
      if (start > end) throw new Error(`Invalid archive range: ${range}`)
      await route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${archive.length}`,
          'Content-Length': String(end - start + 1),
          ETag: '"tiny-fixture"',
        },
        body: archive.subarray(start, end + 1),
      })
      reads.push({ start, end, tileData: start >= tileDataOffset })
    })
    await use(reads)
  }, { auto: true }],
})

export { expect } from '@playwright/test'
