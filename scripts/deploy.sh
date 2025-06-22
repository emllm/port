#!/bin/bash

# Check if in git repository
git status &> /dev/null
if [ $? -ne 0 ]; then
    echo "Error: Not in a git repository"
    exit 1
fi

# Run build script
./scripts/build.sh

# Commit and push changes
git add .
git commit -m "[auto] Update at $(date '+%Y-%m-%d %H:%M:%S')"
git push

# Build and start Docker containers from root directory
docker-compose -f docker-compose.yml -f docker-compose.override.yml up -d

# Check container status
docker-compose ps

echo "Deployment complete. Services are running."
