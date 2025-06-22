# Platform-Specific Installers

This directory contains installers for different operating systems.

## Installers

### Windows
- MSI installer
- NSIS installer
- Windows Store package

### macOS
- DMG installer
- PKG installer
- Mac App Store package

### Linux
- AppImage
- DEB package
- RPM package
- Flatpak

## Building

Each platform has its own build process:

```bash
# Windows
./build-windows.sh

# macOS
./build-macos.sh

# Linux
./build-linux.sh
```

## Security

- Code signing
- Digital signatures
- Secure distribution
- Package verification

## License

MIT License - see LICENSE file for details
