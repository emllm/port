#!/bin/bash

# Check if in git repository
git status &> /dev/null
if [ $? -ne 0 ]; then
    echo "Error: Not in a git repository"
    exit 1
fi

# Build frontend in a temporary directory
TEMP_DIR="./build"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

cp -r src/marketplace/* "$TEMP_DIR"

cd "$TEMP_DIR"

# Install and build frontend
npm install
npm run build

# Run tests
npm test

# Go back to root and build Docker images
cd ..
docker-compose build

echo "Cleaning up temporary build directory"
rm -rf "$TEMP_DIR"
