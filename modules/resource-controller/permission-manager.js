const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

class PermissionManager extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            permissionsPath: config.permissionsPath || './storage/permissions',
            auditLogPath: config.auditLogPath || './storage/logs/permissions.log',
            defaultTimeout: 60000, // 1 minute timeout for permission requests
            autoGrantDuration: 300000, // 5 minutes for auto-grant memory
            maxPendingRequests: 10,
            ...config
        };
        
        // In-memory storage for active permissions and requests
        this.grantedPermissions = new Map(); // appId -> Set of permissions
        this.pendingRequests = new Map(); // requestId -> request details
        this.permissionHistory = new Map(); // appId -> permission history
        this.autoGrantCache = new Map(); // permission -> timestamp of last grant
        
        // Permission templates and rules
        this.permissionTemplates = new Map();
        this.riskLevels = new Map();
        
        this.initializeDefaultPermissions();
        this.loadStoredPermissions();
    }
    
    initializeDefaultPermissions() {
        // Define standard permission templates
        const permissions = {
            'filesystem.read': {
                name: 'Read Files',
                description: 'Read files and directories',
                riskLevel: 'low',
                category: 'filesystem',
                requiresPath: true,
                autoGrantable: true
            },
            'filesystem.write': {
                name: 'Write Files',
                description: 'Create and modify files',
                riskLevel: 'medium',
                category: 'filesystem',
                requiresPath: true,
                autoGrantable: false
            },
            'filesystem.delete': {
                name: 'Delete Files',
                description: 'Delete files and directories',
                riskLevel: 'high',
                category: 'filesystem',
                requiresPath: true,
                autoGrantable: false
            },
            'storage.read': {
                name: 'Read Local Storage',
                description: 'Read data from local storage',
                riskLevel: 'low',
                category: 'storage',
                autoGrantable: true
            },
            'storage.write': {
                name: 'Write Local Storage',
                description: 'Save data to local storage',
                riskLevel: 'low',
                category: 'storage',
                autoGrantable: true
            },
            'network.fetch': {
                name: 'Network Access',
                description: 'Make network requests',
                riskLevel: 'medium',
                category: 'network',
                requiresUrl: true,
                autoGrantable: false
            },
            'system.info': {
                name: 'System Information',
                description: 'Access basic system information',
                riskLevel: 'low',
                category: 'system',
                autoGrantable: true
            },
            'system.notifications': {
                name: 'Show Notifications',
                description: 'Display desktop notifications',
                riskLevel: 'low',
                category: 'system',
                autoGrantable: true
            },
            'system.clipboard': {
                name: 'Clipboard Access',
                description: 'Read from and write to clipboard',
                riskLevel: 'medium',
                category: 'system',
                autoGrantable: false
            }
        };
        
        for (const [key, permission] of Object.entries(permissions)) {
            this.permissionTemplates.set(key, permission);
            this.riskLevels.set(key, permission.riskLevel);
        }
    }
    
    async loadStoredPermissions() {
        try {
            await fs.mkdir(this.config.permissionsPath, { recursive: true });
            
            const permissionFiles = await fs.readdir(this.config.permissionsPath);
            
            for (const file of permissionFiles) {
                if (file.endsWith('.json')) {
                    const appId = file.replace('.json', '');
                    const filePath = path.join(this.config.permissionsPath, file);
                    
                    try {
                        const data = await fs.readFile(filePath, 'utf8');
                        const permissions = JSON.parse(data);
                        
                        this.grantedPermissions.set(appId, new Set(permissions.granted || []));
                        this.permissionHistory.set(appId, permissions.history || []);
                        
                    } catch (error) {
                        console.error(`Failed to load permissions for ${appId}:`, error);
                    }
                }
            }
            
            console.log(`Loaded permissions for ${this.grantedPermissions.size} apps`);
            
        } catch (error) {
            console.error('Failed to load stored permissions:', error);
        }
    }
    
    async savePermissions(appId) {
        try {
            const filePath = path.join(this.config.permissionsPath, `${appId}.json`);
            
            const data = {
                appId,
                granted: Array.from(this.grantedPermissions.get(appId) || []),
                history: this.permissionHistory.get(appId) || [],
                updatedAt: new Date().toISOString()
            };
            
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            
        } catch (error) {
            console.error(`Failed to save permissions for ${appId}:`, error);
        }
    }
    
    // Request permission from user
    async requestPermission(appId, permissionRequest) {
        const {
            permission,
            resource,
            reason,
            temporary = false,
            timeout = this.config.defaultTimeout
        } = permissionRequest;
        
        // Validate permission exists
        if (!this.permissionTemplates.has(permission)) {
            throw new Error(`Unknown permission: ${permission}`);
        }
        
        // Check if already granted
        if (this.hasPermission(appId, permission, resource)) {
            return {
                granted: true,
                permission,
                resource,
                source: 'already-granted'
            };
        }
        
        // Check auto-grant conditions
        if (this.canAutoGrant(permission, resource)) {
            const result = await this.grantPermission(appId, permission, resource, {
                temporary,
                reason,
                source: 'auto-granted'
            });
            
            return result;
        }
        
        // Check pending request limit
        if (this.pendingRequests.size >= this.config.maxPendingRequests) {
            throw new Error('Too many pending permission requests');
        }
        
        // Create permission request
        const requestId = crypto.randomUUID();
        const request = {
            id: requestId,
            appId,
            permission,
            resource,
            reason,
            temporary,
            template: this.permissionTemplates.get(permission),
            createdAt: new Date(),
            timeout: Date.now() + timeout
        };
        
        this.pendingRequests.set(requestId, request);
        
        // Emit request event for UI to handle
        this.emit('permissionRequest', request);
        
        // Set timeout
        const timeoutHandle = setTimeout(() => {
            this.handlePermissionTimeout(requestId);
        }, timeout);
        
        // Return promise that resolves when user responds
        return new Promise((resolve, reject) => {
            request.resolve = resolve;
            request.reject = reject;
            request.timeoutHandle = timeoutHandle;
        });
    }
    
    // Handle user response to permission request
    async respondToPermissionRequest(requestId, response) {
        const request = this.pendingRequests.get(requestId);
        if (!request) {
            throw new Error(`Permission request not found: ${requestId}`);
        }
        
        // Clear timeout
        if (request.timeoutHandle) {
            clearTimeout(request.timeoutHandle);
        }
        
        // Remove from pending
        this.pendingRequests.delete(requestId);
        
        try {
            if (response.granted) {
                // Grant permission
                const result = await this.grantPermission(
                    request.appId,
                    request.permission,
                    response.resource || request.resource,
                    {
                        temporary: request.temporary,
                        reason: request.reason,
                        source: 'user-granted',
                        userResponse: response
                    }
                );
                
                // Update auto-grant cache if user chose "remember"
                if (response.remember && this.canAutoGrant(request.permission)) {
                    this.autoGrantCache.set(request.permission, Date.now());
                }
                
                request.resolve(result);
                
            } else {
                // Permission denied
                await this.logPermissionEvent(request.appId, {
                    action: 'denied',
                    permission: request.permission,
                    resource: request.resource,
                    reason: response.reason || 'User denied',
                    source: 'user-denied'
                });
                
                const result = {
                    granted: false,
                    permission: request.permission,
                    resource: request.resource,
                    reason: response.reason || 'Permission denied by user',
                    source: 'user-denied'
                };
                
                request.resolve(result);
            }
            
        } catch (error) {
            request.reject(error);
        }
    }
    
    // Grant permission
    async grantPermission(appId, permission, resource, options = {}) {
        const {
            temporary = false,
            expiresAt,
            reason,
            source = 'manual'
        } = options;
        
        // Initialize app permissions if needed
        if (!this.grantedPermissions.has(appId)) {
            this.grantedPermissions.set(appId, new Set());
            this.permissionHistory.set(appId, []);
        }
        
        // Create permission key
        const permissionKey = resource ? `${permission}:${resource}` : permission;
        
        // Add to granted permissions
        const appPermissions = this.grantedPermissions.get(appId);
        appPermissions.add(permissionKey);
        
        // Log the grant
        const logEntry = {
            action: 'granted',
            permission,
            resource,
            temporary,
            expiresAt,
            reason,
            source,
            grantedAt: new Date().toISOString()
        };
        
        const history = this.permissionHistory.get(appId);
        history.push(logEntry);
        
        // Save to disk
        await this.savePermissions(appId);
        await this.logPermissionEvent(appId, logEntry);
        
        // Set expiration if temporary
        if (temporary && expiresAt) {
            setTimeout(() => {
                this.revokePermission(appId, permission, resource);
            }, new Date(expiresAt).getTime() - Date.now());
        }
        
        // Emit grant event
        this.emit('permissionGranted', {
            appId,
            permission,
            resource,
            temporary,
            source
        });
        
        return {
            granted: true,
            permission,
            resource,
            temporary,
            expiresAt,
            source
        };
    }
    
    // Revoke permission
    async revokePermission(appId, permission, resource) {
        const appPermissions = this.grantedPermissions.get(appId);
        if (!appPermissions) {
            return false;
        }
        
        const permissionKey = resource ? `${permission}:${resource}` : permission;
        const wasRevoked = appPermissions.delete(permissionKey);
        
        if (wasRevoked) {
            // Log the revocation
            const logEntry = {
                action: 'revoked',
                permission,
                resource,
                revokedAt: new Date().toISOString()
            };
            
            const history = this.permissionHistory.get(appId);
            history.push(logEntry);
            
            // Save to disk
            await this.savePermissions(appId);
            await this.logPermissionEvent(appId, logEntry);
            
            // Emit revoke event
            this.emit('permissionRevoked', {
                appId,
                permission,
                resource
            });
        }
        
        return wasRevoked;
    }
    
    // Check if app has permission
    hasPermission(appId, permission, resource = null) {
        const appPermissions = this.grantedPermissions.get(appId);
        if (!appPermissions) {
            return false;
        }
        
        // Check specific permission with resource
        if (resource) {
            const specificKey = `${permission}:${resource}`;
            if (appPermissions.has(specificKey)) {
                return true;
            }
        }
        
        // Check general permission
        if (appPermissions.has(permission)) {
            return true;
        }
        
        // Check wildcard permissions
        const category = permission.split('.')[0];
        if (appPermissions.has(`${category}.*`)) {
            return true;
        }
        
        return false;
    }
    
    // Check if permission can be auto-granted
    canAutoGrant(permission, resource = null) {
        const template = this.permissionTemplates.get(permission);
        if (!template || !template.autoGrantable) {
            return false;
        }
        
        // Check auto-grant cache
        const cacheKey = resource ? `${permission}:${resource}` : permission;
        const lastGrant = this.autoGrantCache.get(cacheKey);
        
        if (lastGrant && (Date.now() - lastGrant) < this.config.autoGrantDuration) {
            return true;
        }
        
        // Low-risk permissions can be auto-granted
        return template.riskLevel === 'low';
    }
    
    // Handle permission request timeout
    handlePermissionTimeout(requestId) {
        const request = this.pendingRequests.get(requestId);
        if (request) {
            this.pendingRequests.delete(requestId);
            
            const result = {
                granted: false,
                permission: request.permission,
                resource: request.resource,
                reason: 'Request timed out',
                source: 'timeout'
            };
            
            request.resolve(result);
            
            this.logPermissionEvent(request.appId, {
                action: 'timeout',
                permission: request.permission,
                resource: request.resource,
                reason: 'Request timed out'
            });
        }
    }
    
    // Get all permissions for an app
    getAppPermissions(appId) {
        const permissions = this.grantedPermissions.get(appId) || new Set();
        const history = this.permissionHistory.get(appId) || [];
        
        return {
            appId,
            granted: Array.from(permissions),
            history: history.slice(-50), // Last 50 events
            grantedCount: permissions.size,
            lastActivity: history.length > 0 ? history[history.length - 1].grantedAt : null
        };
    }
    
    // Get all apps with permissions
    getAllAppPermissions() {
        const result = {};
        
        for (const appId of this.grantedPermissions.keys()) {
            result[appId] = this.getAppPermissions(appId);
        }
        
        return result;
    }
    
    // Get pending permission requests
    getPendingRequests() {
        return Array.from(this.pendingRequests.values()).map(request => ({
            id: request.id,
            appId: request.appId,
            permission: request.permission,
            resource: request.resource,
            reason: request.reason,
            template: request.template,
            createdAt: request.createdAt,
            expiresAt: new Date(request.timeout)
        }));
    }
    
    // Log permission events
    async logPermissionEvent(appId, event) {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                appId,
                ...event
            };
            
            const logLine = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(this.config.auditLogPath, logLine);
            
        } catch (error) {
            console.error('Failed to log permission event:', error);
        }
    }
    
    // Clean up expired and old permissions
    async cleanup() {
        const now = Date.now();
        
        // Clean auto-grant cache
        for (const [key, timestamp] of this.autoGrantCache) {
            if (now - timestamp > this.config.autoGrantDuration) {
                this.autoGrantCache.delete(key);
            }
        }
        
        // Clean up timed-out pending requests
        for (const [requestId, request] of this.pendingRequests) {
            if (now > request.timeout) {
                this.handlePermissionTimeout(requestId);
            }
        }
        
        console.log('Permission manager cleanup completed');
    }
    
    // Revoke all permissions for an app
    async revokeAllPermissions(appId) {
        const appPermissions = this.grantedPermissions.get(appId);
        if (!appPermissions) {
            return [];
        }
        
        const revokedPermissions = Array.from(appPermissions);
        appPermissions.clear();
        
        // Log the mass revocation
        const logEntry = {
            action: 'revoked-all',
            permissions: revokedPermissions,
            revokedAt: new Date().toISOString()
        };
        
        const history = this.permissionHistory.get(appId);
        history.push(logEntry);
        
        // Save to disk
        await this.savePermissions(appId);
        await this.logPermissionEvent(appId, logEntry);
        
        // Emit revoke event
        this.emit('allPermissionsRevoked', { appId, permissions: revokedPermissions });
        
        return revokedPermissions;
    }
    
    // Export permissions for backup
    async exportPermissions() {
        const data = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            apps: {}
        };
        
        for (const [appId, permissions] of this.grantedPermissions) {
            data.apps[appId] = {
                permissions: Array.from(permissions),
                history: this.permissionHistory.get(appId) || []
            };
        }
        
        return data;
    }
    
    // Import permissions from backup
    async importPermissions(data) {
        if (!data.apps) {
            throw new Error('Invalid permission data');
        }
        
        for (const [appId, appData] of Object.entries(data.apps)) {
            this.grantedPermissions.set(appId, new Set(appData.permissions || []));
            this.permissionHistory.set(appId, appData.history || []);
            
            // Save to disk
            await this.savePermissions(appId);
        }
        
        console.log(`Imported permissions for ${Object.keys(data.apps).length} apps`);
    }
    
    // Get permission statistics
    getStatistics() {
        const stats = {
            totalApps: this.grantedPermissions.size,
            totalPermissions: 0,
            pendingRequests: this.pendingRequests.size,
            autoGrantCacheSize: this.autoGrantCache.size,
            permissionsByCategory: {},
            riskLevelCounts: {}
        };
        
        // Count permissions by category and risk level
        for (const permissions of this.grantedPermissions.values()) {
            stats.totalPermissions += permissions.size;
            
            for (const permission of permissions) {
                const [category] = permission.split('.');
                stats.permissionsByCategory[category] = (stats.permissionsByCategory[category] || 0) + 1;
                
                const template = this.permissionTemplates.get(permission.split(':')[0]);
                if (template) {
                    const risk = template.riskLevel;
                    stats.riskLevelCounts[risk] = (stats.riskLevelCounts[risk] || 0) + 1;
                }
            }
        }
        
        return stats;
    }
}

// Start cleanup interval
setInterval(() => {
    // This would be called on the singleton instance
}, 300000); // Every 5 minutes

module.exports = PermissionManager;