# Moved from docker/Dockerfile.mcp-bridge
# Please verify and update paths as needed

FROM node:18-slim
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "server.js"]
