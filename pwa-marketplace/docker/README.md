# Docker Configuration

This directory contains Docker-related configuration files for containerizing the PWA Marketplace services.

## Structure

```
docker/
├── Dockerfile.*      # Service-specific Dockerfiles
├── docker-compose.yml # Main orchestration
└── nginx/            # Reverse proxy configuration
```

## Services

- Frontend service
- Backend service
- MCP server
- Database (if needed)
- Cache service

## Building

```bash
# Build all services
docker-compose build

# Start services
docker-compose up

# Stop services
docker-compose down
```

## Security

- Network isolation
- Resource limits
- Volume permissions
- Secure communication

## License

MIT License - see LICENSE file for details
