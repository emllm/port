const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class MCPBridgeServer {
    constructor(config) {
        this.config = config;
        this.clients = new Map();
        this.connections = new Map();
        this.permissions = new Map();
        this.initialize();
    }

    initialize() {
        // Load permissions from config
        if (this.config.permissionsFile) {
            try {
                const permissions = JSON.parse(
                    fs.readFileSync(this.config.permissionsFile, 'utf8')
                );
                Object.entries(permissions).forEach(([id, perm]) => {
                    this.permissions.set(id, perm);
                });
            } catch (error) {
                console.error('Error loading permissions:', error);
            }
        }

        // Initialize WebSocket server
        this.wss = new WebSocket.Server({
            port: this.config.port,
            host: this.config.host,
        });

        this.wss.on('connection', (ws, req) => {
            const clientId = uuidv4();
            this.clients.set(clientId, ws);
            
            ws.on('message', (data) => {
                this.handleMessage(clientId, data);
            });

            ws.on('close', () => {
                this.clients.delete(clientId);
                this.connections.delete(clientId);
            });
        });

        console.log(`MCP Bridge Server started on ws://${this.config.host}:${this.config.port}`);
    }

    handleMessage(clientId, data) {
        try {
            const message = JSON.parse(data);
            const { type, payload, id } = message;

            if (!this.connections.has(clientId)) {
                this.connections.set(clientId, { id, type });
            }

            // Verify permissions
            const connection = this.connections.get(clientId);
            const permission = this.permissions.get(connection.id);
            if (!permission || !permission.types.includes(type)) {
                this.sendError(clientId, 'Unauthorized');
                return;
            }

            // Handle message based on type
            switch (type) {
                case 'install':
                    this.handleInstall(clientId, payload);
                    break;
                case 'uninstall':
                    this.handleUninstall(clientId, payload);
                    break;
                case 'update':
                    this.handleUpdate(clientId, payload);
                    break;
                case 'status':
                    this.handleStatus(clientId);
                    break;
                default:
                    this.sendError(clientId, 'Unknown message type');
            }
        } catch (error) {
            console.error('Error handling message:', error);
            this.sendError(clientId, 'Invalid message format');
        }
    }

    handleInstall(clientId, payload) {
        // TODO: Implement PWA installation
        const response = {
            id: payload.id,
            status: 'success',
            message: 'Installation initiated'
        };
        this.sendResponse(clientId, response);
    }

    handleUninstall(clientId, payload) {
        // TODO: Implement PWA uninstallation
        const response = {
            id: payload.id,
            status: 'success',
            message: 'Uninstallation initiated'
        };
        this.sendResponse(clientId, response);
    }

    handleUpdate(clientId, payload) {
        // TODO: Implement PWA update
        const response = {
            id: payload.id,
            status: 'success',
            message: 'Update initiated'
        };
        this.sendResponse(clientId, response);
    }

    handleStatus(clientId) {
        const connection = this.connections.get(clientId);
        const status = {
            id: connection.id,
            type: connection.type,
            status: 'connected',
            timestamp: new Date().toISOString()
        };
        this.sendResponse(clientId, status);
    }

    sendResponse(clientId, data) {
        const ws = this.clients.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    sendError(clientId, message) {
        const error = {
            error: message,
            timestamp: new Date().toISOString()
        };
        this.sendResponse(clientId, error);
    }
}

module.exports = MCPBridgeServer;
