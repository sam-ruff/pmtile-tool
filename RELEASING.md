# Releases

The source workflow runs the backend, real extraction pipeline and frontend browser
checks before semantic-release creates a stable GitHub release. Its `v` tag points
to the tested source commit. Release preparation does not rewrite Cargo metadata
or create another commit.

The image is built from that same commit, with its revision recorded in the OCI
labels and a full-SHA tag alongside the existing version tags. The complete source
workflow must succeed before central infrastructure release intake accepts it.
Source CI publishes images only; staging and production deployment belong to the
infrastructure repository.

`PMTILES_RELEASE_VERSION` supplies the release version at compile time, including
the status API response. Container publication passes it through the `VERSION`
build argument. Ordinary development builds use the Cargo package version. An
invalid explicit version fails the build instead of silently falling back.

Run `pnpm install --frozen-lockfile && pnpm test:release` for offline publisher
contract checks. Rust version tests run with the normal test suite and can also be
exercised with `PMTILES_RELEASE_VERSION=1.4.9 cargo test --locked release_version`.
