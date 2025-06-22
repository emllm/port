// modules/mcp-bridge/protocols/storage.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { ProtocolHandler } = require('../server');

class StorageProtocol extends ProtocolHandler {
    constructor(config = {}) {
        super(config);
        
        this.name = 'storage';
        this.version = '1.0.0';
        this.description = 'Local storage operations with quota management';
        
        this.config = {
            maxQuota: 100 * 1024 * 1024, // 100MB default per app
            maxKeyLength: 1024,
            maxValueSize: 10 * 1024 * 1024, // 10MB per value
            compressionThreshold: 1024, // Compress values > 1KB
            ...config
        };
        
        // App storage tracking
        this.appStorages = new Map(); // appId -> storage data
        this.quotaUsage = new Map(); // appId -> bytes used
        
        this.initializeStorageSystem();
    }
    
    async initializeStorageSystem() {
        try {
            const storageRoot = path.join(this.config.storagePath, 'app-storage');
            await fs.mkdir(storageRoot, { recursive: true });
            
            // Load existing storage data
            await this.loadExistingStorages();
            
            this.logger('info', 'Storage protocol initialized', {
                storageRoot,
                maxQuota: this.config.maxQuota,
                loadedApps: this.appStorages.size
            });
            
        } catch (error) {
            this.logger('error', 'Failed to initialize storage system', { error: error.message });
        }
    }
    
    async loadExistingStorages() {
        const storageRoot = path.join(this.config.storagePath, 'app-storage');
        
        try {
            const apps = await fs.readdir(storageRoot);
            
            for (const appId of apps) {
                const appStoragePath = path.join(storageRoot, appId);
                const statsPath = path.join(appStoragePath, 'stats.json');
                
                try {
                    if (await this.fileExists(statsPath)) {
                        const statsData = await fs.readFile(statsPath, 'utf8');
                        const stats = JSON.parse(statsData);
                        
                        this.quotaUsage.set(appId, stats.bytesUsed || 0);
                        this.appStorages.set(appId, new Map());
                        
                        // Load storage data
                        const dataPath = path.join(appStoragePath, 'data.json');
                        if (await this.fileExists(dataPath)) {
                            const storageData = await fs.readFile(dataPath, 'utf8');
                            const data = JSON.parse(storageData);
                            
                            const appStorage = new Map();
                            for (const [key, value] of Object.entries(data)) {
                                appStorage.set(key, value);
                            }
                            this.appStorages.set(appId, appStorage);
                        }
                    }
                } catch (error) {
                    this.logger('warn', `Failed to load storage for app ${appId}`, { error: error.message });
                }
            }
            
        } catch (error) {
            // Storage root doesn't exist yet, that's fine
        }
    }
    
    // Get storage item
    async getItem(params, context) {
        try {
            const { key } = params;
            const { appId } = context;
            
            this.validateKey(key);
            
            const appStorage = this.getAppStorage(appId);
            const value = appStorage.get(key);
            
            if (value !== undefined) {
                // Update access time
                await this.updateAccessTime(appId, key);
                
                return {
                    key,
                    value: this.deserializeValue(value),
                    exists: true
                };
            } else {
                return {
                    key,
                    value: null,
                    exists: false
                };
            }
            
        } catch (error) {
            throw new Error(`Get item failed: ${error.message}`);
        }
    }
    
    // Set storage item
    async setItem(params, context) {
        try {
            const { key, value } = params;
            const { appId } = context;
            
            this.validateKey(key);
            this.validateValue(value);
            
            const serializedValue = this.serializeValue(value);
            const valueSize = Buffer.byteLength(JSON.stringify(serializedValue), 'utf8');
            
            // Check quota
            await this.checkQuota(appId, key, valueSize);
            
            const appStorage = this.getAppStorage(appId);
            const oldValue = appStorage.get(key);
            const oldSize = oldValue ? Buffer.byteLength(JSON.stringify(oldValue), 'utf8') : 0;
            
            // Update storage
            appStorage.set(key, serializedValue);
            
            // Update quota usage
            const currentUsage = this.quotaUsage.get(appId) || 0;
            const newUsage = currentUsage - oldSize + valueSize;
            this.quotaUsage.set(appId, newUsage);
            
            // Persist to disk
            await this.persistAppStorage(appId);
            
            return {
                key,
                success: true,
                bytesUsed: valueSize,
                totalBytesUsed: newUsage
            };
            
        } catch (error) {
            throw new Error(`Set item failed: ${error.message}`);
        }
    }
    
    // Remove storage item
    async removeItem(params, context) {
        try {
            const { key } = params;
            const { appId } = context;
            
            this.validateKey(key);
            
            const appStorage = this.getAppStorage(appId);
            const oldValue = appStorage.get(key);
            
            if (oldValue !== undefined) {
                const oldSize = Buffer.byteLength(JSON.stringify(oldValue), 'utf8');
                
                appStorage.delete(key);
                
                // Update quota usage
                const currentUsage = this.quotaUsage.get(appId) || 0;
                const newUsage = Math.max(0, currentUsage - oldSize);
                this.quotaUsage.set(appId, newUsage);
                
                // Persist to disk
                await this.persistAppStorage(appId);
                
                return {
                    key,
                    removed: true,
                    bytesFreed: oldSize,
                    totalBytesUsed: newUsage
                };
            } else {
                return {
                    key,
                    removed: false,
                    reason: 'Key not found'
                };
            }
            
        } catch (error) {
            throw new Error(`Remove item failed: ${error.message}`);
        }
    }
    
    // Clear all storage for app
    async clear(params, context) {
        try {
            const { appId } = context;
            
            const appStorage = this.getAppStorage(appId);
            const itemCount = appStorage.size;
            const bytesFreed = this.quotaUsage.get(appId) || 0;
            
            appStorage.clear();
            this.quotaUsage.set(appId, 0);
            
            // Persist to disk
            await this.persistAppStorage(appId);
            
            return {
                cleared: true,
                itemsRemoved: itemCount,
                bytesFreed,
                totalBytesUsed: 0
            };
            
        } catch (error) {
            throw new Error(`Clear storage failed: ${error.message}`);
        }
    }
    
    // Get all keys
    async keys(params, context) {
        try {
            const { appId } = context;
            
            const appStorage = this.getAppStorage(appId);
            const keys = Array.from(appStorage.keys());
            
            return {
                keys,
                count: keys.length
            };
            
        } catch (error) {
            throw new Error(`Get keys failed: ${error.message}`);
        }
    }
    
    // Get storage info
    async getInfo(params, context) {
        try {
            const { appId } = context;
            
            const appStorage = this.getAppStorage(appId);
            const bytesUsed = this.quotaUsage.get(appId) || 0;
            const itemCount = appStorage.size;
            
            return {
                appId,
                itemCount,
                bytesUsed,
                maxQuota: this.config.maxQuota,
                bytesRemaining: Math.max(0, this.config.maxQuota - bytesUsed),
                quotaExceeded: bytesUsed > this.config.maxQuota,
                usagePercentage: Math.round((bytesUsed / this.config.maxQuota) * 100)
            };
            
        } catch (error) {
            throw new Error(`Get storage info failed: ${error.message}`);
        }
    }
    
    // Search storage items
    async search(params, context) {
        try {
            const { query, keyPattern, limit = 100 } = params;
            const { appId } = context;
            
            const appStorage = this.getAppStorage(appId);
            const results = [];
            
            for (const [key, value] of appStorage.entries()) {
                if (results.length >= limit) break;
                
                let matches = false;
                
                // Check key pattern
                if (keyPattern) {
                    const regex = new RegExp(keyPattern, 'i');
                    if (regex.test(key)) matches = true;
                }
                
                // Check value content
                if (query && !matches) {
                    const deserializedValue = this.deserializeValue(value);
                    const valueStr = typeof deserializedValue === 'string' 
                        ? deserializedValue 
                        : JSON.stringify(deserializedValue);
                    
                    if (valueStr.toLowerCase().includes(query.toLowerCase())) {
                        matches = true;
                    }
                }
                
                if (matches) {
                    results.push({
                        key,
                        value: this.deserializeValue(value),
                        size: Buffer.byteLength(JSON.stringify(value), 'utf8')
                    });
                }
            }
            
            return {
                results,
                count: results.length,
                hasMore: appStorage.size > limit
            };
            
        } catch (error) {
            throw new Error(`Search storage failed: ${error.message}`);
        }
    }
    
    // Export storage data
    async export(params, context) {
        try {
            const { format = 'json' } = params;
            const { appId } = context;
            
            const appStorage = this.getAppStorage(appId);
            const data = {};
            
            for (const [key, value] of appStorage.entries()) {
                data[key] = this.deserializeValue(value);
            }
            
            const exportData = {
                appId,
                exportedAt: new Date().toISOString(),
                version: this.version,
                itemCount: Object.keys(data).length,
                data
            };
            
            if (format === 'json') {
                return {
                    format: 'json',
                    data: exportData,
                    size: Buffer.byteLength(JSON.stringify(exportData), 'utf8')
                };
            } else {
                throw new Error(`Unsupported export format: ${format}`);
            }
            
        } catch (error) {
            throw new Error(`Export storage failed: ${error.message}`);
        }
    }
    
    // Import storage data
    async import(params, context) {
        try {
            const { data, overwrite = false } = params;
            const { appId } = context;
            
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid import data');
            }
            
            const appStorage = this.getAppStorage(appId);
            let imported = 0;
            let skipped = 0;
            let errors = 0;
            
            for (const [key, value] of Object.entries(data.data || data)) {
                try {
                    // Check if key exists
                    if (!overwrite && appStorage.has(key)) {
                        skipped++;
                        continue;
                    }
                    
                    // Validate and set item
                    await this.setItem({ key, value }, context);
                    imported++;
                    
                } catch (error) {
                    this.logger('warn', `Failed to import key ${key}`, { error: error.message });
                    errors++;
                }
            }
            
            return {
                imported,
                skipped,
                errors,
                total: Object.keys(data.data || data).length
            };
            
        } catch (error) {
            throw new Error(`Import storage failed: ${error.message}`);
        }
    }
    
    // Get storage statistics
    async getStats(params, context) {
        try {
            const { appId } = context;
            
            const appStorage = this.getAppStorage(appId);
            const bytesUsed = this.quotaUsage.get(appId) || 0;
            
            // Calculate item size distribution
            const sizeDistribution = { small: 0, medium: 0, large: 0 };
            const itemSizes = [];
            
            for (const [key, value] of appStorage.entries()) {
                const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
                itemSizes.push(size);
                
                if (size < 1024) sizeDistribution.small++;
                else if (size < 10240) sizeDistribution.medium++;
                else sizeDistribution.large++;
            }
            
            // Calculate statistics
            const avgSize = itemSizes.length > 0 
                ? Math.round(itemSizes.reduce((a, b) => a + b, 0) / itemSizes.length)
                : 0;
            
            const maxSize = itemSizes.length > 0 ? Math.max(...itemSizes) : 0;
            const minSize = itemSizes.length > 0 ? Math.min(...itemSizes) : 0;
            
            return {
                appId,
                itemCount: appStorage.size,
                bytesUsed,
                averageItemSize: avgSize,
                largestItemSize: maxSize,
                smallestItemSize: minSize,
                sizeDistribution,
                quotaUsagePercentage: Math.round((bytesUsed / this.config.maxQuota) * 100)
            };
            
        } catch (error) {
            throw new Error(`Get storage stats failed: ${error.message}`);
        }
    }
    
    // Cleanup expired items (if TTL is implemented)
    async cleanup(params, context) {
        try {
            const { appId } = context;
            
            // For now, just compact storage by removing empty entries
            const appStorage = this.getAppStorage(appId);
            let cleaned = 0;
            
            for (const [key, value] of appStorage.entries()) {
                if (value === null || value === undefined || value === '') {
                    appStorage.delete(key);
                    cleaned++;
                }
            }
            
            if (cleaned > 0) {
                await this.persistAppStorage(appId);
                
                // Recalculate quota usage
                await this.recalculateQuotaUsage(appId);
            }
            
            return {
                itemsCleaned: cleaned,
                remainingItems: appStorage.size,
                bytesFreed: 0 // Would calculate actual bytes freed in real implementation
            };
            
        } catch (error) {
            throw new Error(`Cleanup storage failed: ${error.message}`);
        }
    }
    
    // Private helper methods
    
    getAppStorage(appId) {
        if (!this.appStorages.has(appId)) {
            this.appStorages.set(appId, new Map());
            this.quotaUsage.set(appId, 0);
        }
        return this.appStorages.get(appId);
    }
    
    validateKey(key) {
        if (typeof key !== 'string') {
            throw new Error('Key must be a string');
        }
        
        if (key.length === 0) {
            throw new Error('Key cannot be empty');
        }
        
        if (key.length > this.config.maxKeyLength) {
            throw new Error(`Key too long: ${key.length} > ${this.config.maxKeyLength}`);
        }
        
        // Check for invalid characters
        if (key.includes('\0') || key.includes('\n') || key.includes('\r')) {
            throw new Error('Key contains invalid characters');
        }
    }
    
    validateValue(value) {
        const serialized = JSON.stringify(value);
        const size = Buffer.byteLength(serialized, 'utf8');
        
        if (size > this.config.maxValueSize) {
            throw new Error(`Value too large: ${size} > ${this.config.maxValueSize}`);
        }
    }
    
    async checkQuota(appId, key, newValueSize) {
        const appStorage = this.getAppStorage(appId);
        const currentUsage = this.quotaUsage.get(appId) || 0;
        const oldValue = appStorage.get(key);
        const oldSize = oldValue ? Buffer.byteLength(JSON.stringify(oldValue), 'utf8') : 0;
        
        const projectedUsage = currentUsage - oldSize + newValueSize;
        
        if (projectedUsage > this.config.maxQuota) {
            throw new Error(
                `Quota exceeded: ${projectedUsage} > ${this.config.maxQuota} ` +
                `(would use ${Math.round((projectedUsage / this.config.maxQuota) * 100)}%)`
            );
        }
    }
    
    serializeValue(value) {
        const serialized = {
            type: typeof value,
            value: value,
            timestamp: Date.now()
        };
        
        // Compress large values
        if (JSON.stringify(serialized).length > this.config.compressionThreshold) {
            // In a real implementation, you might use zlib compression here
            serialized.compressed = false; // Placeholder
        }
        
        return serialized;
    }
    
    deserializeValue(serializedValue) {
        if (!serializedValue || typeof serializedValue !== 'object') {
            return serializedValue;
        }
        
        return serializedValue.value;
    }
    
    async updateAccessTime(appId, key) {
        // Update access time for analytics (optional)
        // This could be used for LRU cache eviction in the future
    }
    
    async persistAppStorage(appId) {
        try {
            const storageDir = path.join(this.config.storagePath, 'app-storage', appId);
            await fs.mkdir(storageDir, { recursive: true });
            
            const appStorage = this.getAppStorage(appId);
            const data = {};
            
            for (const [key, value] of appStorage.entries()) {
                data[key] = value;
            }
            
            // Write storage data
            const dataPath = path.join(storageDir, 'data.json');
            await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
            
            // Write statistics
            const statsPath = path.join(storageDir, 'stats.json');
            const stats = {
                appId,
                itemCount: appStorage.size,
                bytesUsed: this.quotaUsage.get(appId) || 0,
                lastUpdated: new Date().toISOString()
            };
            await fs.writeFile(statsPath, JSON.stringify(stats, null, 2));
            
        } catch (error) {
            this.logger('error', `Failed to persist storage for ${appId}`, { error: error.message });
            throw error;
        }
    }
    
    async recalculateQuotaUsage(appId) {
        const appStorage = this.getAppStorage(appId);
        let totalSize = 0;
        
        for (const [key, value] of appStorage.entries()) {
            totalSize += Buffer.byteLength(JSON.stringify(value), 'utf8');
        }
        
        this.quotaUsage.set(appId, totalSize);
        return totalSize;
    }
    
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
    
    // Get all apps with storage data
    async getAllAppsInfo() {
        const appsInfo = [];
        
        for (const [appId, storage] of this.appStorages.entries()) {
            const bytesUsed = this.quotaUsage.get(appId) || 0;
            
            appsInfo.push({
                appId,
                itemCount: storage.size,
                bytesUsed,
                quotaUsagePercentage: Math.round((bytesUsed / this.config.maxQuota) * 100)
            });
        }
        
        return appsInfo;
    }
}

module.exports = StorageProtocol;