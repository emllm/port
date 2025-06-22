const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs').promises;

router.get('/', async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            system: {
                platform: os.platform(),
                arch: os.arch(),
                nodeVersion: process.version,
                memory: {
                    used: process.memoryUsage(),
                    total: os.totalmem(),
                    free: os.freemem()
                },
                cpu: {
                    count: os.cpus().length,
                    loadAverage: os.loadavg()
                }
            },
            services: {
                marketplace: 'healthy'
            }
        };
        
        // Check storage paths
        try {
            const storagePath = process.env.STORAGE_PATH || './storage';
            await fs.access(storagePath);
            health.storage = 'accessible';
        } catch (error) {
            health.storage = 'error';
            health.status = 'degraded';
        }
        
        // Check service dependencies
        const services = [
            { name: 'mcp-bridge', url: process.env.MCP_BRIDGE_URL || 'http://mcp-bridge:3001' },
            { name: 'resource-controller', url: process.env.RESOURCE_CONTROLLER_URL || 'http://resource-controller:3002' },
            { name: 'github-proxy', url: process.env.GITHUB_PROXY_URL || 'http://github-proxy:3003' }
        ];
        
        for (const service of services) {
            try {
                const response = await fetch(`${service.url}/health`, { 
                    timeout: 2000,
                    method: 'GET'
                });
                health.services[service.name] = response.ok ? 'healthy' : 'unhealthy';
                if (!response.ok && health.status === 'healthy') {
                    health.status = 'degraded';
                }
            } catch (error) {
                health.services[service.name] = 'unreachable';
                if (health.status === 'healthy') {
                    health.status = 'degraded';
                }
            }
        }
        
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
        
    } catch (error) {
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Readiness probe
router.get('/ready', async (req, res) => {
    try {
        // Check if all critical services are ready
        const criticalServices = [
            process.env.MCP_BRIDGE_URL || 'http://mcp-bridge:3001',
            process.env.RESOURCE_CONTROLLER_URL || 'http://resource-controller:3002'
        ];
        
        const checks = await Promise.allSettled(
            criticalServices.map(url => 
                fetch(`${url}/health`, { timeout: 1000 })
            )
        );
        
        const allReady = checks.every(check => 
            check.status === 'fulfilled' && check.value.ok
        );
        
        if (allReady) {
            res.status(200).json({ status: 'ready' });
        } else {
            res.status(503).json({ status: 'not ready' });
        }
        
    } catch (error) {
        res.status(503).json({
            status: 'not ready',
            error: error.message
        });
    }
});

// Liveness probe
router.get('/live', (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

module.exports = router;
