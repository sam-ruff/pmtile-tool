const assert = require('node:assert/strict')
const { test } = require('node:test')
const { verifiedVersion, githubReleaseReader } = require('../../scripts/verify-release.cjs')

const api = {
  tags: () => ['v1.4.6'],
  release: tag => ({ tag_name: tag, draft: false, prerelease: false }),
}

test('recovers a published release after a failed duplicate publication response', async () => {
  assert.equal(await verifiedVersion(api, 'tested-sha', 'failure', '1.4.6'), '1.4.6')
})
test('reruns image publication for an existing release at the tested source', async () => {
  assert.equal(await verifiedVersion(api, 'tested-sha', 'success', undefined), '1.4.6')
})
test('does not release a successful no-change commit', async () => {
  assert.equal(await verifiedVersion({ tags: () => [] }, 'tested-sha', 'success'), '')
})
test('rejects failed untagged, ambiguous and mismatched source releases', async () => {
  await assert.rejects(() => verifiedVersion({ tags: () => [] }, 'sha', 'failure'))
  await assert.rejects(() => verifiedVersion({ tags: () => ['v1.4.6', 'v1.4.7'] }, 'sha', 'success'))
  await assert.rejects(() => verifiedVersion(api, 'sha', 'failure', '1.4.7'))
})
test('rejects draft, prerelease and unavailable GitHub release metadata', async () => {
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'v9.0.0' }]) {
    await assert.rejects(() => verifiedVersion({ ...api, release: tag => ({ ...api.release(tag), ...change }) }, 'sha', 'failure'))
  }
  await assert.rejects(() => verifiedVersion({ ...api, release: () => { throw new Error('unavailable') } }, 'sha', 'failure'))
})

test('recovers using injected native HTTP without a GitHub CLI', async () => {
  const requests = []
  const release = githubReleaseReader(async (url, options) => {
    requests.push({ url, options })
    return { status: 200, json: async () => api.release('v1.4.6') }
  }, 'fixture-token')
  assert.equal(await verifiedVersion({ ...api, release }, 'tested-sha', 'failure'), '1.4.6')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.github.com/repos/sam-ruff/pmtile-tool/releases/tags/v1.4.6')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-token')
  assert.equal(requests[0].options.redirect, 'error')
  assert.ok(requests[0].options.signal instanceof AbortSignal)
})

test('HTTP errors never parse bodies or authorise publication', async () => {
  for (const status of [301, 401, 403, 404, 429, 500]) {
    const release = githubReleaseReader(async () => ({
      status,
      json: () => { assert.fail('must not read error bodies') },
    }), 'fixture-token')
    await assert.rejects(() => verifiedVersion({ ...api, release }, 'tested-sha', 'failure'), /lookup failed/)
  }
})

test('network and JSON failures do not disclose credentials or response contents', async () => {
  const failures = [
    async () => { throw new Error('fixture-token private request data') },
    async () => ({ status: 200, json: async () => { throw new Error('private response') } }),
  ]
  for (const fetch of failures) {
    await assert.rejects(githubReleaseReader(fetch, 'fixture-token')('v1.4.6'), error => {
      assert.equal(error.message, 'GitHub release lookup failed; image publication is not authorised')
      assert.equal(error.cause, undefined)
      return true
    })
  }
})

test('missing credentials and malformed tags fail before network access', async () => {
  const fetch = () => { assert.fail('must not access network') }
  await assert.rejects(githubReleaseReader(fetch, '')('v1.4.6'))
  await assert.rejects(githubReleaseReader(fetch, 'fixture-token')('../private'))
})

test('HTTP success still requires matching published stable release metadata', async () => {
  for (const body of [null, {}, { tag_name: 'v1.4.7', draft: false, prerelease: false }]) {
    const release = githubReleaseReader(async () => ({ status: 200, json: async () => body }), 'fixture-token')
    await assert.rejects(() => verifiedVersion({ ...api, release }, 'tested-sha', 'failure'), /published stable/)
  }
})
