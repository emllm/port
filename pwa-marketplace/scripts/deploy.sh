#!/bin/bash

# Exit on error
set -e

# Check if in git repository
git status > /dev/null 2>&1 || {
    echo "Error: This script must be run from a git repository"
    exit 1
}

echo "Deploying PWA Marketplace..."

# Run build script
./build.sh

# Push to remote repository
echo "Pushing to remote repository..."
git push

# Start Docker containers
echo "Starting Docker containers..."
docker-compose up -d

# Wait for services to start
sleep 5

# Check container status
echo "Checking container status..."
docker-compose ps

# Push Docker images to registry
echo "Pushing Docker images to registry..."
docker-compose push

echo "Deployment completed successfully!"
