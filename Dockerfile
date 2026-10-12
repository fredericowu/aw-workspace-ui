# syntax=docker/dockerfile:1.7
# Custom app AW Frontend — dev-mode Vite/React server only.
# Frontend-only: calls https://api.aw.tekflox.com directly, no FastAPI
# backend in this container. AUTORELOAD=1 (set in aw.json) flips
# `vite --host` into watch mode (it always watches; this just documents intent).

FROM node:24-slim

WORKDIR /app

# Deps installed at image build time as a fallback for a clean container
# build; the running container's /app is bind-mounted from the host repo
# (see aw.json volumes), so in practice the host's own node_modules
# (installed via `npm install` in repos/aw-workspace-ui) is what's used.
COPY package.json package-lock.json* /tmp/frontend/
RUN cd /tmp/frontend && npm install --no-audit --no-fund && \
    mv node_modules /app/node_modules

EXPOSE 10011

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
