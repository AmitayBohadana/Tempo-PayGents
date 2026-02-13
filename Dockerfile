FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8787
ENV PORT=8787
CMD ["npx", "tsx", "agent/src/index.ts"]
