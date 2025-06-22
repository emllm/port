# PWA Marketplace

A secure desktop application for managing and running Progressive Web Applications (PWAs) with native integration capabilities.

## Features

- Secure PWA execution environment
- Native desktop integration (system tray, notifications)
- GitHub integration for app discovery
- Password management
- Resource sandboxing and permission management
- Cross-platform support (Windows, macOS, Linux)

## Technology Stack

- Frontend: HTML5, CSS3, JavaScript
- Backend: Rust (Tauri)
- Configuration: JSON
- Containerization: Docker

## Project Structure

```
pwa-marketplace/
├── src-tauri/          # Rust desktop application
├── src/               # Frontend web application
├── modules/           # Core service modules
├── docker/           # Docker configuration
├── config/           # Configuration files
├── installers/       # Platform-specific installers
└── docs/            # Documentation
```

## Getting Started

1. Clone the repository
2. Install dependencies
3. Build the application
4. Run the development server

## Development

See the [Development Guide](docs/development/getting-started.md) for detailed instructions on setting up the development environment.

## Security

This application implements strict security measures including:
- Resource sandboxing
- Permission-based access control
- Secure password management
- MCP protocol for secure communication

## License

MIT License - see LICENSE file for details
