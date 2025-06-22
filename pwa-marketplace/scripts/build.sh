#!/bin/bash

# Exit on error
set -e

# Check if in git repository
git status > /dev/null 2>&1 || {
    echo "Error: This script must be run from a git repository"
    exit 1
}

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

# Check for changes and push if needed
if [ -n "$(git status --porcelain)" ]; then
    echo "Changes detected. Committing and pushing..."
    git add .
    git commit -m "Build: $(date +'%Y-%m-%d %H:%M:%S')"
    git push
    echo "Changes pushed to remote repository"
else
    echo "No changes detected. Skipping git push"
fi

echo "Build completed successfully!"
