// modules/app-manager/installer.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const archiver = require('archiver');
const extract = require('extract-zip');

class AppInstaller extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            appsPath: config.appsPath || './storage/apps',
            tempPath: config.tempPath || './storage/temp',
            maxAppSize: config.maxAppSize || 100 * 1024 * 1024, // 100MB
            allowedFileTypes: config.allowedFileTypes || [
                '.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', 
                '.gif', '.svg', '.woff', '.woff2', '.ico', '.txt', '.md'
            ],
            githubToken: config.githubToken || null,
            ...config
        };
        
        // Installation tracking
        this.activeInstallations = new Map();
        this.installedApps = new Map();
        
        this.initializeInstaller();
    }
    
    async initializeInstaller() {
        try {
            // Create necessary directories
            await fs.mkdir(this.config.appsPath, { recursive: true });
            await fs.mkdir(this.config.tempPath, { recursive: true });
            
            // Load existing installations
            await this.loadInstalledApps();
            
            console.log(`App installer initialized with ${this.installedApps.size} apps`);
            
        } catch (error) {
            console.error('Failed to initialize app installer:', error);
            this.emit('error', error);
        }
    }
    
    async loadInstalledApps() {
        try {
            const appDirs = await fs.readdir(this.config.appsPath, { withFileTypes: true });
            
            for (const dir of appDirs) {
                if (dir.isDirectory()) {
                    const appPath = path.join(this.config.appsPath, dir.name);
                    const metadataPath = path.join(appPath, 'app-metadata.json');
                    
                    try {
                        const metadataContent = await fs.readFile(metadataPath, 'utf8');
                        const metadata = JSON.parse(metadataContent);
                        
                        this.installedApps.set(dir.name, {
                            ...metadata,
                            installPath: appPath,
                            lastLoaded: new Date(metadata.installedAt)
                        });
                        
                    } catch (error) {
                        console.warn(`Failed to load metadata for app ${dir.name}:`, error);
                    }
                }
            }
            
        } catch (error) {
            console.error('Failed to load installed apps:', error);
        }
    }
    
    // Install app from GitHub repository
    async installFromGitHub(repoOwner, repoName, options = {}) {
        const installId = `${repoOwner}-${repoName}-${Date.now()}`;
        const appId = `${repoOwner}-${repoName}`;
        
        try {
            this.activeInstallations.set(installId, {
                appId,
                repoOwner,
                repoName,
                status: 'starting',
                progress: 0,
                startTime: Date.now()
            });
            
            this.emit('installationStarted', {
                installId,
                appId,
                repoOwner,
                repoName
            });
            
            // Step 1: Fetch repository information
            this.updateInstallationProgress(installId, 10, 'Fetching repository information...');
            const repoInfo = await this.fetchRepositoryInfo(repoOwner, repoName);
            
            // Step 2: Validate PWA requirements
            this.updateInstallationProgress(installId, 20, 'Validating PWA requirements...');
            const validation = await this.validatePWARepository(repoOwner, repoName);
            
            if (!validation.isValid) {
                throw new Error(`Repository is not a valid PWA: ${validation.errors.join(', ')}`);
            }
            
            // Step 3: Download repository
            this.updateInstallationProgress(installId, 30, 'Downloading repository...');
            const downloadPath = await this.downloadRepository(repoOwner, repoName, repoInfo.default_branch);
            
            // Step 4: Extract and validate files
            this.updateInstallationProgress(installId, 50, 'Extracting and validating files...');
            const extractedPath = await this.extractRepository(downloadPath, installId);
            await this.validateAppFiles(extractedPath);
            
            // Step 5: Process manifest and files
            this.updateInstallationProgress(installId, 70, 'Processing application files...');
            const manifest = await this.processManifest(extractedPath);
            const processedFiles = await this.processAppFiles(extractedPath, manifest);
            
            // Step 6: Install to final location
            this.updateInstallationProgress(installId, 85, 'Installing application...');
            const installPath = await this.installApp(appId, {
                manifest,
                files: processedFiles,
                repoInfo,
                validation,
                options
            });
            
            // Step 7: Create metadata and finalize
            this.updateInstallationProgress(installId, 95, 'Finalizing installation...');
            const metadata = await this.createAppMetadata(appId, {
                manifest,
                repoInfo,
                installPath,
                options
            });
            
            // Complete installation
            this.updateInstallationProgress(installId, 100, 'Installation complete!');
            
            const installedApp = {
                appId,
                ...metadata,
                installPath
            };
            
            this.installedApps.set(appId, installedApp);
            this.activeInstallations.delete(installId);
            
            this.emit('installationCompleted', {
                installId,
                appId,
                app: installedApp
            });
            
            // Cleanup temp files
            await this.cleanupTempFiles(installId);
            
            return installedApp;
            
        } catch (error) {
            this.activeInstallations.delete(installId);
            this.emit('installationFailed', {
                installId,
                appId,
                error: error.message
            });
            
            // Cleanup on failure
            await this.cleanupTempFiles(installId);
            
            throw error;
        }
    }
    
    // Install app from local files
    async installFromFiles(appId, files, manifest, options = {}) {
        const installId = `local-${appId}-${Date.now()}`;
        
        try {
            this.activeInstallations.set(installId, {
                appId,
                status: 'starting',
                progress: 0,
                startTime: Date.now()
            });
            
            this.emit('installationStarted', { installId, appId });
            
            // Validate manifest
            this.updateInstallationProgress(installId, 20, 'Validating manifest...');
            this.validateManifest(manifest);
            
            // Validate files
            this.updateInstallationProgress(installId, 40, 'Validating files...');
            await this.validateFiles(files);
            
            // Process files
            this.updateInstallationProgress(installId, 60, 'Processing files...');
            const processedFiles = await this.processFiles(files);
            
            // Install app
            this.updateInstallationProgress(installId, 80, 'Installing application...');
            const installPath = await this.installApp(appId, {
                manifest,
                files: processedFiles,
                options
            });
            
            // Create metadata
            this.updateInstallationProgress(installId, 95, 'Creating metadata...');
            const metadata = await this.createAppMetadata(appId, {
                manifest,
                installPath,
                options,
                source: 'local'
            });
            
            this.updateInstallationProgress(installId, 100, 'Installation complete!');
            
            const installedApp = {
                appId,
                ...metadata,
                installPath
            };
            
            this.installedApps.set(appId, installedApp);
            this.activeInstallations.delete(installId);
            
            this.emit('installationCompleted', {
                installId,
                appId,
                app: installedApp
            });
            
            return installedApp;
            
        } catch (error) {
            this.activeInstallations.delete(installId);
            this.emit('installationFailed', {
                installId,
                appId,
                error: error.message
            });
            
            throw error;
        }
    }
    
    // Uninstall app
    async uninstallApp(appId) {
        try {
            const app = this.installedApps.get(appId);
            if (!app) {
                throw new Error(`App not found: ${appId}`);
            }
            
            this.emit('uninstallationStarted', { appId });
            
            // Remove app directory
            await fs.rm(app.installPath, { recursive: true, force: true });
            
            // Remove from installed apps
            this.installedApps.delete(appId);
            
            this.emit('uninstallationCompleted', { appId });
            
            return true;
            
        } catch (error) {
            this.emit('uninstallationFailed', {
                appId,
                error: error.message
            });
            
            throw error;
        }
    }
    
    // Update app
    async updateApp(appId, options = {}) {
        try {
            const app = this.installedApps.get(appId);
            if (!app) {
                throw new Error(`App not found: ${appId}`);
            }
            
            if (!app.repoOwner || !app.repoName) {
                throw new Error('App was not installed from GitHub, cannot update');
            }
            
            // Check if update is available
            const updateInfo = await this.checkForUpdates(appId);
            if (!updateInfo.hasUpdate) {
                return { updated: false, reason: 'No update available' };
            }
            
            // Backup current installation
            const backupPath = await this.backupApp(appId);
            
            try {
                // Install new version
                const updatedApp = await this.installFromGitHub(
                    app.repoOwner,
                    app.repoName,
                    { ...options, isUpdate: true }
                );
                
                // Remove backup on success
                await fs.rm(backupPath, { recursive: true, force: true });
                
                this.emit('updateCompleted', {
                    appId,
                    previousVersion: app.version,
                    newVersion: updatedApp.version
                });
                
                return {
                    updated: true,
                    previousVersion: app.version,
                    newVersion: updatedApp.version
                };
                
            } catch (error) {
                // Restore from backup on failure
                await this.restoreFromBackup(appId, backupPath);
                throw error;
            }
            
        } catch (error) {
            this.emit('updateFailed', {
                appId,
                error: error.message
            });
            
            throw error;
        }
    }
    
    // Check for app updates
    async checkForUpdates(appId) {
        try {
            const app = this.installedApps.get(appId);
            if (!app || !app.repoOwner || !app.repoName) {
                return { hasUpdate: false, reason: 'App not found or not from GitHub' };
            }
            
            const repoInfo = await this.fetchRepositoryInfo(app.repoOwner, app.repoName);
            const lastCommit = repoInfo.updated_at;
            const installedAt = new Date(app.installedAt);
            
            const hasUpdate = new Date(lastCommit) > installedAt;
            
            return {
                hasUpdate,
                appId,
                currentVersion: app.version,
                lastCommit,
                installedAt: app.installedAt,
                repoUrl: repoInfo.html_url
            };
            
        } catch (error) {
            return {
                hasUpdate: false,
                error: error.message
            };
        }
    }
    
    // Get installed apps
    getInstalledApps() {
        return Array.from(this.installedApps.values());
    }
    
    // Get app by ID
    getApp(appId) {
        return this.installedApps.get(appId);
    }
    
    // Get installation status
    getInstallationStatus(installId) {
        return this.activeInstallations.get(installId);
    }
    
    // Private helper methods
    
    updateInstallationProgress(installId, progress, message) {
        const installation = this.activeInstallations.get(installId);
        if (installation) {
            installation.progress = progress;
            installation.status = message;
            
            this.emit('installationProgress', {
                installId,
                progress,
                message,
                appId: installation.appId
            });
        }
    }
    
    async fetchRepositoryInfo(owner, repo) {
        const url = `https://api.github.com/repos/${owner}/${repo}`;
        const headers = {};
        
        if (this.config.githubToken) {
            headers['Authorization'] = `token ${this.config.githubToken}`;
        }
        
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }
        
        return await response.json();
    }
    
    async validatePWARepository(owner, repo) {
        try {
            // Check for manifest.json
            const manifestUrl = `https://api.github.com/repos/${owner}/${repo}/contents/manifest.json`;
            const headers = {};
            
            if (this.config.githubToken) {
                headers['Authorization'] = `token ${this.config.githubToken}`;
            }
            
            const manifestResponse = await fetch(manifestUrl, { headers });
            
            if (!manifestResponse.ok) {
                return {
                    isValid: false,
                    errors: ['No manifest.json found in repository root']
                };
            }
            
            const manifestData = await manifestResponse.json();
            const manifestContent = Buffer.from(manifestData.content, 'base64').toString('utf8');
            
            try {
                const manifest = JSON.parse(manifestContent);
                
                const errors = [];
                const warnings = [];
                
                // Required fields
                if (!manifest.name) errors.push('Manifest missing required "name" field');
                if (!manifest.start_url) errors.push('Manifest missing required "start_url" field');
                
                // Recommended fields
                if (!manifest.display) warnings.push('Manifest missing "display" field');
                if (!manifest.theme_color) warnings.push('Manifest missing "theme_color" field');
                if (!manifest.icons || manifest.icons.length === 0) {
                    warnings.push('Manifest missing icons');
                }
                
                // Check for service worker
                const swFiles = ['sw.js', 'service-worker.js', 'serviceworker.js'];
                let hasServiceWorker = false;
                
                for (const swFile of swFiles) {
                    try {
                        const swUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${swFile}`;
                        const swResponse = await fetch(swUrl, { headers });
                        if (swResponse.ok) {
                            hasServiceWorker = true;
                            break;
                        }
                    } catch (error) {
                        // Continue checking other files
                    }
                }
                
                if (!hasServiceWorker) {
                    warnings.push('No service worker detected');
                }
                
                return {
                    isValid: errors.length === 0,
                    errors,
                    warnings,
                    manifest,
                    hasServiceWorker,
                    score: this.calculatePWAScore(manifest, hasServiceWorker)
                };
                
            } catch (parseError) {
                return {
                    isValid: false,
                    errors: ['Invalid manifest.json: ' + parseError.message]
                };
            }
            
        } catch (error) {
            return {
                isValid: false,
                errors: ['Failed to validate repository: ' + error.message]
            };
        }
    }
    
    calculatePWAScore(manifest, hasServiceWorker) {
        let score = 0;
        
        // Manifest completeness (60 points)
        if (manifest.name) score += 10;
        if (manifest.short_name) score += 5;
        if (manifest.description) score += 5;
        if (manifest.start_url) score += 10;
        if (manifest.display) score += 10;
        if (manifest.theme_color) score += 5;
        if (manifest.background_color) score += 5;
        if (manifest.icons && manifest.icons.length > 0) score += 10;
        
        // Service Worker (30 points)
        if (hasServiceWorker) score += 30;
        
        // Bonus features (10 points)
        if (manifest.categories) score += 2;
        if (manifest.shortcuts) score += 2;
        if (manifest.share_target) score += 3;
        if (manifest.protocol_handlers) score += 3;
        
        return Math.min(100, score);
    }
    
    async downloadRepository(owner, repo, branch = 'main') {
        const downloadUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
        const tempFileName = `${owner}-${repo}-${Date.now()}.zip`;
        const downloadPath = path.join(this.config.tempPath, tempFileName);
        
        const response = await fetch(downloadUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to download repository: ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Check file size
        if (buffer.length > this.config.maxAppSize) {
            throw new Error(`Repository too large: ${buffer.length} bytes > ${this.config.maxAppSize} bytes`);
        }
        
        await fs.writeFile(downloadPath, buffer);
        
        return downloadPath;
    }
    
    async extractRepository(zipPath, installId) {
        const extractPath = path.join(this.config.tempPath, `extract-${installId}`);
        
        await extract(zipPath, { dir: path.resolve(extractPath) });
        
        // Find the actual app directory (GitHub creates a folder with repo name)
        const entries = await fs.readdir(extractPath, { withFileTypes: true });
        const appDir = entries.find(entry => entry.isDirectory());
        
        if (!appDir) {
            throw new Error('No app directory found in extracted files');
        }
        
        return path.join(extractPath, appDir.name);
    }
    
    async validateAppFiles(appPath) {
        const entries = await fs.readdir(appPath, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                
                if (!this.config.allowedFileTypes.includes(ext)) {
                    throw new Error(`File type not allowed: ${entry.name} (${ext})`);
                }
                
                // Check file size
                const filePath = path.join(appPath, entry.name);
                const stats = await fs.stat(filePath);
                
                if (stats.size > 10 * 1024 * 1024) { // 10MB per file
                    throw new Error(`File too large: ${entry.name} (${stats.size} bytes)`);
                }
            }
        }
    }
    
    async processManifest(appPath) {
        const manifestPath = path.join(appPath, 'manifest.json');
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        
        // Validate and sanitize manifest
        this.validateManifest(manifest);
        
        return manifest;
    }
    
    validateManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') {
            throw new Error('Invalid manifest: must be an object');
        }
        
        if (!manifest.name || typeof manifest.name !== 'string') {
            throw new Error('Invalid manifest: name must be a non-empty string');
        }
        
        if (!manifest.start_url || typeof manifest.start_url !== 'string') {
            throw new Error('Invalid manifest: start_url must be a non-empty string');
        }
        
        // Sanitize dangerous fields
        const dangerousFields = ['background', 'content_scripts', 'permissions'];
        for (const field of dangerousFields) {
            if (manifest[field]) {
                delete manifest[field];
            }
        }
        
        return true;
    }
    
    async processAppFiles(appPath, manifest) {
        const files = {};
        const entries = await fs.readdir(appPath, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isFile()) {
                const filePath = path.join(appPath, entry.name);
                const content = await fs.readFile(filePath);
                
                // Process different file types
                if (entry.name.endsWith('.html')) {
                    files[entry.name] = this.processHTMLFile(content.toString('utf8'));
                } else if (entry.name.endsWith('.js')) {
                    files[entry.name] = this.processJSFile(content.toString('utf8'));
                } else if (entry.name.endsWith('.css')) {
                    files[entry.name] = this.processCSSFile(content.toString('utf8'));
                } else {
                    files[entry.name] = content;
                }
            }
        }
        
        return files;
    }
    
    processHTMLFile(content) {
        // Basic HTML sanitization and validation
        // In a real implementation, you'd use a proper HTML sanitizer
        
        // Remove potentially dangerous elements
        const dangerousPatterns = [
            /<script[^>]*src=["'][^"']*["'][^>]*>/gi,
            /<iframe[^>]*>/gi,
            /<object[^>]*>/gi,
            /<embed[^>]*>/gi
        ];
        
        let processedContent = content;
        for (const pattern of dangerousPatterns) {
            processedContent = processedContent.replace(pattern, '<!-- Removed for security -->');
        }
        
        return processedContent;
    }
    
    processJSFile(content) {
        // Basic JavaScript validation
        // In a real implementation, you'd use AST parsing for security analysis
        
        // Check for potentially dangerous APIs
        const dangerousAPIs = [
            'eval(',
            'Function(',
            'setTimeout(',
            'setInterval(',
            'document.write(',
            'innerHTML ='
        ];
        
        for (const api of dangerousAPIs) {
            if (content.includes(api)) {
                console.warn(`Potentially dangerous API found in JS: ${api}`);
            }
        }
        
        return content;
    }
    
    processCSSFile(content) {
        // Basic CSS validation and sanitization
        
        // Remove potentially dangerous CSS
        const dangerousPatterns = [
            /expression\s*\(/gi,
            /javascript\s*:/gi,
            /-moz-binding\s*:/gi
        ];
        
        let processedContent = content;
        for (const pattern of dangerousPatterns) {
            processedContent = processedContent.replace(pattern, '/* Removed for security */');
        }
        
        return processedContent;
    }
    
    async installApp(appId, { manifest, files, repoInfo, options }) {
        const installPath = path.join(this.config.appsPath, appId);
        
        // Create app directory
        await fs.mkdir(installPath, { recursive: true });
        
        // Write manifest
        const manifestPath = path.join(installPath, 'manifest.json');
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        
        // Write app files
        for (const [filename, content] of Object.entries(files)) {
            const filePath = path.join(installPath, filename);
            
            if (typeof content === 'string') {
                await fs.writeFile(filePath, content, 'utf8');
            } else {
                await fs.writeFile(filePath, content);
            }
        }
        
        return installPath;
    }
    
    async createAppMetadata(appId, { manifest, repoInfo, installPath, options }) {
        const metadata = {
            appId,
            name: manifest.name,
            version: manifest.version || '1.0.0',
            description: manifest.description || '',
            author: repoInfo?.owner?.login || 'Unknown',
            installedAt: new Date().toISOString(),
            installPath,
            source: repoInfo ? 'github' : options.source || 'unknown',
            repoOwner: repoInfo?.owner?.login,
            repoName: repoInfo?.name,
            repoUrl: repoInfo?.html_url,
            manifest: manifest,
            permissions: options.permissions || [],
            size: await this.calculateAppSize(installPath)
        };
        
        const metadataPath = path.join(installPath, 'app-metadata.json');
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        
        return metadata;
    }
    
    async calculateAppSize(appPath) {
        let totalSize = 0;
        
        const calculateDirectorySize = async (dirPath) => {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    await calculateDirectorySize(fullPath);
                } else {
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;
                }
            }
        };
        
        await calculateDirectorySize(appPath);
        return totalSize;
    }
    
    async backupApp(appId) {
        const app = this.installedApps.get(appId);
        if (!app) {
            throw new Error(`App not found: ${appId}`);
        }
        
        const backupPath = path.join(this.config.tempPath, `backup-${appId}-${Date.now()}`);
        
        // Copy app directory to backup location
        await this.copyDirectory(app.installPath, backupPath);
        
        return backupPath;
    }
    
    async restoreFromBackup(appId, backupPath) {
        const app = this.installedApps.get(appId);
        if (!app) {
            throw new Error(`App not found: ${appId}`);
        }
        
        // Remove current installation
        await fs.rm(app.installPath, { recursive: true, force: true });
        
        // Restore from backup
        await this.copyDirectory(backupPath, app.installPath);
        
        // Remove backup
        await fs.rm(backupPath, { recursive: true, force: true });
    }
    
    async copyDirectory(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        
        const entries = await fs.readdir(src, { withFileTypes: true });
        
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            
            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }
    
    async cleanupTempFiles(installId) {
        const tempPattern = path.join(this.config.tempPath, `*${installId}*`);
        
        try {
            const tempFiles = await fs.readdir(this.config.tempPath);
            
            for (const file of tempFiles) {
                if (file.includes(installId)) {
                    const filePath = path.join(this.config.tempPath, file);
                    await fs.rm(filePath, { recursive: true, force: true });
                }
            }
        } catch (error) {
            console.warn('Failed to cleanup temp files:', error);
        }
    }
    
    async validateFiles(files) {
        for (const [filename, content] of Object.entries(files)) {
            const ext = path.extname(filename).toLowerCase();
            
            if (!this.config.allowedFileTypes.includes(ext)) {
                throw new Error(`File type not allowed: ${filename} (${ext})`);
            }
            
            const size = typeof content === 'string' 
                ? Buffer.byteLength(content, 'utf8')
                : content.length;
                
            if (size > 10 * 1024 * 1024) { // 10MB per file
                throw new Error(`File too large: ${filename} (${size} bytes)`);
            }
        }
    }
    
    async processFiles(files) {
        const processed = {};
        
        for (const [filename, content] of Object.entries(files)) {
            if (filename.endsWith('.html')) {
                processed[filename] = this.processHTMLFile(content);
            } else if (filename.endsWith('.js')) {
                processed[filename] = this.processJSFile(content);
            } else if (filename.endsWith('.css')) {
                processed[filename] = this.processCSSFile(content);
            } else {
                processed[filename] = content;
            }
        }
        
        return processed;
    }
}

module.exports = AppInstaller;