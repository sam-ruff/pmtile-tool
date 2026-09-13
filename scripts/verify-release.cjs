const { execFileSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')

function verifiedVersion(api, revision, outcome, proposed) {
  const tags = api.tags(revision).filter(tag => /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag))
  if (!proposed && tags.length === 0 && outcome === 'success') return ''
  if (tags.length !== 1 || (proposed && tags[0] !== `v${proposed}`)) {
    throw new Error('Release tag must uniquely identify the tested source commit')
  }
  const release = api.release(tags[0])
  if (release.tag_name !== tags[0] || release.draft !== false || release.prerelease !== false) {
    throw new Error('A published stable release is required before image publication')
  }
  return tags[0].slice(1)
}

if (require.main === module) {
  const env = process.env
  if (env.GITHUB_REPOSITORY !== 'sam-ruff/pmtile-tool' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) {
    throw new Error('Expected PMTiles source CI identity')
  }
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000 })
  const api = {
    tags: revision => run('git', ['tag', '--points-at', revision]).trim().split('\n'),
    release: tag => JSON.parse(run('gh', ['api', `repos/sam-ruff/pmtile-tool/releases/tags/${tag}`])),
  }
  const version = verifiedVersion(api, env.GITHUB_SHA, env.RELEASE_OUTCOME, env.RELEASE_VERSION)
  appendFileSync(env.GITHUB_OUTPUT, `version=${version}\n`)
}

module.exports = { verifiedVersion }
