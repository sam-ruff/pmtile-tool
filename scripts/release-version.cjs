const { appendFileSync } = require('node:fs')

exports.prepare = async (_config, { nextRelease, env }) => {
  const version = nextRelease.version
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    throw new Error('Release version must be a stable major.minor.patch version')
  }
  if (!env.GITHUB_ENV) throw new Error('Release requires the GitHub environment output file')
  appendFileSync(env.GITHUB_ENV, `RELEASE_VERSION=${version}\n`)
}
