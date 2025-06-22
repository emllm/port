# Rust Desktop Application

This directory contains the Rust-based desktop application built with Tauri.

## Features

- System tray integration
- Password management
- Docker container management
- GitHub OAuth authentication
- Native system notifications

## Building

```bash
# Install dependencies
cargo install tauri-cli

# Build the application
cargo tauri dev

# Build release version
cargo tauri build
```

## Dependencies

- Tauri
- Reqwest
- Serde
- Tokio
- Windows API (Windows)
- Notify (Unix)

## Security

The application implements secure password storage and system tray integration with proper sandboxing.

## License

MIT License - see LICENSE file for details
