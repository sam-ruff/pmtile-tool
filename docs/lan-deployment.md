# Running on an offline LAN

pmtile-tool runs with no internet access once it has two things on disk: the container image (or the binary) and a planet archive at `<data_dir>/planet.pmtiles`. Tiles are served by the embedded martin server from that file, extracts are cut from it by go-pmtiles, and the map icons, fonts and region boundaries ship inside the image. But getting those files onto the network needs a machine with internet access, and the planet archive alone is about 137 GB.

## What to fetch, and from where

| File | Where it comes from | Where it goes |
|---|---|---|
| Container image | Build it with `docker build` from this repository, or pull a release from `registry.tail2d6fbe.ts.net/pmtile-tool/pmtile-tool` if you are on that tailnet | Your LAN host or a local registry |
| Planet archive | Protomaps daily builds, `https://build.protomaps.com/<YYYYMMDD>.pmtiles` | `<data_dir>/planet.pmtiles` |
| go-pmtiles | Bundled in the image at `/usr/local/bin/pmtiles`. For a bare install, the Linux release from `github.com/protomaps/go-pmtiles/releases` (the Dockerfile pins 1.30.3) | Any path, set as `go_pmtiles_bin` |
| Region index | Vendored in the repository as `assets/geofabrik-index-v1.json`, copied into the image at `/app/assets` | Any path, set as `regions_index` |

Building the image needs internet access: it downloads go-pmtiles from GitHub, npm packages for the frontend, and Rust crates including martin from a git repository. Build on a connected machine, then move the image across with `docker save` and `docker load`:

```sh
docker build -t pmtile-tool:local .
docker save pmtile-tool:local | gzip > pmtile-tool.tar.gz
# on the LAN host
docker load < pmtile-tool.tar.gz
```

The list of planet builds is at `https://build-metadata.protomaps.dev/builds.json`; the `key` of the last entry is the newest file name. Download it on a connected machine with any resumable client, for example `curl -C - -O https://build.protomaps.com/20261117.pmtiles`, then copy it to the LAN host and rename it to `planet.pmtiles`.

The archive has to be PMTiles v3. If you already have a planet as MBTiles, convert it once with `pmtiles convert planet.mbtiles planet.pmtiles`. The basemap styles in the UI expect the Protomaps basemap schema, so an MBTiles file built with a different schema (OpenMapTiles, for instance) will load but render mostly blank.

## The data directory

`data_dir` holds everything the service reads and writes. Only the planet archive needs to exist before the first start; the service creates the rest.

```
<data_dir>/planet.pmtiles      read only, never replaced while running
<data_dir>/exports/            finished custom exports
<data_dir>/region-cache/       finished catalogue region extracts
<data_dir>/work/               extracts in progress
<data_dir>/db/pmtile-tool.sqlite   job database
```

Plan for the planet plus `data_budget_gb` of writable space (70 GB by default). New jobs evict the least recently used finished outputs to stay inside that budget.

## Running the container

The image runs as the non-root user 65532 and expects the data directory at `/data`, so that directory must be writable by that user:

```sh
sudo chown -R 65532:65532 /srv/pmtiles
docker run -d --name pmtile-tool \
  -p 8080:8080 \
  -v /srv/pmtiles:/data \
  -v /srv/pmtiles-config.yaml:/app/config.yaml:ro \
  pmtile-tool:local
```

The same with Compose:

```yaml
services:
  pmtile-tool:
    image: pmtile-tool:local
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /srv/pmtiles:/data
      - ./config.yaml:/app/config.yaml:ro
```

Mounting a config file is optional. Without one the image uses its baked-in copy of `config.docker.yaml`.

## Running the bare binary

The release build is a static musl binary with the frontend embedded, so it runs on any x86_64 Linux host. On a connected machine:

```sh
scripts/sync-ui.sh
cargo build --release --target x86_64-unknown-linux-musl
```

Copy `target/x86_64-unknown-linux-musl/release/pmtile-tool`, the `pmtiles` binary and `assets/geofabrik-index-v1.json` to the LAN host, then start it with the config path as its only argument: `./pmtile-tool /etc/pmtile-tool/config.yaml`. With no argument it reads `config.yaml` from the working directory, and with no file at all it falls back to the built-in defaults.

## Config worth changing on a LAN

Start from `config.docker.yaml`; unknown keys are rejected, so a typo stops the service at startup rather than being ignored.

- `listen` is the public address, `0.0.0.0:8080` by default. `martin_listen` is the internal tile server and should stay on loopback.
- `data_dir`, `go_pmtiles_bin` and `regions_index` are paths. The Docker defaults are `/data`, `/usr/local/bin/pmtiles` and `/app/assets/geofabrik-index-v1.json`.
- `seed_regions` lists catalogue regions to extract at startup and keep permanently. Each one costs extraction time and disk on first boot.
- `limits.jobs_per_ip_per_hour` (5) and `limits.active_jobs_per_ip` (2) count per client IP. Behind a reverse proxy or NAT every user shares one address, so raise them. The service trusts a `CF-Connecting-IP` header for this count, which is safe behind Cloudflare and means quotas are advisory on an open LAN.
- `limits.job_rate_limit_per_second` and `limits.download_rate_limit_per_second` throttle requests per IP in the same way.
- `limits.max_maxzoom`, `limits.max_custom_export_gb`, `limits.max_export_regions` and `limits.data_budget_gb` cap how big a single export and the total writable data can get.
- Size estimates come from a go-pmtiles dry run against the planet, so they match the real file to within a few per cent. `limits.avg_tile_bytes` is only used if that dry run fails or takes longer than 20 seconds, and it underestimates land areas badly.
- `retention.export_ttl_hours` and `retention.region_ttl_hours` set how long outputs stay downloadable (48 hours each).

## Downloaded map styles

The style button (the braces icon on a finished extract in Downloads) produces a MapLibre `style.json` for it. Icons in that style come from the pmtile-tool instance itself, so they work offline. Its glyphs URL still points at `protomaps.github.io/basemaps-assets`, so a MapLibre app using that style on a network with no internet access will draw roads and areas but no labels. Host the Protomaps font PBFs somewhere on the LAN and edit the `glyphs` entry if you need labels offline. The pmtile-tool site itself draws labels with bundled fonts and is not affected.
