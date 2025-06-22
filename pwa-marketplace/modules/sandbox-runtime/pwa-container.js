const { JSDOM } = require('jsdom');
const { window } = new JSDOM('');
const { document } = window;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SANDBOX_CONFIG = {
    maxMemory: '512MB',
    maxCpu: '50%',
    maxNetwork: '100KB/s',
    allowedProtocols: ['https:', 'wss:'],
    allowedDomains: [],
    allowLocalStorage: false,
    allowIndexedDB: false,
    allowWebSQL: false,
    allowServiceWorkers: false,
    allowNotifications: false,
    allowGeolocation: false,
    allowCamera: false,
    allowMicrophone: false
};

class PWAContainer {
    constructor(config) {
        this.config = {
            ...SANDBOX_CONFIG,
            ...config
        };
        this.containers = new Map();
        this.initialize();
    }

    initialize() {
        // Create sandbox directory if it doesn't exist
        if (this.config.sandboxDir) {
            try {
                fs.mkdirSync(this.config.sandboxDir, { recursive: true });
            } catch (error) {
                console.error('Error creating sandbox directory:', error);
            }
        }
    }

    async create(pwaConfig) {
        try {
            // Validate PWA config
            if (!pwaConfig || !pwaConfig.url) {
                throw new Error('Invalid PWA configuration');
            }

            // Create unique container ID
            const containerId = uuidv4();

            // Create sandboxed JSDOM instance
            const { window } = new JSDOM('', {
                url: pwaConfig.url,
                pretendToBeVisual: true,
                resources: 'usable'
            });

            // Apply security policies
            this.applySecurityPolicies(window);

            // Create container object
            const container = {
                id: containerId,
                window,
                config: pwaConfig,
                created: new Date().toISOString(),
                status: 'running',
                resources: {
                    memory: 0,
                    cpu: 0,
                    network: 0
                }
            };

            // Monitor resource usage
            this.monitorResources(container);

            // Store container
            this.containers.set(containerId, container);

            return container;
        } catch (error) {
            console.error('Error creating PWA container:', error);
            throw error;
        }
    }

    async destroy(containerId) {
        try {
            const container = this.containers.get(containerId);
            if (!container) {
                throw new Error('Container not found');
            }

            // Clean up resources
            container.window.close();
            this.containers.delete(containerId);

            // Clean up sandbox directory
            if (this.config.sandboxDir) {
                const containerDir = path.join(this.config.sandboxDir, containerId);
                if (fs.existsSync(containerDir)) {
                    this.removeDirectory(containerDir);
                }
            }

            return { status: 'success', message: 'Container destroyed' };
        } catch (error) {
            console.error('Error destroying container:', error);
            throw error;
        }
    }

    async execute(containerId, code) {
        try {
            const container = this.containers.get(containerId);
            if (!container) {
                throw new Error('Container not found');
            }

            // Validate code
            if (!this.validateCode(code)) {
                throw new Error('Invalid code');
            }

            // Execute code in sandbox
            return container.window.eval(code);
        } catch (error) {
            console.error('Error executing code:', error);
            throw error;
        }
    }

    applySecurityPolicies(window) {
        // Restrict network access
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const [url] = args;
            const parsedUrl = new URL(url);

            // Check protocol
            if (!this.config.allowedProtocols.includes(parsedUrl.protocol)) {
                throw new Error('Protocol not allowed');
            }

            // Check domain
            if (this.config.allowedDomains.length > 0 && 
                !this.config.allowedDomains.includes(parsedUrl.hostname)) {
                throw new Error('Domain not allowed');
            }

            return originalFetch.apply(window, args);
        };

        // Restrict storage
        if (!this.config.allowLocalStorage) {
            window.localStorage = new Proxy(window.localStorage, {
                get: () => {
                    throw new Error('LocalStorage is disabled');
                }
            });
        }

        if (!this.config.allowIndexedDB) {
            window.indexedDB = new Proxy(window.indexedDB, {
                get: () => {
                    throw new Error('IndexedDB is disabled');
                }
            });
        }

        // Restrict APIs
        if (!this.config.allowNotifications) {
            window.Notification = new Proxy(window.Notification, {
                get: () => {
                    throw new Error('Notifications are disabled');
                }
            });
        }

        if (!this.config.allowGeolocation) {
            window.navigator.geolocation = new Proxy(window.navigator.geolocation, {
                get: () => {
                    throw new Error('Geolocation is disabled');
                }
            });
        }

        if (!this.config.allowCamera) {
            window.navigator.mediaDevices = new Proxy(window.navigator.mediaDevices, {
                get: () => {
                    throw new Error('Camera access is disabled');
                }
            });
        }

        if (!this.config.allowMicrophone) {
            window.navigator.mediaDevices = new Proxy(window.navigator.mediaDevices, {
                get: () => {
                    throw new Error('Microphone access is disabled');
                }
            });
        }
    }

    validateCode(code) {
        // Basic code validation
        if (!code) return false;
        
        // Check for dangerous patterns
        const dangerousPatterns = [
            /eval\(/i,
            /constructor\(/i,
            /window\./i,
            /document\./i,
            /localStorage\./i,
            /sessionStorage\./i,
            /indexedDB\./i
        ];

        return !dangerousPatterns.some(pattern => pattern.test(code));
    }

    monitorResources(container) {
        // TODO: Implement actual resource monitoring
        // This is a placeholder for now
        setInterval(() => {
            if (this.containers.has(container.id)) {
                const resources = {
                    memory: Math.random() * 100,
                    cpu: Math.random() * 100,
                    network: Math.random() * 100
                };

                container.resources = resources;
            }
        }, 1000);
    }

    removeDirectory(dir) {
        try {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                if (stats.isDirectory()) {
                    this.removeDirectory(filePath);
                } else {
                    fs.unlinkSync(filePath);
                }
            });
            fs.rmdirSync(dir);
        } catch (error) {
            console.error('Error removing directory:', error);
            throw error;
        }
    }
}

module.exports = PWAContainer;
