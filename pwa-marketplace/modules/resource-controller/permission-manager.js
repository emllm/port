class PermissionManager {
    constructor(config) {
        this.config = config;
        this.permissions = new Map();
        this.initialize();
    }

    initialize() {
        // Load default permissions
        this.loadDefaultPermissions();

        // Load custom permissions from config
        if (this.config.permissionsFile) {
            try {
                const customPermissions = JSON.parse(
                    fs.readFileSync(this.config.permissionsFile, 'utf8')
                );
                this.mergePermissions(customPermissions);
            } catch (error) {
                console.error('Error loading custom permissions:', error);
            }
        }
    }

    loadDefaultPermissions() {
        // Default permissions for different types of applications
        const defaultPermissions = {
            'untrusted': {
                types: ['status'],
                resources: ['status'],
                limits: {
                    memory: '512MB',
                    cpu: '50%',
                    network: '100KB/s'
                }
            },
            'trusted': {
                types: ['status', 'install', 'uninstall'],
                resources: ['status', 'storage', 'network'],
                limits: {
                    memory: '1GB',
                    cpu: '80%',
                    network: '500KB/s'
                }
            },
            'enterprise': {
                types: ['status', 'install', 'uninstall', 'update'],
                resources: ['status', 'storage', 'network', 'system'],
                limits: {
                    memory: '2GB',
                    cpu: '100%',
                    network: '1MB/s'
                }
            }
        };

        Object.entries(defaultPermissions).forEach(([id, perm]) => {
            this.permissions.set(id, perm);
        });
    }

    mergePermissions(customPermissions) {
        Object.entries(customPermissions).forEach(([id, perm]) => {
            if (this.permissions.has(id)) {
                // Merge with existing permissions
                const existing = this.permissions.get(id);
                this.permissions.set(id, {
                    ...existing,
                    ...perm
                });
            } else {
                // Add new permissions
                this.permissions.set(id, perm);
            }
        });
    }

    validatePermission(id, type, resource) {
        const permission = this.permissions.get(id);
        if (!permission) {
            return false;
        }

        // Check if type is allowed
        if (!permission.types.includes(type)) {
            return false;
        }

        // Check if resource access is allowed
        if (!permission.resources.includes(resource)) {
            return false;
        }

        return true;
    }

    getLimits(id) {
        const permission = this.permissions.get(id);
        if (!permission) {
            return null;
        }

        return permission.limits;
    }

    addPermission(id, permission) {
        this.permissions.set(id, permission);
        this.savePermissions();
    }

    removePermission(id) {
        this.permissions.delete(id);
        this.savePermissions();
    }

    updatePermission(id, permission) {
        if (this.permissions.has(id)) {
            this.permissions.set(id, permission);
            this.savePermissions();
        }
    }

    savePermissions() {
        if (this.config.permissionsFile) {
            try {
                const permissions = Object.fromEntries(
                    Array.from(this.permissions.entries())
                );
                fs.writeFileSync(
                    this.config.permissionsFile,
                    JSON.stringify(permissions, null, 2)
                );
            } catch (error) {
                console.error('Error saving permissions:', error);
            }
        }
    }

    getPermission(id) {
        return this.permissions.get(id);
    }

    getAllPermissions() {
        return Array.from(this.permissions.entries());
    }

    checkResourceLimit(id, resource, value) {
        const limits = this.getLimits(id);
        if (!limits) {
            return false;
        }

        const limit = limits[resource];
        if (!limit) {
            return false;
        }

        // Parse limit value (e.g., '512MB', '100%')
        const [num, unit] = limit.split('');
        const limitValue = parseFloat(num);

        switch (unit) {
            case 'MB':
                return value <= limitValue * 1024 * 1024;
            case '%':
                return value <= limitValue;
            case 'KB/s':
                return value <= limitValue * 1024;
            case 'MB/s':
                return value <= limitValue * 1024 * 1024;
            default:
                return false;
        }
    }
}

module.exports = PermissionManager;
