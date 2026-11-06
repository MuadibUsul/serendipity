# The API service image. Built from the repository root:
#
#   docker build -f services/api/Dockerfile -t serendipity-api .
#
# Configuration comes from the environment at run time and is checked by
# @serendipity/config before the service starts; no secret is baked in.

FROM node:22.23.4-bookworm-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --no-audit --no-fund --ignore-scripts \
  && npm run build --workspace @serendipity/api

# Only the API's runtime npm packages; the workspace packages are in the bundle.
FROM build AS runtime-deps
RUN rm -rf node_modules services/api/node_modules \
  && npm ci --no-audit --no-fund --ignore-scripts --omit=dev --workspace @serendipity/api \
  && rm -rf node_modules/@serendipity \
  && mkdir -p services/api/node_modules

FROM node:22.23.4-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
WORKDIR /app
COPY --from=runtime-deps /repo/node_modules ./node_modules
COPY --from=runtime-deps /repo/services/api/node_modules ./services/api/node_modules
COPY --from=build /repo/services/api/package.json ./services/api/package.json
COPY --from=build /repo/services/api/dist ./services/api/dist
# Readiness compares the database with the migrations this image was built with.
COPY --from=build /repo/infra/migrations ./infra/migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "services/api/dist/main.js"]
