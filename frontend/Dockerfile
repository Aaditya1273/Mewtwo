# ── ARGUS frontend (Next.js 16) — self-hosted build ──
# Build:   docker build -t argus/frontend:local .
# Run:     docker run -p 3000:3000 -e ARGUS_BACKEND_URL=http://backend:8080 argus/frontend:local
#
# NOTE: NEXT_PUBLIC_ARGUS_BACKEND_URL is baked into the client bundle at build
# time. Pass it as a --build-arg when the dashboard must reach a backend that
# differs from the runtime default (e.g. a public https URL for the browser).

# ── deps ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# ── build ──
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Optional build-time override for the client-bundle backend URL.
ARG NEXT_PUBLIC_ARGUS_BACKEND_URL
ENV NEXT_PUBLIC_ARGUS_BACKEND_URL=${NEXT_PUBLIC_ARGUS_BACKEND_URL:-http://localhost:8080}
RUN npm run build

# ── runtime (standalone) ──
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000
# Server-side backend URL is read from ARGUS_BACKEND_URL at runtime — no
# hardcoded default here, so config.ts falls back to the hosted Render backend
# when unset (existing deployments keep working unchanged). Override with:
#   docker run -e ARGUS_BACKEND_URL=http://my-backend:8080 ...
CMD ["node", "server.js"]
