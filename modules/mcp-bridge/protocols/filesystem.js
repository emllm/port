// modules/mcp-bridge/protocols/filesystem.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { ProtocolHandler } = require('../server');

class FilesystemProtocol extends ProtocolHandler {
    constructor(config = {}) {
        super(config);
        
        this.name = 'filesystem';
        this.version = '1.0.0';
        this.description = 'File system operations with sandboxed access';
        
        this.config = {
            maxFileSize: 10 * 1024 * 1024, // 10MB default
            allowedExtensions: ['.txt', '.json', '.md', '.js', '.html', '.css', '.xml', '.yaml', '.yml'],
            blockedExtensions: ['.exe', '.bat', '.cmd', '.sh', '.ps1'],
            maxDirectoryDepth: 10,
            ...config
        };
        
        // App sandbox directories
        this.sandboxRoots = new Map(); // appId -> sandbox root path
    }
    
    // Initialize sandbox for an app
    async initializeSandbox(appId, allowedPaths = []) {
        try {
            const sandboxRoot = path.join(this.config.storagePath, 'sandboxes', appId);
            await fs.mkdir(sandboxRoot, { recursive: true });
            
            this.sandboxRoots.set(appId, {
                root: sandboxRoot,
                allowedPaths: allowedPaths.map(p => path.resolve(p)),
                createdAt: new Date()
            });
            
            this.logger('info', 'Sandbox initialized', { appId, sandboxRoot });
            
            return {
                sandboxRoot,
                allowedPaths
            };
            
        } catch (error) {
            throw new Error(`Failed to initialize sandbox: ${error.message}`);
        }
    }
    
    // Validate and resolve file path within sandbox
    validatePath(filePath, appId) {
        if (!appId) {
            throw new Error('App ID required for file operations');
        }
        
        const sandbox = this.sandboxRoots.get(appId);
        if (!sandbox) {
            throw new Error(`Sandbox not initialized for app: ${appId}`);
        }
        
        // Resolve path
        const resolvedPath = path.resolve(filePath);
        
        // Check if path is within sandbox or allowed paths
        const isInSandbox = resolvedPath.startsWith(sandbox.root);
        const isInAllowedPath = sandbox.allowedPaths.some(allowedPath => 
            resolvedPath.startsWith(allowedPath)
        );
        
        if (!isInSandbox && !isInAllowedPath) {
            throw new Error(`Access denied: Path outside sandbox - ${resolvedPath}`);
        }
        
        // Check for path traversal attacks
        if (filePath.includes('..') || filePath.includes('~')) {
            throw new Error('Path traversal detected');
        }
        
        // Validate file extension
        const ext = path.extname(resolvedPath).toLowerCase();
        if (this.config.blockedExtensions.includes(ext)) {
            throw new Error(`File extension not allowed: ${ext}`);
        }
        
        return resolvedPath;
    }
    
    // Read file contents
    async readFile(params, context) {
        try {
            const { filePath, encoding = 'utf8', maxSize } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(filePath, appId);
            
            // Check file exists
            const stats = await fs.stat(validatedPath);
            if (!stats.isFile()) {
                throw new Error('Path is not a file');
            }
            
            // Check file size
            const sizeLimit = maxSize || this.config.maxFileSize;
            if (stats.size > sizeLimit) {
                throw new Error(`File too large: ${stats.size} bytes (limit: ${sizeLimit})`);
            }
            
            // Read file
            const content = await fs.readFile(validatedPath, encoding);
            
            return {
                content,
                size: stats.size,
                mtime: stats.mtime,
                encoding
            };
            
        } catch (error) {
            throw new Error(`Read file failed: ${error.message}`);
        }
    }
    
    // Write file contents
    async writeFile(params, context) {
        try {
            const { filePath, content, encoding = 'utf8', createDirs = false } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(filePath, appId);
            
            // Check content size
            const contentSize = Buffer.byteLength(content, encoding);
            if (contentSize > this.config.maxFileSize) {
                throw new Error(`Content too large: ${contentSize} bytes`);
            }
            
            // Create parent directories if requested
            if (createDirs) {
                const parentDir = path.dirname(validatedPath);
                await fs.mkdir(parentDir, { recursive: true });
            }
            
            // Write file
            await fs.writeFile(validatedPath, content, encoding);
            
            // Get file stats
            const stats = await fs.stat(validatedPath);
            
            return {
                path: validatedPath,
                size: stats.size,
                mtime: stats.mtime,
                success: true
            };
            
        } catch (error) {
            throw new Error(`Write file failed: ${error.message}`);
        }
    }
    
    // Append to file
    async appendFile(params, context) {
        try {
            const { filePath, content, encoding = 'utf8' } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(filePath, appId);
            
            // Check if file exists and get current size
            let currentSize = 0;
            try {
                const stats = await fs.stat(validatedPath);
                currentSize = stats.size;
            } catch (error) {
                // File doesn't exist, that's OK for append
            }
            
            const contentSize = Buffer.byteLength(content, encoding);
            if (currentSize + contentSize > this.config.maxFileSize) {
                throw new Error(`File would exceed size limit after append`);
            }
            
            await fs.appendFile(validatedPath, content, encoding);
            
            const stats = await fs.stat(validatedPath);
            
            return {
                path: validatedPath,
                size: stats.size,
                mtime: stats.mtime,
                appended: contentSize
            };
            
        } catch (error) {
            throw new Error(`Append file failed: ${error.message}`);
        }
    }
    
    // Delete file
    async deleteFile(params, context) {
        try {
            const { filePath } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(filePath, appId);
            
            // Check file exists
            const stats = await fs.stat(validatedPath);
            if (!stats.isFile()) {
                throw new Error('Path is not a file');
            }
            
            await fs.unlink(validatedPath);
            
            return {
                path: validatedPath,
                deleted: true,
                size: stats.size
            };
            
        } catch (error) {
            throw new Error(`Delete file failed: ${error.message}`);
        }
    }
    
    // List directory contents
    async listDirectory(params, context) {
        try {
            const { dirPath, includeHidden = false, includeStats = true } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(dirPath, appId);
            
            // Check directory exists
            const stats = await fs.stat(validatedPath);
            if (!stats.isDirectory()) {
                throw new Error('Path is not a directory');
            }
            
            const entries = await fs.readdir(validatedPath);
            const results = [];
            
            for (const entry of entries) {
                // Skip hidden files unless requested
                if (!includeHidden && entry.startsWith('.')) {
                    continue;
                }
                
                const entryPath = path.join(validatedPath, entry);
                const entryInfo = { name: entry, path: entryPath };
                
                if (includeStats) {
                    try {
                        const entryStats = await fs.stat(entryPath);
                        entryInfo.isFile = entryStats.isFile();
                        entryInfo.isDirectory = entryStats.isDirectory();
                        entryInfo.size = entryStats.size;
                        entryInfo.mtime = entryStats.mtime;
                        entryInfo.ctime = entryStats.ctime;
                    } catch (error) {
                        // Skip entries we can't stat
                        continue;
                    }
                }
                
                results.push(entryInfo);
            }
            
            return {
                path: validatedPath,
                entries: results,
                count: results.length
            };
            
        } catch (error) {
            throw new Error(`List directory failed: ${error.message}`);
        }
    }
    
    // Create directory
    async createDirectory(params, context) {
        try {
            const { dirPath, recursive = false } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(dirPath, appId);
            
            await fs.mkdir(validatedPath, { recursive });
            
            const stats = await fs.stat(validatedPath);
            
            return {
                path: validatedPath,
                created: true,
                mtime: stats.mtime
            };
            
        } catch (error) {
            throw new Error(`Create directory failed: ${error.message}`);
        }
    }
    
    // Remove directory
    async removeDirectory(params, context) {
        try {
            const { dirPath, recursive = false } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(dirPath, appId);
            
            // Check directory exists
            const stats = await fs.stat(validatedPath);
            if (!stats.isDirectory()) {
                throw new Error('Path is not a directory');
            }
            
            // Safety check - don't allow removing sandbox root
            const sandbox = this.sandboxRoots.get(appId);
            if (validatedPath === sandbox.root) {
                throw new Error('Cannot remove sandbox root directory');
            }
            
            if (recursive) {
                await fs.rm(validatedPath, { recursive: true, force: true });
            } else {
                await fs.rmdir(validatedPath);
            }
            
            return {
                path: validatedPath,
                removed: true
            };
            
        } catch (error) {
            throw new Error(`Remove directory failed: ${error.message}`);
        }
    }
    
    // Get file/directory stats
    async getStats(params, context) {
        try {
            const { filePath } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(filePath, appId);
            const stats = await fs.stat(validatedPath);
            
            return {
                path: validatedPath,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                size: stats.size,
                mtime: stats.mtime,
                ctime: stats.ctime,
                atime: stats.atime,
                mode: stats.mode,
                uid: stats.uid,
                gid: stats.gid
            };
            
        } catch (error) {
            throw new Error(`Get stats failed: ${error.message}`);
        }
    }
    
    // Check if file/directory exists
    async exists(params, context) {
        try {
            const { filePath } = params;
            const { appId } = context;
            
            const validatedPath = this.validatePath(filePath, appId);
            
            try {
                await fs.access(validatedPath);
                return { path: validatedPath, exists: true };
            } catch (error) {
                return { path: validatedPath, exists: false };
            }
            
        } catch (error) {
            throw new Error(`Check exists failed: ${error.message}`);
        }
    }
    
    // Copy file
    async copyFile(params, context) {
        try {
            const { sourcePath, destPath, overwrite = false } = params;
            const { appId } = context;
            
            const validatedSource = this.validatePath(sourcePath, appId);
            const validatedDest = this.validatePath(destPath, appId);
            
            // Check source exists and is file
            const sourceStats = await fs.stat(validatedSource);
            if (!sourceStats.isFile()) {
                throw new Error('Source is not a file');
            }
            
            // Check destination doesn't exist unless overwrite is true
            if (!overwrite) {
                try {
                    await fs.access(validatedDest);
                    throw new Error('Destination file already exists');
                } catch (error) {
                    // File doesn't exist, that's good
                }
            }
            
            // Check file size
            if (sourceStats.size > this.config.maxFileSize) {
                throw new Error(`Source file too large: ${sourceStats.size} bytes`);
            }
            
            await fs.copyFile(validatedSource, validatedDest);
            
            const destStats = await fs.stat(validatedDest);
            
            return {
                sourcePath: validatedSource,
                destPath: validatedDest,
                size: destStats.size,
                copied: true
            };
            
        } catch (error) {
            throw new Error(`Copy file failed: ${error.message}`);
        }
    }
    
    // Move/rename file
    async moveFile(params, context) {
        try {
            const { sourcePath, destPath } = params;
            const { appId } = context;
            
            const validatedSource = this.validatePath(sourcePath, appId);
            const validatedDest = this.validatePath(destPath, appId);
            
            // Check source exists
            const sourceStats = await fs.stat(validatedSource);
            
            await fs.rename(validatedSource, validatedDest);
            
            return {
                sourcePath: validatedSource,
                destPath: validatedDest,
                size: sourceStats.size,
                moved: true
            };
            
        } catch (error) {
            throw new Error(`Move file failed: ${error.message}`);
        }
    }
    
    // Watch file/directory for changes
    async watchPath(params, context) {
        try {
            const { filePath, events = ['change', 'rename'] } = params;
            const { appId, sessionId } = context;
            
            const validatedPath = this.validatePath(filePath, appId);
            
            // This is a simplified implementation
            // In a real system, you'd maintain watchers and send events via WebSocket
            
            const watcherId = crypto.randomUUID();
            
            // Store watcher info (in real implementation, you'd use fs.watch)
            return {
                watcherId,
                path: validatedPath,
                events,
                active: true,
                message: 'File watching started (simplified implementation)'
            };
            
        } catch (error) {
            throw new Error(`Watch path failed: ${error.message}`);
        }
    }
    
    // Get allowed file extensions
    async getAllowedExtensions() {
        return {
            allowed: this.config.allowedExtensions,
            blocked: this.config.blockedExtensions
        };
    }
    
    // Get sandbox info
    async getSandboxInfo(params, context) {
        const { appId } = context;
        const sandbox = this.sandboxRoots.get(appId);
        
        if (!sandbox) {
            throw new Error(`No sandbox found for app: ${appId}`);
        }
        
        return {
            appId,
            sandboxRoot: sandbox.root,
            allowedPaths: sandbox.allowedPaths,
            createdAt: sandbox.createdAt,
            maxFileSize: this.config.maxFileSize,
            allowedExtensions: this.config.allowedExtensions
        };
    }
    
    // Cleanup sandbox
    async cleanupSandbox(params, context) {
        try {
            const { appId } = context;
            const sandbox = this.sandboxRoots.get(appId);
            
            if (!sandbox) {
                return { message: 'No sandbox to cleanup' };
            }
            
            // Remove sandbox directory
            await fs.rm(sandbox.root, { recursive: true, force: true });
            
            // Remove from memory
            this.sandboxRoots.delete(appId);
            
            return {
                appId,
                sandboxRoot: sandbox.root,
                cleaned: true
            };
            
        } catch (error) {
            throw new Error(`Cleanup sandbox failed: ${error.message}`);
        }
    }
}

module.exports = FilesystemProtocol;