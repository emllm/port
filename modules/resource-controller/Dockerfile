# Moved from docker/Dockerfile.resource-controller
# Please verify and update paths as needed

FROM node:18-slim
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "permission-manager.js"]
