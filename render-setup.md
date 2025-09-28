# Render.com Deployment Setup

## Quick Deploy to Render.com

### 1. Environment Variables Required
Set these in your Render.com service:

```
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_application_id_here
NODE_ENV=production
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
BOT_NAME=EchoTune
```

### 2. Deployment Options

#### Option A: Simple Deployment (Recommended)
1. Connect your GitHub repo to Render.com
2. Create a new Web Service
3. Use the provided `render.yaml` configuration
4. Set environment variables
5. Deploy!

#### Option B: Docker Deployment
1. Use the provided `Dockerfile`
2. Set build command: `docker build .`
3. Set start command: `node index.js`
4. Configure environment variables

#### Option C: Full Setup with Lavalink
1. Use `docker-compose.yml` for local development
2. For production, deploy Lavalink separately
3. Set `LAVALINK_HOST` to your Lavalink server URL

### 3. Health Check
The bot includes a health check server on port 3000.
Render.com will automatically monitor `/health` endpoint.

### 4. Performance Tips
- Use "Starter" plan for small servers (< 10 servers)
- Use "Standard" plan for medium servers (10-100 servers)  
- Use "Pro" plan for large servers (100+ servers)

### 5. Troubleshooting
- Check logs in Render.com dashboard
- Ensure all environment variables are set
- Verify Discord bot permissions
- Test locally with `npm start` first

### 6. Features Included
- ✅ Enhanced YouTube streaming with anti-detection
- ✅ Lavalink support for better performance
- ✅ Smart caching for faster responses
- ✅ Interactive button controls
- ✅ Queue management with 25+ commands
- ✅ Automatic error recovery
- ✅ Health monitoring
- ✅ Performance optimization

---

**Ready to deploy? Just push to GitHub and connect to Render.com!**