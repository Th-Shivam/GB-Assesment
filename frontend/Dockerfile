FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Compose is an explicit local same-origin mode. Nginx proxies /backend/ to the
# backend service; normal public production builds still use `npm run build`
# and require an absolute HTTPS VITE_API_BASE_URL.
ARG VITE_API_BASE_URL=/backend
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build:compose

FROM nginxinc/nginx-unprivileged:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1
