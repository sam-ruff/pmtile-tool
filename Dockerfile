FROM node:24.17.0-alpine@sha256:156b55f92e98ccd5ef49578a8cea0df4679826564bad1c9d4ef04462b9f0ded6 AS ui
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM rust:1.96-bookworm@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS builder
ARG GO_PMTILES_VERSION=1.30.3
ARG GO_PMTILES_SHA256=adda9f979b719416d0c0069f57401a21c32078c46870a94f9bbda95d850f199f
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates musl-tools pkg-config cmake clang \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-unknown-linux-musl
RUN curl --fail --show-error --location --retry 3 \
        "https://github.com/protomaps/go-pmtiles/releases/download/v${GO_PMTILES_VERSION}/go-pmtiles_${GO_PMTILES_VERSION}_Linux_x86_64.tar.gz" \
        --output /tmp/go-pmtiles.tar.gz \
    && echo "${GO_PMTILES_SHA256}  /tmp/go-pmtiles.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/go-pmtiles.tar.gz -C /usr/local/bin pmtiles \
    && rm /tmp/go-pmtiles.tar.gz
WORKDIR /app
COPY Cargo.toml Cargo.lock build.rs ./
COPY migrations ./migrations
COPY src ./src
COPY --from=ui /app/frontend/dist ./static
ARG VERSION
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    if [ -n "$VERSION" ]; then export PMTILES_RELEASE_VERSION="$VERSION"; fi; \
    cargo build --release --locked --target x86_64-unknown-linux-musl \
    && cp target/x86_64-unknown-linux-musl/release/pmtile-tool /tmp/pmtile-tool

FROM cgr.dev/chainguard/static@sha256:77d8b8925dc27970ec2f48243f44c7a260d52c49cd778288e4ee97566e0cb75b
ARG GIT_SHA
ARG VERSION
LABEL org.opencontainers.image.source="https://github.com/sam-ruff/pmtile-tool" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}"
WORKDIR /app
COPY --from=builder /tmp/pmtile-tool /app/pmtile-tool
COPY --from=builder /usr/local/bin/pmtiles /usr/local/bin/pmtiles
COPY assets /app/assets
COPY config.docker.yaml /app/config.yaml
EXPOSE 8080
VOLUME /data
USER nonroot
CMD ["/app/pmtile-tool", "/app/config.yaml"]
