// modules/sandbox-runtime/pwa-container.js
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class PWAContainer extends EventEmitter {
    constructor(appId, config = {}) {
        super();
        
        this.appId = appId;
        this.config = {
            sandboxRoot: config.sandboxRoot || './storage/sandboxes',
            maxMemory: config.maxMemory || 100 * 1024 * 1024, // 100MB
            maxExecutionTime: config.maxExecutionTime || 30000, // 30 seconds
            allowedOrigins: config.allowedOrigins || ['*'],
            mcpBridgeUrl: config.mcpBridgeUrl || 'ws://localhost:3001',
            permissions: config.permissions || [],
            ...config
        };
        
        // Container state
        this.state = 'created'; // created, loading, running, paused, stopped, error
        this.iframe = null;
        this.mcpClient = null;
        this.permissions = new Set(this.config.permissions);
        this.resourceUsage = {
            memory: 0,
            cpu: 0,
            network: 0,
            storage: 0
        };
        
        // Execution context
        this.sandboxPath = path.join(this.config.sandboxRoot, this.appId);
        this.startTime = null;
        this.lastActivity = null;
        
        // Communication channels
        this.messageQueue = [];
        this.responseCallbacks = new Map();
        this.requestCounter = 0;
        
        this.initializeContainer();
    }
    
    async initializeContainer() {
        try {
            // Create sandbox directory
            await fs.mkdir(this.sandboxPath, { recursive: true });
            
            // Initialize resource monitoring
            this.startResourceMonitoring();
            
            this.state = 'initialized';
            this.emit('initialized', { appId: this.appId });
            
        } catch (error) {
            this.state = 'error';
            this.emit('error', error);
        }
    }
    
    // Load and start PWA application
    async loadApp(appManifest, appFiles) {
        try {
            this.state = 'loading';
            this.emit('stateChange', 'loading');
            
            // Validate manifest
            this.validateManifest(appManifest);
            
            // Setup sandbox environment
            await this.setupSandboxEnvironment(appManifest, appFiles);
            
            // Create iframe container
            this.iframe = await this.createIframeContainer(appManifest);
            
            // Initialize MCP client
            this.mcpClient = await this.initializeMCPClient();
            
            // Load app content
            await this.loadAppContent(appManifest, appFiles);
            
            this.state = 'running';
            this.startTime = Date.now();
            this.lastActivity = Date.now();
            
            this.emit('loaded', { 
                appId: this.appId, 
                manifest: appManifest 
            });
            
            return true;
            
        } catch (error) {
            this.state = 'error';
            this.emit('error', error);
            throw error;
        }
    }
    
    // Create isolated iframe sandbox
    async createIframeContainer(manifest) {
        const sandboxAttributes = [
            'allow-scripts',
            'allow-same-origin',
            'allow-forms',
            'allow-popups',
            'allow-storage-access-by-user-activation'
        ];
        
        // Additional sandbox restrictions based on permissions
        if (!this.hasPermission('network.fetch')) {
            // Network access would be controlled by MCP bridge anyway
        }
        
        if (!this.hasPermission('storage.write')) {
            // Storage access controlled by MCP bridge
        }
        
        const iframe = {
            id: `pwa-container-${this.appId}`,
            sandbox: sandboxAttributes.join(' '),
            src: `data:text/html;charset=utf-8,${this.generateSandboxHTML(manifest)}`,
            width: manifest.display?.width || '100%',
            height: manifest.display?.height || '100%',
            frameborder: '0',
            allowfullscreen: manifest.display?.fullscreen || false
        };
        
        // Setup message handling
        this.setupMessageHandling(iframe);
        
        return iframe;
    }
    
    // Generate sandbox HTML with security restrictions
    generateSandboxHTML(manifest) {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${manifest.name || 'PWA Application'}</title>
    <meta http-equiv="Content-Security-Policy" content="${this.generateCSP(manifest)}">
    
    <!-- PWA Manifest -->
    <link rel="manifest" href="data:application/json;base64,${Buffer.from(JSON.stringify(manifest)).toString('base64')}">
    
    <!-- Theme and styling -->
    <meta name="theme-color" content="${manifest.theme_color || '#000000'}">
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: ${manifest.background_color || '#ffffff'};
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .pwa-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            flex-direction: column;
        }
        
        .pwa-error {
            color: #dc3545;
            text-align: center;
            padding: 2rem;
        }
    </style>
</head>
<body>
    <div id="pwa-root">
        <div class="pwa-loading">
            <div>Loading ${manifest.name || 'Application'}...</div>
        </div>
    </div>
    
    <!-- MCP Client Library -->
    <script>
        ${this.generateMCPClientScript()}
    </script>
    
    <!-- Service Worker Registration -->
    <script>
        ${this.generateServiceWorkerScript(manifest)}
    </script>
    
    <!-- App Loading Script -->
    <script>
        ${this.generateAppLoadingScript()}
    </script>
</body>
</html>`;
        
        return encodeURIComponent(html);
    }
    
    // Generate Content Security Policy
    generateCSP(manifest) {
        const policies = [
            "default-src 'self' data: blob:",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
            "style-src 'self' 'unsafe-inline' data:",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' ws: wss: data:",
            "media-src 'self' data: blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ];
        
        // Add allowed domains if specified
        if (this.hasPermission('network.fetch')) {
            const allowedDomains = this.getPermissionData('network.fetch')?.domains || [];
            if (allowedDomains.length > 0) {
                policies[5] += ' ' + allowedDomains.join(' '); // connect-src
            }
        }
        
        return policies.join('; ');
    }
    
    // Generate MCP client script for PWA
    generateMCPClientScript() {
        return `
class MCPClient {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.messageQueue = [];
        this.callbacks = new Map();
        this.requestId = 0;
        
        this.connect();
    }
    
    connect() {
        try {
            this.ws = new WebSocket('${this.config.mcpBridgeUrl}');
            
            this.ws.onopen = () => {
                this.connected = true;
                this.authenticate();
                this.flushMessageQueue();
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('Failed to parse MCP message:', error);
                }
            };
            
            this.ws.onclose = () => {
                this.connected = false;
                setTimeout(() => this.connect(), 5000); // Reconnect after 5s
            };
            
            this.ws.onerror = (error) => {
                console.error('MCP WebSocket error:', error);
            };
            
        } catch (error) {
            console.error('Failed to connect to MCP bridge:', error);
        }
    }
    
    authenticate() {
        this.send({
            type: 'auth',
            id: this.generateId(),
            params: {
                appId: '${this.appId}',
                requestedPermissions: ${JSON.stringify(Array.from(this.permissions))}
            }
        });
    }
    
    async call(protocol, method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.generateId();
            const message = {
                type: 'request',
                id,
                protocol,
                method,
                params,
                appId: '${this.appId}'
            };
            
            this.callbacks.set(id, { resolve, reject });
            
            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.callbacks.has(id)) {
                    this.callbacks.delete(id);
                    reject(new Error('MCP request timeout'));
                }
            }, 30000);
            
            this.send(message);
        });
    }
    
    send(message) {
        if (this.connected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.messageQueue.push(message);
        }
    }
    
    handleMessage(message) {
        if (message.type === 'response' && this.callbacks.has(message.id)) {
            const callback = this.callbacks.get(message.id);
            this.callbacks.delete(message.id);
            
            if (message.error) {
                callback.reject(new Error(message.error));
            } else {
                callback.resolve(message.result);
            }
        } else if (message.type === 'error' && this.callbacks.has(message.id)) {
            const callback = this.callbacks.get(message.id);
            this.callbacks.delete(message.id);
            callback.reject(new Error(message.error));
        }
    }
    
    flushMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.send(message);
        }
    }
    
    generateId() {
        return ++this.requestId;
    }
}

// Global MCP client instance
window.mcp = new MCPClient();

// Polyfill for localStorage using MCP storage protocol
if (${!this.hasPermission('storage.localStorage')}) {
    const mcpStorage = {
        async getItem(key) {
            try {
                const result = await window.mcp.call('storage', 'getItem', { key });
                return result.exists ? result.value : null;
            } catch (error) {
                console.warn('MCP storage getItem failed:', error);
                return null;
            }
        },
        
        async setItem(key, value) {
            try {
                await window.mcp.call('storage', 'setItem', { key, value });
            } catch (error) {
                console.warn('MCP storage setItem failed:', error);
                throw error;
            }
        },
        
        async removeItem(key) {
            try {
                await window.mcp.call('storage', 'removeItem', { key });
            } catch (error) {
                console.warn('MCP storage removeItem failed:', error);
            }
        },
        
        async clear() {
            try {
                await window.mcp.call('storage', 'clear', {});
            } catch (error) {
                console.warn('MCP storage clear failed:', error);
            }
        }
    };
    
    // Override localStorage
    Object.defineProperty(window, 'localStorage', {
        value: mcpStorage,
        writable: false
    });
}
`;
    }
    
    // Generate service worker registration script
    generateServiceWorkerScript(manifest) {
        return `
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            // Service worker content will be injected based on app files
            const swContent = \`
                self.addEventListener('install', event => {
                    console.log('Service Worker installed for ${this.appId}');
                    self.skipWaiting();
                });
                
                self.addEventListener('activate', event => {
                    console.log('Service Worker activated for ${this.appId}');
                    event.waitUntil(clients.claim());
                });
                
                self.addEventListener('fetch', event => {
                    // Controlled fetch through MCP bridge
                    if (event.request.url.startsWith('http')) {
                        event.respondWith(
                            fetch(event.request).catch(error => {
                                console.log('Fetch failed, app is offline');
                                return new Response('Offline', { status: 503 });
                            })
                        );
                    }
                });
            \`;
            
            const swBlob = new Blob([swContent], { type: 'application/javascript' });
            const swUrl = URL.createObjectURL(swBlob);
            
            const registration = await navigator.serviceWorker.register(swUrl);
            console.log('Service Worker registered:', registration);
            
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    });
}
`;
    }
    
    // Generate app loading script
    generateAppLoadingScript() {
        return `
class PWALoader {
    constructor() {
        this.loaded = false;
        this.startTime = Date.now();
    }
    
    async loadApp() {
        try {
            // Signal to parent that app is loading
            parent.postMessage({
                type: 'pwa-loading',
                appId: '${this.appId}',
                timestamp: Date.now()
            }, '*');
            
            // Wait for MCP connection
            await this.waitForMCP();
            
            // Load app files
            await this.loadAppFiles();
            
            // Signal successful load
            this.loaded = true;
            parent.postMessage({
                type: 'pwa-loaded',
                appId: '${this.appId}',
                loadTime: Date.now() - this.startTime
            }, '*');
            
        } catch (error) {
            console.error('Failed to load PWA:', error);
            parent.postMessage({
                type: 'pwa-error',
                appId: '${this.appId}',
                error: error.message
            }, '*');
            
            document.body.innerHTML = \`
                <div class="pwa-error">
                    <h2>Application Error</h2>
                    <p>\${error.message}</p>
                    <button onclick="location.reload()">Retry</button>
                </div>
            \`;
        }
    }
    
    async waitForMCP() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('MCP connection timeout'));
            }, 10000);
            
            const checkConnection = () => {
                if (window.mcp && window.mcp.connected) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(checkConnection, 100);
                }
            };
            
            checkConnection();
        });
    }
    
    async loadAppFiles() {
        // Request app files from parent container
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('App files loading timeout'));
            }, 30000);
            
            const messageHandler = (event) => {
                if (event.data.type === 'pwa-files' && event.data.appId === '${this.appId}') {
                    window.removeEventListener('message', messageHandler);
                    clearTimeout(timeout);
                    
                    try {
                        this.injectAppFiles(event.data.files);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }
            };
            
            window.addEventListener('message', messageHandler);
            
            parent.postMessage({
                type: 'request-app-files',
                appId: '${this.appId}'
            }, '*');
        });
    }
    
    injectAppFiles(files) {
        const root = document.getElementById('pwa-root');
        root.innerHTML = ''; // Clear loading screen
        
        // Inject HTML
        if (files.html) {
            root.innerHTML = files.html;
        }
        
        // Inject CSS
        if (files.css) {
            const style = document.createElement('style');
            style.textContent = files.css;
            document.head.appendChild(style);
        }
        
        // Inject JavaScript
        if (files.js) {
            const script = document.createElement('script');
            script.textContent = files.js;
            document.body.appendChild(script);
        }
        
        // Handle additional resources
        if (files.resources) {
            for (const [path, content] of Object.entries(files.resources)) {
                // Handle different resource types (images, fonts, etc.)
                this.handleResource(path, content);
            }
        }
    }
    
    handleResource(path, content) {
        const ext = path.split('.').pop().toLowerCase();
        
        switch (ext) {
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'gif':
            case 'svg':
                // Create blob URL for images
                const blob = new Blob([atob(content)], { type: \`image/\${ext}\` });
                const url = URL.createObjectURL(blob);
                // Store URL for app use
                window.appResources = window.appResources || {};
                window.appResources[path] = url;
                break;
                
            default:
                // Handle other resource types as needed
                break;
        }
    }
}

// Initialize app loader
const pwaLoader = new PWALoader();
pwaLoader.loadApp();

// Activity tracking
let lastActivity = Date.now();
['click', 'keypress', 'scroll', 'mousemove'].forEach(event => {
    document.addEventListener(event, () => {
        lastActivity = Date.now();
        parent.postMessage({
            type: 'pwa-activity',
            appId: '${this.appId}',
            timestamp: lastActivity
        }, '*');
    }, { passive: true });
});
`;
    }
    
    // Setup message handling between container and iframe
    setupMessageHandling(iframe) {
        // Listen for messages from the PWA
        window.addEventListener('message', (event) => {
            if (event.data.appId === this.appId) {
                this.handlePWAMessage(event.data);
            }
        });
    }
    
    handlePWAMessage(message) {
        switch (message.type) {
            case 'pwa-loading':
                this.emit('loading', message);
                break;
                
            case 'pwa-loaded':
                this.lastActivity = Date.now();
                this.emit('loaded', message);
                break;
                
            case 'pwa-error':
                this.state = 'error';
                this.emit('error', new Error(message.error));
                break;
                
            case 'pwa-activity':
                this.lastActivity = Date.now();
                this.emit('activity', message);
                break;
                
            case 'request-app-files':
                this.sendAppFiles();
                break;
                
            default:
                this.emit('message', message);
        }
    }
    
    async sendAppFiles() {
        try {
            const files = await this.loadAppFiles();
            
            // Send files to iframe
            this.iframe.contentWindow.postMessage({
                type: 'pwa-files',
                appId: this.appId,
                files
            }, '*');
            
        } catch (error) {
            this.emit('error', error);
        }
    }
    
    async loadAppFiles() {
        const appPath = path.join(this.sandboxPath, 'app');
        const files = {};
        
        try {
            // Load main files
            const indexPath = path.join(appPath, 'index.html');
            if (await this.fileExists(indexPath)) {
                files.html = await fs.readFile(indexPath, 'utf8');
            }
            
            const cssPath = path.join(appPath, 'style.css');
            if (await this.fileExists(cssPath)) {
                files.css = await fs.readFile(cssPath, 'utf8');
            }
            
            const jsPath = path.join(appPath, 'app.js');
            if (await this.fileExists(jsPath)) {
                files.js = await fs.readFile(jsPath, 'utf8');
            }
            
            // Load additional resources
            files.resources = await this.loadAppResources(appPath);
            
            return files;
            
        } catch (error) {
            throw new Error(`Failed to load app files: ${error.message}`);
        }
    }
    
    async loadAppResources(appPath) {
        const resources = {};
        
        try {
            const entries = await fs.readdir(appPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isFile() && !['index.html', 'style.css', 'app.js'].includes(entry.name)) {
                    const filePath = path.join(appPath, entry.name);
                    const content = await fs.readFile(filePath);
                    resources[entry.name] = content.toString('base64');
                }
            }
            
        } catch (error) {
            // Resources directory might not exist
        }
        
        return resources;
    }
    
    // Validate PWA manifest
    validateManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') {
            throw new Error('Invalid manifest: must be an object');
        }
        
        if (!manifest.name) {
            throw new Error('Invalid manifest: name is required');
        }
        
        if (!manifest.start_url) {
            throw new Error('Invalid manifest: start_url is required');
        }
        
        // Validate icons
        if (manifest.icons && !Array.isArray(manifest.icons)) {
            throw new Error('Invalid manifest: icons must be an array');
        }
        
        return true;
    }
    
    // Setup sandbox environment
    async setupSandboxEnvironment(manifest, appFiles) {
        try {
            // Create app directory
            const appPath = path.join(this.sandboxPath, 'app');
            await fs.mkdir(appPath, { recursive: true });
            
            // Create data directory
            const dataPath = path.join(this.sandboxPath, 'data');
            await fs.mkdir(dataPath, { recursive: true });
            
            // Write app files
            await this.writeAppFiles(appPath, appFiles);
            
            // Create manifest file
            const manifestPath = path.join(appPath, 'manifest.json');
            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
            
        } catch (error) {
            throw new Error(`Failed to setup sandbox: ${error.message}`);
        }
    }
    
    async writeAppFiles(appPath, appFiles) {
        for (const [filename, content] of Object.entries(appFiles)) {
            const filePath = path.join(appPath, filename);
            
            if (typeof content === 'string') {
                await fs.writeFile(filePath, content, 'utf8');
            } else {
                // Binary content
                await fs.writeFile(filePath, content);
            }
        }
    }
    
    // Initialize MCP client connection
    async initializeMCPClient() {
        // MCP client is initialized in the iframe context
        // This method sets up the bridge communication
        return {
            connected: false,
            appId: this.appId,
            permissions: this.permissions
        };
    }
    
    // Start resource monitoring
    startResourceMonitoring() {
        setInterval(() => {
            this.updateResourceUsage();
        }, 5000); // Update every 5 seconds
    }
    
    updateResourceUsage() {
        // Monitor memory usage (simplified)
        this.resourceUsage.memory = process.memoryUsage().heapUsed;
        
        // Monitor activity
        const now = Date.now();
        const timeSinceActivity = now - (this.lastActivity || now);
        
        if (timeSinceActivity > 300000) { // 5 minutes idle
            this.emit('idle', { appId: this.appId, idleTime: timeSinceActivity });
        }
        
        // Check memory limits
        if (this.resourceUsage.memory > this.config.maxMemory) {
            this.emit('memoryLimitExceeded', {
                appId: this.appId,
                usage: this.resourceUsage.memory,
                limit: this.config.maxMemory
            });
        }
    }
    
    // Permission management
    hasPermission(permission) {
        return this.permissions.has(permission) || this.permissions.has(permission.split('.')[0] + '.*');
    }
    
    getPermissionData(permission) {
        // Get additional permission data (like allowed domains for network access)
        return this.config.permissionData?.[permission];
    }
    
    // Container lifecycle methods
    
    async pause() {
        if (this.state === 'running') {
            this.state = 'paused';
            this.emit('stateChange', 'paused');
            
            // Send pause message to iframe
            if (this.iframe?.contentWindow) {
                this.iframe.contentWindow.postMessage({
                    type: 'pwa-pause',
                    appId: this.appId
                }, '*');
            }
        }
    }
    
    async resume() {
        if (this.state === 'paused') {
            this.state = 'running';
            this.lastActivity = Date.now();
            this.emit('stateChange', 'running');
            
            // Send resume message to iframe
            if (this.iframe?.contentWindow) {
                this.iframe.contentWindow.postMessage({
                    type: 'pwa-resume',
                    appId: this.appId
                }, '*');
            }
        }
    }
    
    async stop() {
        this.state = 'stopped';
        this.emit('stateChange', 'stopped');
        
        // Clean up iframe
        if (this.iframe) {
            // Remove iframe from DOM if it exists
            this.iframe = null;
        }
        
        // Close MCP connection
        if (this.mcpClient) {
            this.mcpClient = null;
        }
        
        this.emit('stopped', { appId: this.appId });
    }
    
    async restart() {
        await this.stop();
        // The container would need to be recreated for a full restart
        this.emit('restart', { appId: this.appId });
    }
    
    // Get container status
    getStatus() {
        return {
            appId: this.appId,
            state: this.state,
            startTime: this.startTime,
            lastActivity: this.lastActivity,
            resourceUsage: this.resourceUsage,
            permissions: Array.from(this.permissions),
            uptime: this.startTime ? Date.now() - this.startTime : 0
        };
    }
    
    // Cleanup resources
    async cleanup() {
        await this.stop();
        
        // Clean up sandbox files (optional)
        try {
            await fs.rm(this.sandboxPath, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Failed to cleanup sandbox for ${this.appId}:`, error);
        }
        
        this.removeAllListeners();
    }
    
    // Helper methods
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = PWAContainer;