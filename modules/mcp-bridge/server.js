// modules/mcp-bridge/server.js
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// Import protocol handlers
const FilesystemProtocol = require('./protocols/filesystem');
const StorageProtocol = require('./protocols/storage');
const SystemProtocol = require('./protocols/system');
const NetworkProtocol = require('./protocols/network');

class MCPBridgeServer extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            port: config.port || process.env.MCP_PORT || 3001,
            host: config.host || '0.0.0.0',
            storagePath: config.storagePath || process.env.STORAGE_PATH || './storage',
            logLevel: config.logLevel || 'info',
            rateLimiting: {
                enabled: true,
                requestsPerMinute: 100,
                burstLimit: 20
            },
            security: {
                validateOrigin: true,
                allowedOrigins: ['http://localhost:3000'],
                requireAuth: false,
                sessionTimeout: 3600000 // 1 hour
            },
            ...config
        };
        
        // Initialize components
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        
        // Protocol handlers
        this.protocols = new Map();
        this.sessions = new Map();
        this.rateLimiters = new Map();
        
        // Request tracking
        this.requestCounter = 0;
        this.activeRequests = new Map();
        
        this.setupMiddleware();
        this.setupProtocols();
        this.setupWebSocketHandlers();
        this.setupHttpRoutes();
        this.setupCleanupHandlers();
    }
    
    setupMiddleware() {
        // CORS middleware
        this.app.use((req, res, next) => {
            const origin = req.headers.origin;
            if (this.config.security.allowedOrigins.includes(origin)) {
                res.header('Access-Control-Allow-Origin', origin);
            }
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            next();
        });
        
        // JSON parsing
        this.app.use(express.json({ limit: '10mb' }));
        
        // Request logging
        this.app.use((req, res, next) => {
            const requestId = ++this.requestCounter;
            req.requestId = requestId;
            req.startTime = Date.now();
            
            this.log('debug', `[${requestId}] ${req.method} ${req.path}`, {
                userAgent: req.headers['user-agent'],
                ip: req.ip
            });
            
            next();
        });
        
        // Rate limiting
        this.app.use((req, res, next) => {
            if (!this.config.rateLimiting.enabled) {
                return next();
            }
            
            const clientId = req.ip;
            const now = Date.now();
            const windowMs = 60000; // 1 minute
            
            if (!this.rateLimiters.has(clientId)) {
                this.rateLimiters.set(clientId, {
                    requests: [],
                    burst: []
                });
            }
            
            const limiter = this.rateLimiters.get(clientId);
            
            // Clean old requests
            limiter.requests = limiter.requests.filter(time => now - time < windowMs);
            limiter.burst = limiter.burst.filter(time => now - time < 1000); // 1 second burst window
            
            // Check limits
            if (limiter.requests.length >= this.config.rateLimiting.requestsPerMinute) {
                return res.status(429).json({
                    error: 'Too Many Requests',
                    message: 'Rate limit exceeded',
                    retryAfter: Math.ceil((limiter.requests[0] + windowMs - now) / 1000)
                });
            }
            
            if (limiter.burst.length >= this.config.rateLimiting.burstLimit) {
                return res.status(429).json({
                    error: 'Too Many Requests',
                    message: 'Burst limit exceeded',
                    retryAfter: 1
                });
            }
            
            // Record request
            limiter.requests.push(now);
            limiter.burst.push(now);
            
            next();
        });
    }
    
    setupProtocols() {
        // Initialize protocol handlers
        this.protocols.set('filesystem', new FilesystemProtocol({
            storagePath: this.config.storagePath,
            logger: this.log.bind(this)
        }));
        
        this.protocols.set('storage', new StorageProtocol({
            storagePath: this.config.storagePath,
            logger: this.log.bind(this)
        }));
        
        this.protocols.set('system', new SystemProtocol({
            logger: this.log.bind(this)
        }));
        
        this.protocols.set('network', new NetworkProtocol({
            logger: this.log.bind(this)
        }));
        
        this.log('info', 'Initialized MCP protocols', {
            protocols: Array.from(this.protocols.keys())
        });
    }
    
    setupWebSocketHandlers() {
        this.wss.on('connection', (ws, req) => {
            const sessionId = this.generateSessionId();
            const clientInfo = {
                sessionId,
                ip: req.socket.remoteAddress,
                userAgent: req.headers['user-agent'],
                connectedAt: new Date(),
                lastActivity: new Date()
            };
            
            this.sessions.set(sessionId, {
                ...clientInfo,
                ws,
                permissions: new Set(),
                appId: null
            });
            
            this.log('info', 'WebSocket client connected', clientInfo);
            
            ws.on('message', async (data) => {
                try {
                    await this.handleWebSocketMessage(sessionId, data);
                } catch (error) {
                    this.log('error', 'WebSocket message handling error', { error: error.message });
                    this.sendWebSocketError(ws, 'Internal server error', sessionId);
                }
            });
            
            ws.on('close', () => {
                this.sessions.delete(sessionId);
                this.log('info', 'WebSocket client disconnected', { sessionId });
            });
            
            ws.on('error', (error) => {
                this.log('error', 'WebSocket error', { sessionId, error: error.message });
                this.sessions.delete(sessionId);
            });
            
            // Send welcome message
            this.sendWebSocketMessage(ws, {
                type: 'welcome',
                sessionId,
                protocols: Array.from(this.protocols.keys()),
                serverInfo: {
                    name: 'PWA Marketplace MCP Bridge',
                    version: '1.0.0'
                }
            });
        });
    }
    
    async handleWebSocketMessage(sessionId, data) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }
        
        session.lastActivity = new Date();
        
        let message;
        try {
            message = JSON.parse(data.toString());
        } catch (error) {
            this.sendWebSocketError(session.ws, 'Invalid JSON message');
            return;
        }
        
        const { type, id, protocol, method, params, appId } = message;
        
        // Validate message structure
        if (!type || !id) {
            this.sendWebSocketError(session.ws, 'Missing required fields: type, id');
            return;
        }
        
        // Update session app ID if provided
        if (appId) {
            session.appId = appId;
        }
        
        switch (type) {
            case 'request':
                await this.handleProtocolRequest(session, { id, protocol, method, params });
                break;
                
            case 'auth':
                await this.handleAuthentication(session, { id, params });
                break;
                
            case 'ping':
                this.sendWebSocketMessage(session.ws, {
                    type: 'pong',
                    id,
                    timestamp: Date.now()
                });
                break;
                
            default:
                this.sendWebSocketError(session.ws, `Unknown message type: ${type}`, id);
        }
    }
    
    async handleProtocolRequest(session, { id, protocol, method, params }) {
        const requestId = `${session.sessionId}-${id}`;
        this.activeRequests.set(requestId, {
            sessionId: session.sessionId,
            protocol,
            method,
            startTime: Date.now()
        });
        
        try {
            // Validate protocol exists
            const protocolHandler = this.protocols.get(protocol);
            if (!protocolHandler) {
                throw new Error(`Unknown protocol: ${protocol}`);
            }
            
            // Check permissions
            const permission = `${protocol}.${method}`;
            if (!session.permissions.has(permission) && !session.permissions.has(`${protocol}.*`)) {
                throw new Error(`Permission denied for ${permission}`);
            }
            
            // Execute protocol method
            const context = {
                sessionId: session.sessionId,
                appId: session.appId,
                requestId
            };
            
            const result = await protocolHandler.execute(method, params, context);
            
            // Send successful response
            this.sendWebSocketMessage(session.ws, {
                type: 'response',
                id,
                result
            });
            
            this.log('debug', 'Protocol request completed', {
                sessionId: session.sessionId,
                protocol,
                method,
                duration: Date.now() - this.activeRequests.get(requestId).startTime
            });
            
        } catch (error) {
            this.log('error', 'Protocol request failed', {
                sessionId: session.sessionId,
                protocol,
                method,
                error: error.message
            });
            
            this.sendWebSocketError(session.ws, error.message, id);
        } finally {
            this.activeRequests.delete(requestId);
        }
    }
    
    async handleAuthentication(session, { id, params }) {
        try {
            const { appId, requestedPermissions } = params;
            
            if (!appId || !requestedPermissions) {
                throw new Error('Missing appId or requestedPermissions');
            }
            
            // In a real implementation, this would check with the permission manager
            // For now, we'll grant all requested permissions
            requestedPermissions.forEach(permission => {
                session.permissions.add(permission);
            });
            
            session.appId = appId;
            
            this.sendWebSocketMessage(session.ws, {
                type: 'response',
                id,
                result: {
                    authenticated: true,
                    grantedPermissions: requestedPermissions,
                    sessionExpires: Date.now() + this.config.security.sessionTimeout
                }
            });
            
            this.log('info', 'Client authenticated', {
                sessionId: session.sessionId,
                appId,
                permissions: requestedPermissions
            });
            
        } catch (error) {
            this.sendWebSocketError(session.ws, error.message, id);
        }
    }
    
    setupHttpRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            const health = {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                connections: this.sessions.size,
                activeRequests: this.activeRequests.size,
                protocols: Array.from(this.protocols.keys()),
                memory: process.memoryUsage()
            };
            
            res.json(health);
        });
        
        // Protocol information endpoint
        this.app.get('/protocols', (req, res) => {
            const protocolInfo = {};
            
            for (const [name, handler] of this.protocols) {
                protocolInfo[name] = {
                    name,
                    version: handler.version || '1.0.0',
                    methods: handler.getMethods ? handler.getMethods() : [],
                    description: handler.description || `${name} protocol handler`
                };
            }
            
            res.json(protocolInfo);
        });
        
        // Session information endpoint
        this.app.get('/sessions', (req, res) => {
            const sessionInfo = Array.from(this.sessions.values()).map(session => ({
                sessionId: session.sessionId,
                appId: session.appId,
                connectedAt: session.connectedAt,
                lastActivity: session.lastActivity,
                permissions: Array.from(session.permissions),
                ip: session.ip
            }));
            
            res.json(sessionInfo);
        });
        
        // Metrics endpoint
        this.app.get('/metrics', (req, res) => {
            const metrics = {
                totalSessions: this.sessions.size,
                activeRequests: this.activeRequests.size,
                totalRequests: this.requestCounter,
                protocolStats: this.getProtocolStats(),
                rateLimitStats: this.getRateLimitStats(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString()
            };
            
            res.json(metrics);
        });
        
        // RESTful API for protocols (alternative to WebSocket)
        this.app.post('/api/:protocol/:method', async (req, res) => {
            try {
                const { protocol, method } = req.params;
                const params = req.body;
                
                const protocolHandler = this.protocols.get(protocol);
                if (!protocolHandler) {
                    return res.status(404).json({
                        error: 'Protocol not found',
                        protocol
                    });
                }
                
                // Create temporary context for HTTP requests
                const context = {
                    sessionId: `http-${req.requestId}`,
                    appId: req.headers['x-app-id'] || 'unknown',
                    requestId: req.requestId
                };
                
                const result = await protocolHandler.execute(method, params, context);
                
                res.json({
                    success: true,
                    result
                });
                
            } catch (error) {
                this.log('error', 'HTTP API request failed', {
                    protocol: req.params.protocol,
                    method: req.params.method,
                    error: error.message
                });
                
                res.status(400).json({
                    error: error.message,
                    protocol: req.params.protocol,
                    method: req.params.method
                });
            }
        });
        
        // Error handling middleware
        this.app.use((error, req, res, next) => {
            this.log('error', 'Express error handler', {
                error: error.message,
                stack: error.stack,
                requestId: req.requestId
            });
            
            res.status(500).json({
                error: 'Internal server error',
                requestId: req.requestId
            });
        });
        
        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not found',
                path: req.path,
                method: req.method
            });
        });
    }
    
    setupCleanupHandlers() {
        // Clean up expired sessions
        setInterval(() => {
            const now = Date.now();
            const timeout = this.config.security.sessionTimeout;
            
            for (const [sessionId, session] of this.sessions) {
                if (now - session.lastActivity.getTime() > timeout) {
                    this.log('info', 'Session expired', { sessionId });
                    session.ws.close();
                    this.sessions.delete(sessionId);
                }
            }
        }, 60000); // Check every minute
        
        // Clean up rate limiters
        setInterval(() => {
            const now = Date.now();
            for (const [clientId, limiter] of this.rateLimiters) {
                limiter.requests = limiter.requests.filter(time => now - time < 60000);
                limiter.burst = limiter.burst.filter(time => now - time < 1000);
                
                if (limiter.requests.length === 0 && limiter.burst.length === 0) {
                    this.rateLimiters.delete(clientId);
                }
            }
        }, 300000); // Clean every 5 minutes
        
        // Graceful shutdown
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
    }
    
    // Utility methods
    generateSessionId() {
        return crypto.randomBytes(16).toString('hex');
    }
    
    sendWebSocketMessage(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    
    sendWebSocketError(ws, message, requestId = null) {
        this.sendWebSocketMessage(ws, {
            type: 'error',
            id: requestId,
            error: message,
            timestamp: Date.now()
        });
    }
    
    getProtocolStats() {
        const stats = {};
        for (const [name, handler] of this.protocols) {
            stats[name] = {
                requestCount: handler.requestCount || 0,
                errorCount: handler.errorCount || 0,
                avgResponseTime: handler.avgResponseTime || 0
            };
        }
        return stats;
    }
    
    getRateLimitStats() {
        return {
            activeClients: this.rateLimiters.size,
            totalRequests: Array.from(this.rateLimiters.values())
                .reduce((sum, limiter) => sum + limiter.requests.length, 0)
        };
    }
    
    log(level, message, data = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            service: 'mcp-bridge',
            ...data
        };
        
        // In production, this would use a proper logging library
        if (this.shouldLog(level)) {
            console.log(JSON.stringify(logEntry));
        }
        
        this.emit('log', logEntry);
    }
    
    shouldLog(level) {
        const levels = ['error', 'warn', 'info', 'debug'];
        const configLevel = levels.indexOf(this.config.logLevel);
        const messageLevel = levels.indexOf(level);
        
        return messageLevel <= configLevel;
    }
    
    // Public methods
    async start() {
        return new Promise((resolve, reject) => {
            this.server.listen(this.config.port, this.config.host, (error) => {
                if (error) {
                    this.log('error', 'Failed to start MCP Bridge server', { error: error.message });
                    reject(error);
                } else {
                    this.log('info', 'MCP Bridge server started', {
                        host: this.config.host,
                        port: this.config.port,
                        protocols: Array.from(this.protocols.keys())
                    });
                    resolve();
                }
            });
        });
    }
    
    async shutdown() {
        this.log('info', 'Shutting down MCP Bridge server...');
        
        // Close all WebSocket connections
        for (const session of this.sessions.values()) {
            session.ws.close();
        }
        
        // Close HTTP server
        return new Promise((resolve) => {
            this.server.close(() => {
                this.log('info', 'MCP Bridge server shut down complete');
                resolve();
            });
        });
    }
    
    // Protocol management
    registerProtocol(name, handler) {
        this.protocols.set(name, handler);
        this.log('info', 'Protocol registered', { protocol: name });
    }
    
    unregisterProtocol(name) {
        const removed = this.protocols.delete(name);
        if (removed) {
            this.log('info', 'Protocol unregistered', { protocol: name });
        }
        return removed;
    }
    
    hasProtocol(name) {
        return this.protocols.has(name);
    }
    
    getProtocol(name) {
        return this.protocols.get(name);
    }
    
    // Session management
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
    
    closeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.ws.close();
            this.sessions.delete(sessionId);
            return true;
        }
        return false;
    }
    
    // Permission management
    grantPermission(sessionId, permission) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.permissions.add(permission);
            this.log('info', 'Permission granted', { sessionId, permission });
            return true;
        }
        return false;
    }
    
    revokePermission(sessionId, permission) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.permissions.delete(permission);
            this.log('info', 'Permission revoked', { sessionId, permission });
            return true;
        }
        return false;
    }
    
    hasPermission(sessionId, permission) {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        
        return session.permissions.has(permission) || 
               session.permissions.has(permission.split('.')[0] + '.*');
    }
}

// Protocol base class for consistency
class ProtocolHandler {
    constructor(config = {}) {
        this.config = config;
        this.requestCount = 0;
        this.errorCount = 0;
        this.responseTimes = [];
        this.logger = config.logger || console.log;
    }
    
    async execute(method, params, context) {
        const startTime = Date.now();
        this.requestCount++;
        
        try {
            // Check if method exists
            if (typeof this[method] !== 'function') {
                throw new Error(`Method ${method} not implemented`);
            }
            
            // Execute method
            const result = await this[method](params, context);
            
            // Record timing
            const duration = Date.now() - startTime;
            this.responseTimes.push(duration);
            if (this.responseTimes.length > 100) {
                this.responseTimes.shift(); // Keep only last 100 timings
            }
            
            return result;
            
        } catch (error) {
            this.errorCount++;
            this.logger('error', `Protocol ${this.constructor.name} method ${method} failed`, {
                error: error.message,
                context
            });
            throw error;
        }
    }
    
    getMethods() {
        return Object.getOwnPropertyNames(Object.getPrototypeOf(this))
            .filter(name => name !== 'constructor' && typeof this[name] === 'function')
            .filter(name => !['execute', 'getMethods', 'getStats'].includes(name));
    }
    
    getStats() {
        return {
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            avgResponseTime: this.responseTimes.length > 0 
                ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length 
                : 0
        };
    }
}

// Factory function for creating server instances
function createMCPBridgeServer(config) {
    return new MCPBridgeServer(config);
}

// CLI interface
if (require.main === module) {
    const config = {
        port: process.env.MCP_PORT || 3001,
        host: process.env.MCP_HOST || '0.0.0.0',
        storagePath: process.env.STORAGE_PATH || './storage',
        logLevel: process.env.LOG_LEVEL || 'info'
    };
    
    const server = createMCPBridgeServer(config);
    
    server.start().catch(error => {
        console.error('Failed to start MCP Bridge server:', error);
        process.exit(1);
    });
}

module.exports = {
    MCPBridgeServer,
    ProtocolHandler,
    createMCPBridgeServer
};