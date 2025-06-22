const express = require('express');
const cors = require('cors');
const mcpServer = require('./mcp/server');
const pwaInstaller = require('./pwa/installer');
const storageManager = require('./storage/manager');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Initialize MCP server
const mcp = mcpServer.initialize();

// Initialize storage
storageManager.initialize();

// Routes
app.post('/api/install', async (req, res) => {
    try {
        const { manifestUrl } = req.body;
        const result = await pwaInstaller.install(manifestUrl);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/apps', async (req, res) => {
    try {
        const apps = await storageManager.listApps();
        res.json(apps);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Backend server running on port ${port}`);
});
