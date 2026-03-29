FROM node:20-alpine AS builder

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/
COPY lib/integrations-openai-ai-server/package.json ./lib/integrations-openai-ai-server/
COPY lib/api-zod/package.json ./lib/api-zod/

RUN pnpm install --no-frozen-lockfile

COPY artifacts/api-server ./artifacts/api-server
COPY lib/db ./lib/db
COPY lib/integrations-openai-ai-server ./lib/integrations-openai-ai-server
COPY lib/api-zod ./lib/api-zod

RUN pnpm --filter @workspace/api-server run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/artifacts/api-server/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.mjs"]
