class MCPBridgeClient {
    constructor(config) {
        this.config = config;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
        this.reconnectDelay = config.reconnectDelay || 1000;
        this.callbacks = new Map();
        this.initialize();
    }

    initialize() {
        this.connect();
        this.setupEventListeners();
    }

    connect() {
        if (this.ws) {
            this.ws.close();
        }

        this.ws = new WebSocket(this.config.url);
        this.ws.onopen = () => {
            console.log('MCP Bridge Client connected');
            this.reconnectAttempts = 0;
        };

        this.ws.onclose = () => {
            console.log('MCP Bridge Client disconnected');
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.reconnectAttempts++;
                    this.connect();
                }, this.reconnectDelay);
            }
        };

        this.ws.onerror = (error) => {
            console.error('MCP Bridge Client error:', error);
        };
    }

    setupEventListeners() {
        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                const { id, type } = message;

                if (this.callbacks.has(id)) {
                    const callback = this.callbacks.get(id);
                    callback(message);
                    this.callbacks.delete(id);
                } else if (type === 'status') {
                    this.emit('status', message);
                } else if (message.error) {
                    this.emit('error', message);
                }
            } catch (error) {
                console.error('Error parsing message:', error);
                this.emit('error', { error: 'Invalid message format' });
            }
        };
    }

    send(type, payload, callback) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            callback({ error: 'Not connected to MCP Bridge' });
            return;
        }

        const id = crypto.randomUUID();
        const message = { id, type, payload };
        
        if (callback) {
            this.callbacks.set(id, callback);
        }

        this.ws.send(JSON.stringify(message));
    }

    installApp(manifestUrl, callback) {
        this.send('install', { manifestUrl }, callback);
    }

    uninstallApp(id, callback) {
        this.send('uninstall', { id }, callback);
    }

    updateApp(id, callback) {
        this.send('update', { id }, callback);
    }

    getStatus(callback) {
        this.send('status', {}, callback);
    }

    emit(event, data) {
        if (this.config.onEvent) {
            this.config.onEvent(event, data);
        }
    }
}

module.exports = MCPBridgeClient;
