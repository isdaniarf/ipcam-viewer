# Target: config-gen (init container)
FROM node:22-alpine AS config-gen
WORKDIR /app
COPY scripts/package.json scripts/package-lock.json ./scripts/
RUN cd scripts && npm ci --production
COPY scripts/generate-config.mjs ./scripts/
CMD ["node", "scripts/generate-config.mjs"]

# Target: web (frontend build → nginx)
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine AS web
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
