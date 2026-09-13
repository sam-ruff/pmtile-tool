const assert = require('node:assert/strict')
const { test } = require('node:test')
const { verifiedVersion } = require('../../scripts/verify-release.cjs')

const api = {
  tags: () => ['v1.4.6'],
  release: tag => ({ tag_name: tag, draft: false, prerelease: false }),
}

test('recovers a published release after a failed duplicate publication response', () => {
  assert.equal(verifiedVersion(api, 'tested-sha', 'failure', '1.4.6'), '1.4.6')
})
test('reruns image publication for an existing release at the tested source', () => {
  assert.equal(verifiedVersion(api, 'tested-sha', 'success', undefined), '1.4.6')
})
test('does not release a successful no-change commit', () => {
  assert.equal(verifiedVersion({ tags: () => [] }, 'tested-sha', 'success'), '')
})
test('rejects failed untagged, ambiguous and mismatched source releases', () => {
  assert.throws(() => verifiedVersion({ tags: () => [] }, 'sha', 'failure'))
  assert.throws(() => verifiedVersion({ tags: () => ['v1.4.6', 'v1.4.7'] }, 'sha', 'success'))
  assert.throws(() => verifiedVersion(api, 'sha', 'failure', '1.4.7'))
})
test('rejects draft, prerelease and unavailable GitHub release metadata', () => {
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'v9.0.0' }]) {
    assert.throws(() => verifiedVersion({ ...api, release: tag => ({ ...api.release(tag), ...change }) }, 'sha', 'failure'))
  }
  assert.throws(() => verifiedVersion({ ...api, release: () => { throw new Error('unavailable') } }, 'sha', 'failure'))
})
