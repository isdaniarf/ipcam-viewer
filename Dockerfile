FROM node:22-alpine AS config-gen
WORKDIR /app
COPY scripts/generate-config.mjs ./scripts/
COPY scripts/lib/ ./scripts/lib/
CMD ["node", "scripts/generate-config.mjs", "--target", "docker"]

FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.30-alpine AS web
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
