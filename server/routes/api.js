const express = require('express');
const router = express.Router();

// GitHub Apps API
router.get('/apps', async (req, res) => {
    try {
        const { category, search, sort, limit = 50, page = 1 } = req.query;
        
        // Proxy request to GitHub proxy service
        const githubProxyUrl = process.env.GITHUB_PROXY_URL || 'http://github-proxy:3003';
        const queryParams = new URLSearchParams({
            category: category || 'all',
            search: search || '',
            sort: sort || 'stars',
            limit: limit.toString(),
            page: page.toString()
        });
        
        const response = await fetch(`${githubProxyUrl}/discover?${queryParams}`);
        
        if (!response.ok) {
            throw new Error(`GitHub proxy error: ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
        
    } catch (error) {
        console.error('Error fetching apps:', error);
        res.status(500).json({
            error: 'Failed to fetch apps',
            message: error.message
        });
    }
});

// Get app details
router.get('/apps/:owner/:repo', async (req, res) => {
    try {
        const { owner, repo } = req.params;
        
        const githubProxyUrl = process.env.GITHUB_PROXY_URL || 'http://github-proxy:3003';
        const response = await fetch(`${githubProxyUrl}/app/${owner}/${repo}`);
        
        if (!response.ok) {
            throw new Error(`GitHub proxy error: ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
        
    } catch (error) {
        console.error('Error fetching app details:', error);
        res.status(500).json({
            error: 'Failed to fetch app details',
            message: error.message
        });
    }
});

// Install app
router.post('/apps/:owner/:repo/install', async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { permissions, folders } = req.body;
        
        // Forward to resource controller for installation
        const resourceControllerUrl = process.env.RESOURCE_CONTROLLER_URL || 'http://resource-controller:3002';
        const response = await fetch(`${resourceControllerUrl}/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                owner,
                repo,
                permissions,
                folders
            })
        });
        
        if (!response.ok) {
            throw new Error(`Installation failed: ${response.status}`);
        }
        
        const result = await response.json();
        res.json(result);
        
    } catch (error) {
        console.error('Error installing app:', error);
        res.status(500).json({
            error: 'Failed to install app',
            message: error.message
        });
    }
});

// Get installed apps
router.get('/installed-apps', async (req, res) => {
    try {
        const resourceControllerUrl = process.env.RESOURCE_CONTROLLER_URL || 'http://resource-controller:3002';
        const response = await fetch(`${resourceControllerUrl}/installed`);
        
        if (!response.ok) {
            throw new Error(`Resource controller error: ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
        
    } catch (error) {
        console.error('Error fetching installed apps:', error);
        res.status(500).json({
            error: 'Failed to fetch installed apps',
            message: error.message
        });
    }
});

module.exports = router;
