FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm build

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
WORKDIR /app/apps/web
EXPOSE 3001
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3001"]

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
EXPOSE 3100
CMD ["node", "apps/api/dist/main.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV REPORT_PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont && corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/packages ./packages
COPY package.json pnpm-workspace.yaml turbo.json ./
CMD ["node", "apps/worker/dist/main.js"]

FROM node:24-alpine AS queue-board
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/queue-board ./apps/queue-board
COPY package.json pnpm-workspace.yaml turbo.json ./
EXPOSE 3200
CMD ["node", "apps/queue-board/dist/main.js"]
