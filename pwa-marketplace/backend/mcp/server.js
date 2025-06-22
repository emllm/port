const WebSocket = require('ws');
const security = require('./security');
const storage = require('../storage/manager');

let wss = null;

const initialize = () => {
    wss = new WebSocket.Server({ noServer: true });
    
    wss.on('connection', (ws, req) => {
        const clientId = req.headers['x-client-id'];
        
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                const { type, payload } = data;
                
                // Validate permissions
                if (!await security.hasPermission(clientId, type)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: 'Permission denied'
                    }));
                    return;
                }
                
                switch(type) {
                    case 'storage.read':
                        const result = await storage.read(payload.key);
                        ws.send(JSON.stringify({
                            type: 'storage.read.result',
                            result
                        }));
                        break;
                    
                    case 'storage.write':
                        await storage.write(payload.key, payload.value);
                        ws.send(JSON.stringify({
                            type: 'storage.write.result',
                            success: true
                        }));
                        break;
                    
                    // Add more protocol handlers here
                }
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: error.message
                }));
            }
        });
    });
    
    return wss;
};

module.exports = {
    initialize
};
