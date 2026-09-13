const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { prepare } = require('../../scripts/release-version.cjs')

const read = path => readFileSync(join(__dirname, '../..', path), 'utf8')

test('release preparation exports the version without rewriting tested source', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pmtiles-release-'))
  const files = ['Cargo.toml', 'Cargo.lock']
  const before = files.map(read)
  try {
    const output = join(directory, 'environment')
    await prepare({}, { nextRelease: { version: '1.4.6' }, env: { GITHUB_ENV: output } })
    assert.equal(readFileSync(output, 'utf8'), 'RELEASE_VERSION=1.4.6\n')
    assert.deepEqual(files.map(read), before)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('release preparation rejects invalid versions and missing output', async () => {
  for (const version of ['', 'v1.4.6', '1.4', '01.4.6', '1.4.6-rc1', '1.4.6\n']) {
    await assert.rejects(prepare({}, { nextRelease: { version }, env: {} }), /stable/)
  }
  await assert.rejects(prepare({}, { nextRelease: { version: '1.4.6' }, env: {} }), /output file/)
})

test('stable tags point to tested source without a generated release commit', () => {
  const config = JSON.parse(read('.releaserc.json'))
  const plugins = config.plugins.map(plugin => Array.isArray(plugin) ? plugin[0] : plugin)
  assert.equal(config.tagFormat, 'v${version}')
  assert.ok(plugins.includes('./scripts/release-version.cjs'))
  assert.ok(!plugins.includes('@semantic-release/git'))
  assert.ok(!plugins.includes('@semantic-release/exec'))
  const workflow = read('.github/workflows/ci.yml')
  assert.match(workflow, /needs: \[backend-tests, frontend-tests\]/)
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/)
  assert.match(workflow, /GIT_SHA: \$\{\{ github.sha \}\}/)
  assert.match(workflow, /--build-arg GIT_SHA="\$GIT_SHA" --build-arg VERSION="\$VERSION"/)
  assert.match(workflow, /docker push "\$IMAGE:sha-\$GIT_SHA"/)
  assert.doesNotMatch(workflow, /\[skip ci\]|refs\/tags|ref: v/)
})

test('release remains gated by the real backend and browser acceptance suites', () => {
  const workflow = read('.github/workflows/ci.yml')
  for (const command of [
    './scripts/sync-ui.sh', 'pnpm test:release', 'cargo +1.96.0 fmt --check',
    'cargo +1.96.0 clippy --locked --all-targets -- -D warnings',
    'cargo +1.96.0 test --locked',
    'cargo +1.96.0 test --locked --test e2e_extract -- --ignored',
    'pnpm typecheck', 'run: pnpm test', 'pnpm test:e2e',
  ]) assert.ok(workflow.includes(command), command)
  assert.equal((workflow.match(/uses: actions\/checkout@/g) || []).length,
    (workflow.match(/persist-credentials: false/g) || []).length)
})

test('container build injects the release version reported by the status API', () => {
  const docker = read('Dockerfile')
  assert.match(docker, /ARG VERSION\nRUN --mount/)
  assert.match(docker, /export PMTILES_RELEASE_VERSION="\$VERSION"/)
  assert.match(docker, /cargo build --release --locked/)
  assert.match(read('build.rs'), /cargo:rerun-if-env-changed=PMTILES_RELEASE_VERSION/)
  assert.match(read('src/rest/status.rs'), /version: env!\("PMTILES_VERSION"\)/)
})
