# PWA Marketplace

> A secure, user-friendly marketplace for Progressive Web Applications with built-in password management and sandboxing capabilities.

![PWA Marketplace](https://img.shields.io/badge/PWA-Marketplace-blue?style=for-the-badge)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)

## 🎯 Vision

Transform how users discover, install, and manage Progressive Web Applications by providing a secure, desktop-like experience with enterprise-grade security and consumer-friendly usability.

## ✨ Key Features

### 🏪 **GitHub-Powered App Store**
- Automatic discovery of PWA applications from GitHub
- Smart categorization and filtering
- Community ratings and reviews
- Curated collections and recommendations

### 🔒 **Enterprise Security**
- Sandbox isolation for each application
- Granular permission management
- Audit logging of all operations
- Zero-trust security model

### 🔑 **Built-in Password Manager**
- AES-256 encryption with Argon2 key derivation
- Auto-generation of GitHub tokens
- Secure storage of app credentials
- Bitwarden-like user experience

### 🐳 **Transparent Docker Integration**
- Automatic Docker installation and management
- Health monitoring and auto-recovery
- Resource optimization and cleanup
- Container orchestration with Docker Compose

### 🖥️ **Native Desktop Experience**
- System tray integration
- Native file dialogs and notifications
- Auto-start on system boot
- Cross-platform support (Windows, macOS, Linux)

## 🚀 Quick Start

### One-Click Installation

1. **Download the installer** for your platform:
   - [Windows (.exe)](releases/latest/PWA-Marketplace-Setup.exe)
   - [macOS (.dmg)](releases/latest/PWA-Marketplace-Setup.dmg)
   - [Linux (.AppImage)](releases/latest/PWA-Marketplace-Setup.AppImage)

2. **Run the installer** and follow the setup wizard

3. **Complete the 5-step setup**:
   - Create master password
   - Choose storage locations
   - Connect GitHub account
   - Configure permissions
   - Launch marketplace

4. **Start browsing PWA apps** at `http://localhost:3000`

### Developer Installation

```bash
# Clone the repository
git clone https://github.com/your-org/pwa-marketplace.git
cd pwa-marketplace

# Run the installation script
chmod +x scripts/install.sh
./scripts/install.sh

# Or use Docker Compose directly
docker-compose up -d
```

## 📋 System Requirements

### Minimum Requirements
- **OS**: Windows 10, macOS 10.15, Ubuntu 18.04+
- **RAM**: 2GB available memory
- **Storage**: 5GB free space
- **Network**: Internet connection for GitHub API

### Recommended Requirements
- **OS**: Windows 11, macOS 12+, Ubuntu 20.04+
- **RAM**: 4GB available memory
- **Storage**: 10GB free space
- **Docker**: Docker Desktop (auto-installed if missing)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Desktop Application (Tauri)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ System Tray │  │ Password    │  │ Folder Selector     │ │
│  │ Integration │  │ Manager     │  │ & Permissions       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │ IPC Communication
┌─────────────────────────────────────────────────────────────┐
│              Docker Container Ecosystem                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  PWA Marketplace Hub (Node.js + Express)              ││
│  │  ├─ GitHub Store Integration                           ││
│  │  ├─ App Installation & Management                     ││
│  │  ├─ User Interface & API                              ││
│  │  └─ Session & State Management                        ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  MCP Bridge Server (Node.js)                          ││
│  │  ├─ File System Protocol                              ││
│  │  ├─ Storage Management Protocol                       ││
│  │  ├─ System Information Protocol                       ││
│  │  └─ Custom Extension Protocols                        ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Resource Controller (Node.js)                        ││
│  │  ├─ Permission Management Engine                      ││
│  │  ├─ Sandbox Runtime Environment                       ││
│  │  ├─ File System Access Control                        ││
│  │  └─ Network Proxy & Filtering                         ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  GitHub Proxy & Cache (Node.js)                       ││
│  │  ├─ Rate Limiting & API Management                    ││
│  │  ├─ Repository Scanning & Analysis                    ││
│  │  ├─ Manifest Validation & Parsing                     ││
│  │  └─ Smart Caching & Optimization                      ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
pwa-marketplace/
├── 🦀 src-tauri/                  # Rust desktop application
│   ├── src/
│   │   ├── main.rs                # Application entry point
│   │   ├── system_tray.rs         # System tray management
│   │   ├── password_manager.rs    # Secure password storage
│   │   ├── docker_manager.rs      # Docker integration
│   │   └── github_auth.rs         # GitHub OAuth flow
│   ├── Cargo.toml                 # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
│
├── 🌐 src/                        # Frontend web application
│   ├── marketplace/               # Main marketplace interface
│   ├── password-manager/          # Password manager UI
│   ├── setup-wizard/              # Initial setup flow
│   └── components/                # Reusable UI components
│
├── 🔧 modules/                    # Core service modules
│   ├── github-store/              # GitHub integration
│   ├── mcp-bridge/                # MCP server implementation
│   ├── resource-controller/       # Permission & sandbox management
│   └── sandbox-runtime/           # PWA execution environment
│
├── 🐳 docker/                     # Docker configuration
│   ├── Dockerfile.*               # Service-specific Dockerfiles
│   ├── docker-compose.yml         # Main orchestration
│   └── nginx/                     # Reverse proxy configuration
│
├── ⚙️ config/                     # Configuration files
│   ├── security-policies.json     # Security rules
│   ├── github-sources.json        # Curated app sources
│   └── permissions.json           # Available permissions
│
├── 📦 installers/                 # Platform-specific installers
│   ├── windows/                   # Windows MSI/NSIS
│   ├── macos/                     # macOS DMG/PKG
│   └── linux/                     # AppImage/DEB/RPM
│
└── 📚 docs/                       # Documentation
    ├── api/                       # API documentation
    ├── development/               # Developer guides
    └── user/                      # User documentation
```

## 🔧 Development

### Prerequisites

- **Rust** 1.70+ (`rustup install stable`)
- **Node.js** 18+ (`nvm install 18`)
- **Docker** & Docker Compose
- **Git** for version control

### Development Setup

```bash
# Clone and setup
git clone https://github.com/your-org/pwa-marketplace.git
cd pwa-marketplace

# Install Rust dependencies
cd src-tauri && cargo build

# Install Node.js dependencies
npm install

# Start development environment
npm run tauri dev

# Or start services separately
docker-compose -f docker-compose.dev.yml up
npm run dev
```

### Available Scripts

```bash
# Development
npm run dev              # Start development server
npm run tauri dev        # Start Tauri in development mode
npm run build            # Build for production
npm run tauri build      # Build Tauri application

# Docker Management
make up                  # Start all services
make down                # Stop all services
make logs                # View service logs
make clean               # Clean containers and volumes

# Testing
npm test                 # Run test suite
npm run test:e2e         # Run end-to-end tests
cargo test               # Run Rust tests

# Quality Assurance
npm run lint             # Lint JavaScript/TypeScript
cargo clippy             # Lint Rust code
npm run format           # Format code
```

## 🔒 Security Features

### Sandbox Isolation
- Each PWA runs in its own isolated container
- Network access control and monitoring
- File system access limited to approved directories
- Memory and CPU resource limits

### Permission System
- Explicit user consent for all resource access
- Real-time permission dialogs
- Granular control over file and folder access
- Revokable permissions with audit trail

### Data Protection
- AES-256-GCM encryption for sensitive data
- Argon2 key derivation for password hashing
- Local-only storage (no cloud dependencies)
- Secure token management for API access

### Security Policies
- Content Security Policy (CSP) enforcement
- Strict HTTPS requirements
- Regular security updates via auto-updater
- Vulnerability scanning and monitoring

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Code Standards

- **Rust**: Follow `rustfmt` and `clippy` recommendations
- **JavaScript**: Use ESLint and Prettier configurations
- **Commits**: Follow [Conventional Commits](https://conventionalcommits.org/)
- **Documentation**: Update docs for all user-facing changes

## 📖 Documentation

- [**User Guide**](docs/user/README.md) - Complete user documentation
- [**API Reference**](docs/api/README.md) - API endpoints and schemas
- [**Development Guide**](docs/development/README.md) - Developer documentation
- [**Architecture Guide**](docs/architecture/README.md) - System design and decisions
- [**Security Guide**](docs/security/README.md) - Security model and best practices

## 🗺️ Roadmap

### Phase 1: Foundation ✅
- [x] Basic Tauri application with system tray
- [x] Password manager with encryption
- [x] Docker integration and management
- [x] Initial setup wizard

### Phase 2: Core Features 🚧
- [ ] GitHub store integration and discovery
- [ ] PWA installation and management
- [ ] Basic permission system
- [ ] MCP bridge implementation

### Phase 3: Advanced Features 📋
- [ ] Advanced sandbox runtime
- [ ] Comprehensive permission management
- [ ] App update system
- [ ] Performance monitoring

### Phase 4: Polish & Distribution 📋
- [ ] Auto-updater implementation
- [ ] Platform-specific installers
- [ ] Performance optimizations
- [ ] Production deployment

### Future Enhancements 🔮
- [ ] Cloud backup and sync
- [ ] Plugin system for extensions
- [ ] AI-powered app recommendations
- [ ] Multi-language support
- [ ] Enterprise management features

## 🐛 Bug Reports & Feature Requests

Found a bug or have a feature request? Please [open an issue](https://github.com/your-org/pwa-marketplace/issues) with:

- **Bug Reports**: Steps to reproduce, expected vs actual behavior, system info
- **Feature Requests**: Use case, proposed solution, alternatives considered

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) - For the amazing Rust+Web framework
- [GitHub API](https://docs.github.com/en/rest) - For powering our app discovery
- [Docker](https://docker.com/) - For containerization and isolation
- [PWA Community](https://web.dev/progressive-web-apps/) - For progressive web app standards

## 📞 Support

- **Documentation**: [docs.pwa-marketplace.com](https://docs.pwa-marketplace.com)
- **Community**: [Discord Server](https://discord.gg/pwa-marketplace)
- **Issues**: [GitHub Issues](https://github.com/your-org/pwa-marketplace/issues)
- **Email**: support@pwa-marketplace.com

---

<div align="center">
  <p><strong>Built with ❤️ for the PWA community</strong></p>
  <p>
    <a href="https://github.com/your-org/pwa-marketplace/stargazers">⭐ Star us on GitHub</a> •
    <a href="https://twitter.com/pwa_marketplace">🐦 Follow on Twitter</a> •
    <a href="https://discord.gg/pwa-marketplace">💬 Join Discord</a>
  </p>
</div>