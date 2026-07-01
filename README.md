# pmtile-tool

A web tool for creating and downloading [PMTiles](https://docs.protomaps.com/pmtiles/) basemap extracts, deployed at pmtiles.samruff.dev.

Pick a ready-made region (Geofabrik-style hierarchy, continents down to UK counties) or draw your own polygon on the map and export it at a chosen zoom level. Extracts are cut from a planet-scale archive with go-pmtiles and stay downloadable for 48 hours. Finished exports can be previewed straight on the map before downloading.

The backend is a single Rust binary: an axum app serving the API and the embedded Vue frontend, with a [martin](https://github.com/maplibre/martin) tile server (via the martin-embedded crate) running on loopback to serve the basemap. Jobs are queued in SQLite and rate limited per client.

## Development

The full planet archive is never downloaded on a dev machine. Fetch a small worldwide extract instead:

```sh
scripts/dev-data.sh          # worldwide, low zoom
scripts/dev-data.sh --uk     # UK at higher zoom for county-level testing
```

Run the backend and frontend side by side:

```sh
cargo run                    # API, tiles and embedded UI on http://localhost:8080
cd frontend && pnpm dev      # hot-reload dev server on http://localhost:5173, proxies /api and /tiles
```

`pnpm dev:mock` runs the frontend with an in-browser mock API, no backend needed.

Swagger lives at `http://localhost:8080/swagger-ui/`, a liveness check at `/health`. `cargo run` reads an optional `config.yaml` (gitignored) that overrides defaults such as the listen addresses, the go-pmtiles binary path (`go_pmtiles_bin: bin/pmtiles` after dev-data.sh) and the seeded regions - see `config.docker.yaml` for the full set of keys.

To serve the frontend from the Rust binary, `scripts/sync-ui.sh` builds it into `static/`, which `build.rs` embeds at compile time.

## Testing

```sh
cargo test                                   # unit + integration
cargo test --test e2e_extract -- --ignored   # real go-pmtiles pipeline
cargo clippy --all-targets
cd frontend && pnpm test && pnpm typecheck
```

## Data

Basemap data comes from Protomaps daily builds of OpenStreetMap, © OpenStreetMap contributors, ODbL. Region boundaries come from the Geofabrik index. On the server the planet archive is provisioned by an Ansible playbook that checks disk space, downloads the latest build with resume support, and verifies its BLAKE3 hash.
