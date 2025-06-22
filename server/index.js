const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Import route handlers
const healthRoutes = require('./routes/health');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const appsRoutes = require('./routes/apps');

class MarketplaceServer {
    constructor() {
        this.app = express();
        this.config = this.loadConfig();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }
    
    loadConfig() {
        const configPath = process.env.CONFIG_PATH || './config';
        const defaultConfig = {
            server: {
                port: process.env.PORT || 3000,
                host: process.env.HOST || '0.0.0.0'
            },
            storage: {
                appsPath: process.env.APPS_PATH || './storage/apps',
                dataPath: process.env.DATA_PATH || './storage/data',
                cachePath: process.env.CACHE_PATH || './storage/cache'
            },
            services: {
                mcpBridge: process.env.MCP_BRIDGE_URL || 'http://mcp-bridge:3001',
                resourceController: process.env.RESOURCE_CONTROLLER_URL || 'http://resource-controller:3002',
                githubProxy: process.env.GITHUB_PROXY_URL || 'http://github-proxy:3003'
            }
        };
        
        try {
            const userConfig = require(path.join(configPath, 'marketplace-config.json'));
            return { ...defaultConfig, ...userConfig };
        } catch (error) {
            console.log('Using default configuration');
            return defaultConfig;
        }
    }
    
    setupMiddleware() {
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", "ws:", "wss:", "https://api.github.com"],
                    fontSrc: ["'self'", "https://cdnjs.cloudflare.com"]
                }
            }
        }));
        
        // CORS
        this.app.use(cors({
            origin: this.config.server?.cors?.origins || ['http://localhost:3000'],
            credentials: true
        }));
        
        // Compression
        this.app.use(compression());
        
        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 1000, // limit each IP to 1000 requests per windowMs
            message: 'Too many requests from this IP'
        });
        this.app.use('/api/', limiter);
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // Static files
        this.app.use(express.static(path.join(__dirname, '../dist')));
        
        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
            next();
        });
    }
    
    setupRoutes() {
        // Health check
        this.app.use('/health', healthRoutes);
        
        // API routes
        this.app.use('/api', apiRoutes);
        this.app.use('/auth', authRoutes);
        this.app.use('/apps', appsRoutes);
        
        // Proxy to MCP Bridge
        this.app.use('/mcp', createProxyMiddleware({
            target: this.config.services.mcpBridge,
            changeOrigin: true,
            pathRewrite: { '^/mcp': '' }
        }));
        
        // Proxy to Resource Controller
        this.app.use('/resources', createProxyMiddleware({
            target: this.config.services.resourceController,
            changeOrigin: true,
            pathRewrite: { '^/resources': '' }
        }));
        
        // Proxy to GitHub Proxy
        this.app.use('/github', createProxyMiddleware({
            target: this.config.services.githubProxy,
            changeOrigin: true,
            pathRewrite: { '^/github': '' }
        }));
        
        // Serve PWA app for all other routes
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, '../dist/index.html'));
        });
    }
    
    setupErrorHandling() {
        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.method} ${req.path} not found`
            });
        });
        
        // Error handler
        this.app.use((error, req, res, next) => {
            console.error('Server error:', error);
            
            const status = error.status || 500;
            const message = process.env.NODE_ENV === 'production' 
                ? 'Internal Server Error' 
                : error.message;
            
            res.status(status).json({
                error: 'Server Error',
                message,
                ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
            });
        });
    }
    
    start() {
        const { port, host } = this.config.server;
        
        this.server = this.app.listen(port, host, () => {
            console.log(`PWA Marketplace running on http://${host}:${port}`);
            console.log(`Environment: ${process.env.NODE_ENV}`);
            console.log(`Storage path: ${this.config.storage.appsPath}`);
        });
        
        // Graceful shutdown
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
    }
    
    shutdown() {
        console.log('Shutting down PWA Marketplace...');
        
        if (this.server) {
            this.server.close(() => {
                console.log('PWA Marketplace shut down gracefully');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    }
}

// Start the server
if (require.main === module) {
    const server = new MarketplaceServer();
    server.start();
}

module.exports = MarketplaceServer;

