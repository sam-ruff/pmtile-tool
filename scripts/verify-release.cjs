const { execFileSync } = require('node:child_process')
const { appendFileSync } = require('node:fs')

async function verifiedVersion(api, revision, outcome, proposed) {
  const tags = api.tags(revision).filter(tag => /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag))
  if (!proposed && tags.length === 0 && outcome === 'success') return ''
  if (tags.length !== 1 || (proposed && tags[0] !== `v${proposed}`)) {
    throw new Error('Release tag must uniquely identify the tested source commit')
  }
  const release = await api.release(tags[0])
  if (!release || release.tag_name !== tags[0] || release.draft !== false || release.prerelease !== false) {
    throw new Error('A published stable release is required before image publication')
  }
  return tags[0].slice(1)
}

function githubReleaseReader(fetch, token) {
  return async tag => {
    if (!token || !/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag)) {
      throw new Error('GitHub release lookup requires a token and stable release tag')
    }
    try {
      const response = await fetch(`https://api.github.com/repos/sam-ruff/pmtile-tool/releases/tags/${tag}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      })
      if (response.status !== 200) throw new Error('Release metadata unavailable')
      return await response.json()
    } catch {
      throw new Error('GitHub release lookup failed; image publication is not authorised')
    }
  }
}

async function main() {
  const env = process.env
  if (env.GITHUB_REPOSITORY !== 'sam-ruff/pmtile-tool' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) {
    throw new Error('Expected PMTiles source CI identity')
  }
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000 })
  const api = {
    tags: revision => run('git', ['tag', '--points-at', revision]).trim().split('\n'),
    release: githubReleaseReader(globalThis.fetch, env.GH_TOKEN),
  }
  const version = await verifiedVersion(api, env.GITHUB_SHA, env.RELEASE_OUTCOME, env.RELEASE_VERSION)
  appendFileSync(env.GITHUB_OUTPUT, `version=${version}\n`)
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { verifiedVersion, githubReleaseReader }
