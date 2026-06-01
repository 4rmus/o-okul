FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm build

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
ENV REPORT_PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont && corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
EXPOSE 3100
CMD ["node", "apps/api/dist/main.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
CMD ["node", "apps/worker/dist/main.js"]
