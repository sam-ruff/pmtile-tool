FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS ui
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM rust:1.100-bookworm@sha256:ade39a710ef85f3506cffcfec3e8a24ba090badef1dff2fb798f71d878833fea AS builder
ARG GO_PMTILES_VERSION=1.31.2
ARG GO_PMTILES_SHA256=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f
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

FROM cgr.dev/chainguard/static@sha256:8658e9eaeb2294fa0e49b0667f7d66b4e21fa7690b8d2a4c30cd1d013ceb9eb7
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
