class MCPClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    connect() {
        this.ws = new WebSocket(this.serverUrl);
        
        this.ws.onopen = () => {
            console.log('Connected to MCP server');
            this.reconnectAttempts = 0;
        };
        
        this.ws.onclose = () => {
            console.log('Disconnected from MCP server');
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('MCP connection error:', error);
        };
    }

    async send(message) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Not connected to MCP server'));
                return;
            }
            
            this.ws.send(JSON.stringify(message));
            
            this.ws.onmessage = (event) => {
                const response = JSON.parse(event.data);
                if (response.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response);
                }
            };
        });
    }
}

module.exports = MCPClient;
