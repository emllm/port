#!/bin/bash

# Exit on error
set -e

echo "Building PWA Marketplace..."

# Build frontend
echo "Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Build backend
echo "Building backend..."
cd backend
npm install
npm run build
cd ..

# Build Docker images
echo "Building Docker images..."
docker-compose build

echo "Build completed successfully!"
