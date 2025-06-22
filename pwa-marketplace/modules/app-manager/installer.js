const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);

class AppInstaller {
    constructor(config) {
        this.config = config;
        this.appsDir = this.config.appsDir || path.join(process.cwd(), 'apps');
        this.manifestsDir = this.config.manifestsDir || path.join(this.appsDir, 'manifests');
        this.initialize();
    }

    async initialize() {
        // Create necessary directories
        await mkdir(this.appsDir, { recursive: true });
        await mkdir(this.manifestsDir, { recursive: true });
    }

    async install(manifestUrl, options = {}) {
        try {
            // Validate manifest URL
            if (!manifestUrl) {
                throw new Error('Manifest URL is required');
            }

            // Download manifest
            const manifestResponse = await axios.get(manifestUrl);
            const manifest = manifestResponse.data;

            // Validate manifest
            if (!this.validateManifest(manifest)) {
                throw new Error('Invalid manifest format');
            }

            // Generate app ID
            const appId = uuidv4();
            const appDir = path.join(this.appsDir, appId);
            const manifestPath = path.join(this.manifestsDir, `${appId}.json`);

            // Create app directory
            await mkdir(appDir, { recursive: true });

            // Download app files
            const downloadPromises = manifest.files.map(async (file) => {
                const filePath = path.join(appDir, file.path);
                await this.downloadFile(file.url, filePath);
            });

            await Promise.all(downloadPromises);

            // Save manifest
            await writeFile(
                manifestPath,
                JSON.stringify({
                    ...manifest,
                    id: appId,
                    installedAt: new Date().toISOString(),
                    options
                }, null, 2)
            );

            return {
                id: appId,
                status: 'success',
                message: 'App installed successfully',
                manifest
            };
        } catch (error) {
            console.error('Error installing app:', error);
            throw error;
        }
    }

    async uninstall(appId) {
        try {
            // Validate app ID
            if (!appId) {
                throw new Error('App ID is required');
            }

            // Get app directory
            const appDir = path.join(this.appsDir, appId);
            const manifestPath = path.join(this.manifestsDir, `${appId}.json`);

            // Remove app directory
            if (fs.existsSync(appDir)) {
                await this.removeDirectory(appDir);
            }

            // Remove manifest
            if (fs.existsSync(manifestPath)) {
                await fs.promises.unlink(manifestPath);
            }

            return {
                id: appId,
                status: 'success',
                message: 'App uninstalled successfully'
            };
        } catch (error) {
            console.error('Error uninstalling app:', error);
            throw error;
        }
    }

    async update(appId, manifestUrl) {
        try {
            // Validate app ID and manifest URL
            if (!appId || !manifestUrl) {
                throw new Error('App ID and manifest URL are required');
            }

            // Get current manifest
            const manifestPath = path.join(this.manifestsDir, `${appId}.json`);
            const currentManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

            // Download new manifest
            const manifestResponse = await axios.get(manifestUrl);
            const newManifest = manifestResponse.data;

            // Validate manifest
            if (!this.validateManifest(newManifest)) {
                throw new Error('Invalid manifest format');
            }

            // Get app directory
            const appDir = path.join(this.appsDir, appId);

            // Download updated files
            const downloadPromises = newManifest.files.map(async (file) => {
                const filePath = path.join(appDir, file.path);
                await this.downloadFile(file.url, filePath);
            });

            await Promise.all(downloadPromises);

            // Update manifest
            await writeFile(
                manifestPath,
                JSON.stringify({
                    ...newManifest,
                    id: appId,
                    installedAt: currentManifest.installedAt,
                    updatedAt: new Date().toISOString()
                }, null, 2)
            );

            return {
                id: appId,
                status: 'success',
                message: 'App updated successfully',
                manifest: newManifest
            };
        } catch (error) {
            console.error('Error updating app:', error);
            throw error;
        }
    }

    async list() {
        try {
            const manifests = await fs.promises.readdir(this.manifestsDir);
            const apps = await Promise.all(
                manifests.map(async (manifestFile) => {
                    const manifestPath = path.join(this.manifestsDir, manifestFile);
                    return JSON.parse(await readFile(manifestPath, 'utf8'));
                })
            );

            return apps;
        } catch (error) {
            console.error('Error listing apps:', error);
            throw error;
        }
    }

    validateManifest(manifest) {
        return manifest &&
            typeof manifest === 'object' &&
            manifest.name &&
            manifest.version &&
            Array.isArray(manifest.files);
    }

    async downloadFile(url, dest) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await writeFile(dest, response.data);
        } catch (error) {
            console.error('Error downloading file:', error);
            throw error;
        }
    }

    async removeDirectory(dir) {
        try {
            const files = await fs.promises.readdir(dir);
            const removePromises = files.map(async (file) => {
                const filePath = path.join(dir, file);
                const stats = await fs.promises.stat(filePath);
                if (stats.isDirectory()) {
                    await this.removeDirectory(filePath);
                } else {
                    await fs.promises.unlink(filePath);
                }
            });

            await Promise.all(removePromises);
            await fs.promises.rmdir(dir);
        } catch (error) {
            console.error('Error removing directory:', error);
            throw error;
        }
    }
}

module.exports = AppInstaller;
