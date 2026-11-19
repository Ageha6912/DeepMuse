FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG DM_DEFAULT_PROTOCOL=anthropic
RUN DM_DEFAULT_PROTOCOL=$DM_DEFAULT_PROTOCOL pnpm build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/LICENSE ./LICENSE
EXPOSE 8080
CMD ["node", "server/index.mjs"]
