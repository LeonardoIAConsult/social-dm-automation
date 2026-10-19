# Build de produccion en dos etapas.
FROM node:20-alpine AS build
WORKDIR /app
# `npm run build` termina con el candado de superficie de copia (Sentinel #34), que es Python y
# vive en scripts/security/. Solo en esta etapa: la imagen final no lleva ni Python ni el candado.
RUN apk add --no-cache python3
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
