const http = require('http');

// Simple health check server for Render deployment
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            memory: process.memoryUsage(),
            version: process.version
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`📊 Health check server running on port ${port}`);
});

module.exports = server;