#!/bin/bash

# Exit on error
set -e

echo "Deploying PWA Marketplace..."

# Run build script
./build.sh

# Start Docker containers
echo "Starting Docker containers..."
docker-compose up -d

# Wait for services to start
sleep 5

# Check container status
echo "Checking container status..."
docker-compose ps

echo "Deployment completed successfully!"
