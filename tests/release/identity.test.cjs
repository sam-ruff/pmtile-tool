const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { prepare } = require('../../scripts/release-version.cjs')

const read = path => readFileSync(join(__dirname, '../..', path), 'utf8')
const toolchain = () => read('rust-toolchain.toml').match(/^channel = "([0-9.]+)"$/m)[1]

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
  const rust = toolchain()
  for (const command of [
    './scripts/sync-ui.sh', 'pnpm test:release', `cargo +${rust} fmt --check`,
    `cargo +${rust} clippy --locked --all-targets -- -D warnings`,
    `cargo +${rust} test --locked`,
    `cargo +${rust} test --locked --test e2e_extract -- --ignored`,
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

test('toolchain pins agree across CI, the container build and the manifests', () => {
  const workflow = read('.github/workflows/ci.yml')
  const docker = read('Dockerfile')
  const rust = toolchain()
  assert.match(workflow, new RegExp(`rustup toolchain install ${rust} `))
  assert.match(docker, new RegExp(`^FROM rust:${rust.split('.').slice(0, 2).join('.')}-`, 'm'))
  const node = read('.nvmrc').trim()
  assert.match(docker, new RegExp(`^FROM node:${node}-alpine@sha256:[0-9a-f]{64} `, 'm'))
  assert.equal(workflow.match(/node-version: '([^']+)'/g).length, 3)
  for (const pin of workflow.match(/node-version: '([^']+)'/g)) assert.equal(pin, `node-version: '${node}'`)
  const pnpm = JSON.parse(read('package.json')).packageManager
  assert.equal(JSON.parse(read('frontend/package.json')).packageManager, pnpm)
  assert.match(docker, new RegExp(`corepack prepare ${pnpm} --activate`))
  const pnpmPins = workflow.match(/^ +version: [0-9].*$/gm)
  assert.equal(pnpmPins.length, 3)
  for (const pin of pnpmPins) assert.equal(pin.trim(), `version: ${pnpm.split('@')[1]}`)
  const goPmtiles = docker.match(/ARG GO_PMTILES_VERSION=(.+)\nARG GO_PMTILES_SHA256=(.+)\n/)
  assert.ok(workflow.includes(`GO_PMTILES_VERSION: ${goPmtiles[1]}\n`))
  assert.ok(workflow.includes(`GO_PMTILES_SHA256: ${goPmtiles[2]}\n`))
  assert.ok(read('scripts/dev-data.sh').includes(`GO_PMTILES_VERSION="${goPmtiles[1]}"`))
  for (const uses of workflow.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/)
  for (const runner of workflow.match(/runs-on: .+/g)) assert.equal(runner, 'runs-on: [self-hosted, sophie]')
})
