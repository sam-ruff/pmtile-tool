FROM node:22-slim AS ui
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM rust:1.96-slim-bookworm AS builder
ARG GO_PMTILES_VERSION=1.30.3
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN curl -sL "https://github.com/protomaps/go-pmtiles/releases/download/v${GO_PMTILES_VERSION}/go-pmtiles_${GO_PMTILES_VERSION}_Linux_x86_64.tar.gz" \
    | tar -xzf - -C /usr/local/bin pmtiles
WORKDIR /app
COPY Cargo.toml Cargo.lock build.rs ./
COPY migrations ./migrations
COPY src ./src
COPY --from=ui /app/frontend/dist ./static
RUN cargo build --release

FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/target/release/pmtile-tool /app/pmtile-tool
COPY --from=builder /usr/local/bin/pmtiles /usr/local/bin/pmtiles
COPY assets /app/assets
COPY config.docker.yaml /app/config.yaml
EXPOSE 8080
VOLUME /data
CMD ["/app/pmtile-tool", "/app/config.yaml"]
