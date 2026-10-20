FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# IMG-1: install sees only the dependency manifests, so `pnpm install` and the node_modules layer stay cached
# (same digest, nothing to pull on the host) until the lockfile or a package.json dependency field changes (IMG-3
# strips scripts first). Sources, the real package.json files and turbo.json are copied in each build stage below.
FROM base AS manifests
COPY package.json ./package.json
COPY apps ./apps
COPY packages ./packages
RUN find apps packages -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +
# IMG-3: scripts are not install inputs, so editing a script must not rebuild the 1.1 GB node_modules layer.
# Drop every script except the install lifecycle hooks pnpm runs during `pnpm install`.
RUN node -e 'const fs = require("node:fs"); const keep = ["preinstall", "install", "postinstall", "prepare"]; for (const file of ["package.json", ...fs.readdirSync("apps").map((d) => `apps/${d}/package.json`), ...fs.readdirSync("packages").map((d) => `packages/${d}/package.json`)]) { if (!fs.existsSync(file)) continue; const manifest = JSON.parse(fs.readFileSync(file, "utf8")); const scripts = Object.fromEntries(Object.entries(manifest.scripts ?? {}).filter(([name]) => keep.includes(name))); if (Object.keys(scripts).length) manifest.scripts = scripts; else delete manifest.scripts; fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n"); }'

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=manifests /app/package.json ./package.json
COPY --from=manifests /app/apps ./apps
COPY --from=manifests /app/packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build-web
COPY package.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SMS_ENABLED=false
ARG NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SMS_ENABLED=${NEXT_PUBLIC_SMS_ENABLED}
ENV NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY=${NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY}
COPY tokens.css ./tokens.css
RUN pnpm turbo run build --filter=@o-okul/web...

FROM deps AS build-api
COPY package.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm turbo run build --filter=@o-okul/api...

FROM deps AS build-worker
COPY package.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm turbo run build --filter=@o-okul/worker...

FROM deps AS build-queue-board
COPY package.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm turbo run build --filter=@o-okul/queue-board...

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build-web /app/apps/web ./apps/web
COPY --from=build-web /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
WORKDIR /app/apps/web
EXPOSE 3001
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3001"]

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build-api /app/apps/api ./apps/api
COPY --from=build-api /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
EXPOSE 3100
CMD ["node", "apps/api/dist/main.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
# Same instruction chain as web, api and queue-board up to node_modules, so all four images share that layer;
# Chromium sits on top of it.
COPY --from=deps /app/node_modules ./node_modules
ENV REPORT_PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
COPY --from=build-worker /app/apps/worker ./apps/worker
COPY --from=build-worker /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
CMD ["node", "apps/worker/dist/main.js"]

FROM node:24-alpine AS queue-board
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build-queue-board /app/apps/queue-board ./apps/queue-board
COPY package.json pnpm-workspace.yaml turbo.json ./
EXPOSE 3200
CMD ["node", "apps/queue-board/dist/main.js"]
