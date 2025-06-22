#!/bin/bash

# Script to help with Docker setup and permissions

# Add user to docker group
sudo usermod -aG docker $USER

# Verify Docker group membership
echo "Checking Docker group membership..."
groups $USER | grep -q docker && echo "✅ User added to docker group" || echo "❌ Failed to add user to docker group"

# Verify Docker daemon is running
echo "Checking Docker daemon..."
if systemctl is-active --quiet docker; then
    echo "✅ Docker daemon is running"
else
    echo "❌ Docker daemon is not running. Starting now..."
    sudo systemctl start docker
fi

# Verify Docker permissions
echo "Verifying Docker permissions..."
docker ps > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Docker permissions are correctly set"
else
    echo "❌ Docker permissions still need to be fixed"
    echo "Please log out and log back in for changes to take effect"
fi

# Display next steps
echo ""
echo "Next steps:"
echo "1. Log out and log back in for group changes to take effect"
echo "2. Run docker commands without sudo"
echo "3. Run 'docker ps' to verify everything works"
