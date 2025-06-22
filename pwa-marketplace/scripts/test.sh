#!/bin/bash

# Exit on error
set -e

echo "Running PWA Marketplace tests..."

# Run frontend tests
echo "Running frontend tests..."
cd frontend
npm test
cd ..

# Run backend tests
echo "Running backend tests..."
cd backend
npm test
cd ..

# Run integration tests
echo "Running integration tests..."
node tests/integration.js

echo "All tests passed successfully!"
