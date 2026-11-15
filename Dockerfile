# Image unique (Node 22) pour Miroir et pour Boréal Courtage. Construit par AWS CodeBuild (voir infra/), exécuté sur ECS Fargate.
# Images Node tirées de la galerie publique ECR (pas de limite de téléchargement Docker Hub dans CodeBuild).
FROM public.ecr.aws/docker/library/node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM public.ecr.aws/docker/library/node:22-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY dataset ./dataset
# prefetch_news.mjs peut tourner en tâche ECS ponctuelle pour compléter le corpus dans S3.
COPY scripts ./scripts
# Copie locale de repli : en production, les données et le corpus sont lus depuis S3 (DATA_BUCKET).
COPY --chown=node:node data ./data
USER node
EXPOSE 3000
# Même image pour les deux applications : Miroir par défaut ; le conteneur de la plateforme de courtage
# remplace la commande par « node dist/bank/main.js ».
CMD ["node", "dist/miroir/main.js"]
