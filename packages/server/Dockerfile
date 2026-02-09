FROM node:22-alpine AS build

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/lexicon/package.json packages/lexicon/
COPY packages/server/package.json packages/server/

RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/lexicon/ packages/lexicon/
COPY packages/server/ packages/server/

RUN pnpm --filter @chatmosphere/shared build && \
    pnpm --filter @chatmosphere/lexicon build && \
    pnpm --filter @chatmosphere/server build && \
    cp -r packages/server/src/db/migrations packages/server/dist/db/ && \
    pnpm --filter @chatmosphere/server deploy --prod /app/deploy

FROM node:22-alpine

WORKDIR /app
COPY --from=build /app/deploy/dist ./dist
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
