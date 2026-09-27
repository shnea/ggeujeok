FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY vendor vendor
RUN npm ci --workspace @ggeujeok/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build --workspace @ggeujeok/api

FROM build AS development
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM build AS pruned
RUN npm prune --omit=dev --workspace @ggeujeok/api --include-workspace-root

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=pruned /app/node_modules node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
CMD ["node", "apps/api/dist/main.js"]
