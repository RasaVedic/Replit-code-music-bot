# 🎵 RagaBot - Advanced Discord Music Bot

**RagaBot** is a powerful, feature-rich Discord music bot built with modern technology stack including **Lavalink**, **Discord.js v14**, and **SQLite database**. It supports multiple music sources, custom prefixes, advanced queue management, and an intuitive button-based interface.

## ✨ Features

### 🎵 **Music Playback**
- **Multiple Sources**: YouTube, Spotify, SoundCloud support
- **High-Quality Streaming**: Powered by Lavalink for superior audio quality
- **Fast Loading**: Direct streaming without full buffering
- **Smart Fallbacks**: Automatic source switching if one fails

### 🎛️ **Advanced Controls**
- **Interactive Buttons**: Previous, Play/Pause, Skip, Stop controls
- **Smart Autoplay**: Intelligent song suggestions based on listening history
- **Loop Modes**: Single song and queue loop options
- **Queue Management**: Shuffle, clear, and advanced queue operations
- **Volume Control**: Per-server volume settings (0-100%)

### ⚙️ **Customization**
- **Custom Prefixes**: Set unique prefixes per server
- **Short Commands**: Use `!p` instead of `!play` for faster commands
- **Multi-Language**: Hindi and English support
- **User Preferences**: Personalized settings per user

### 📊 **Advanced Features**
- **Command Aliases**: 30+ command shortcuts for efficiency
- **Play History**: Track last 20 played songs
- **Command Statistics**: Usage tracking and analytics
- **Persistent Settings**: SQLite database for reliable data storage
- **Queue Persistence**: Resume queues after bot restart

## 🚀 **Quick Setup**

### Prerequisites
- **Node.js 18+** 
- **Java 17+** (for Lavalink)
- **Discord Bot Token**

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/ragabot
cd ragabot
npm install
```

### 2. Environment Variables
Create `.env` file:
```env
DISCORD_TOKEN=your_discord_bot_token_here
```

### 3. Start Lavalink Server
```bash
# Download Lavalink (if not included)
curl -OL https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar

# Start Lavalink server
java -jar Lavalink.jar
```

### 4. Start Bot
```bash
npm start
```

## 📋 **Commands Reference**

### 🎵 **Music Commands**
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!play` | `!p`, `!pl`, `!music` | Play song from URL or search | `!p Tum Hi Ho` |
| `!skip` | `!s`, `!sk`, `!next` | Skip current song | `!s` |
| `!stop` | `!st`, `!halt`, `!dc` | Stop music and disconnect | `!stop` |
| `!pause` | - | Pause current song | `!pause` |
| `!resume` | - | Resume paused song | `!resume` |
| `!volume` | `!v`, `!vol` | Set volume (0-100) | `!v 80` |

### 📋 **Queue Management**
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!queue` | `!q`, `!qu`, `!list` | Show current queue | `!q` |
| `!shuffle` | `!mix` | Shuffle queue | `!shuffle` |
| `!clear` | `!empty` | Clear entire queue | `!clear` |
| `!nowplaying` | `!np`, `!current` | Show current song | `!np` |

### ⚙️ **Settings & Control**
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!loop` | `!l`, `!repeat` | Toggle loop mode | `!loop` |
| `!autoplay` | - | Toggle smart autoplay | `!autoplay` |
| `!setprefix` | `!prefix` | Change server prefix | `!setprefix ?` |
| `!help` | `!h`, `!commands` | Show command help | `!help` |

## 🎛️ **Button Controls**

### Main Control Panel
- **⏮️ Previous**: Play previous song from history
- **⏯️ Play/Pause**: Toggle playback
- **⏭️ Skip**: Skip to next song
- **⏹️ Stop**: Stop music and clear queue

### Advanced Controls
- **🔂 Loop**: Toggle loop mode (On/Off)
- **🤖 Auto**: Toggle autoplay (On/Off)
- **🔀 Shuffle**: Shuffle current queue
- **📋 Queue**: View detailed queue information

## 🏗️ **Architecture**

### **Tech Stack**
- **Discord.js v14**: Modern Discord API wrapper
- **Lavalink**: High-performance audio server
- **SQLite3**: Lightweight database for settings
- **Node.js**: Runtime environment

### **Key Components**
1. **LavalinkManager**: Handles audio streaming and playback
2. **EnhancedMusicQueue**: Advanced queue management system
3. **Database Layer**: Persistent settings and preferences
4. **Command System**: Dual prefix/slash command support
5. **Button Interface**: Interactive music controls

### **Performance Features**
- **Connection Pooling**: Efficient resource management
- **Memory Optimization**: Smart garbage collection
- **Caching Strategy**: Reduced API calls
- **Error Recovery**: Automatic reconnection and fallbacks

## 🌐 **Deployment**

### **Render Deployment**

1. **Fork this repository** to your GitHub account

2. **Create new Web Service** on [Render](https://render.com)
   - Connect your forked repository
   - Set **Build Command**: `npm install`
   - Set **Start Command**: `npm start`

3. **Environment Variables**:
   ```
   DISCORD_TOKEN=your_bot_token
   NODE_ENV=production
   ```

4. **Lavalink Setup** (for Render):
   ```yaml
   # render.yaml (optional)
   services:
     - type: web
       name: ragabot
       env: node
       buildCommand: npm install
       startCommand: npm start
       envVars:
         - key: DISCORD_TOKEN
           sync: false
   ```

### **Alternative Hosting**
- **Railway**: Simple deployment with Git integration
- **Heroku**: Classic platform (paid plans only)
- **VPS Hosting**: DigitalOcean, Linode for full control
- **Self-Hosted**: Your own server setup

### **Production Optimizations**
```javascript
// Recommended PM2 configuration
module.exports = {
  apps: [{
    name: 'ragabot',
    script: 'index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
```

## 🔧 **Configuration**

### **Bot Configuration** (`config/botConfig.js`)
```javascript
module.exports = {
  BOT: {
    PREFIX: '!',                    // Default prefix
    MAX_QUEUE_SIZE: 500,           // Maximum songs in queue
    DEFAULT_VOLUME: 50,            // Default volume (0-100)
    OWNER_IDS: ['your_user_id']    // Bot owner user IDs
  },
  
  LAVALINK: {
    HOST: 'localhost',             // Lavalink host
    PORT: 2333,                    // Lavalink port
    PASSWORD: 'youshallnotpass'    // Lavalink password
  }
}
```

### **Lavalink Configuration** (`application.yml`)
```yaml
server:
  port: 2333
  address: 0.0.0.0

lavalink:
  server:
    password: "youshallnotpass"
    sources:
      youtube: true
      soundcloud: true
      spotify: true    # Requires plugin
```

## 🎨 **Customization**

### **Adding Custom Commands**
```javascript
// Example: Add lyrics command
async function handleLyricsCommand(message, args, guildSettings) {
    const queue = getQueue(message.guild.id);
    if (!queue.nowPlaying) {
        return message.reply('No song is currently playing!');
    }
    
    // Fetch lyrics logic here
    const lyrics = await fetchLyrics(queue.nowPlaying.info.title);
    
    const embed = new EmbedBuilder()
        .setTitle(`🎤 Lyrics: ${queue.nowPlaying.info.title}`)
        .setDescription(lyrics.substring(0, 4096))
        .setColor(config.COLORS.INFO);
        
    await message.reply({ embeds: [embed] });
}
```

### **Custom Embed Styling**
```javascript
// Modify colors in config/botConfig.js
COLORS: {
    SUCCESS: '#00ff00',    // Green
    ERROR: '#ff0000',      // Red  
    INFO: '#00ffff',       // Cyan
    MUSIC: '#9932cc'       // Purple
}
```

## 📊 **Statistics & Monitoring**

### **Command Usage Stats**
```sql
-- View popular commands
SELECT command, COUNT(*) as usage_count 
FROM command_stats 
GROUP BY command 
ORDER BY usage_count DESC;

-- Server activity
SELECT guild_id, COUNT(*) as total_commands 
FROM command_stats 
GROUP BY guild_id 
ORDER BY total_commands DESC;
```

### **Performance Monitoring**
- **Memory Usage**: Track with `process.memoryUsage()`
- **Command Latency**: Measure response times
- **Uptime Statistics**: Track bot availability
- **Error Rates**: Monitor and log errors

## 🔍 **Troubleshooting**

### **Common Issues**

#### **Bot Not Responding**
```bash
# Check if bot is online
node -e "console.log('Bot script syntax OK')" index.js

# Verify Discord token
echo $DISCORD_TOKEN

# Check Lavalink connection
curl http://localhost:2333/version
```

#### **Audio Issues**
```bash
# Restart Lavalink
pkill -f Lavalink
java -jar Lavalink.jar

# Check voice permissions
# Ensure bot has Connect + Speak permissions
```

#### **Database Issues**
```bash
# Check database file
ls -la ragabot.db

# Reset database (WARNING: Deletes all settings)
rm ragabot.db
# Bot will recreate on startup
```

### **Debug Mode**
```javascript
// Enable debug logging
const client = new Client({
    intents: [...],
    rest: { version: '10' },
    debug: true  // Add this line
});
```

## 🤝 **Contributing**

### **Development Setup**
```bash
# Fork repository
git clone https://github.com/yourusername/ragabot.git
cd ragabot

# Install dependencies
npm install

# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and test
npm test

# Commit and push
git add .
git commit -m "Add your feature"
git push origin feature/your-feature-name
```

### **Pull Request Guidelines**
1. **Follow Code Style**: Use consistent formatting
2. **Add Tests**: Include unit tests for new features  
3. **Update Documentation**: Update README if needed
4. **Test Thoroughly**: Verify all functionality works
5. **Small PRs**: Keep changes focused and reviewable

### **Reporting Issues**
- **Bug Reports**: Include error logs and reproduction steps
- **Feature Requests**: Clearly describe the desired functionality
- **Performance Issues**: Provide profiling data if possible

## 📄 **License**

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🙏 **Credits & Acknowledgments**

- **Discord.js**: Powerful Discord API wrapper
- **Lavalink**: High-performance audio streaming
- **Contributors**: Thank you to all contributors
- **Community**: Discord music bot community for inspiration

## 📞 **Support**

### **Community Support**
- **Discord Server**: [Join our community](https://discord.gg/your-invite)
- **GitHub Issues**: [Report bugs](https://github.com/yourusername/ragabot/issues)
- **Documentation**: This comprehensive README

### **Professional Support**
For professional support, custom features, or enterprise deployment:
- **Email**: your.email@domain.com
- **Consultation**: Available for custom implementations

---

**Made with ❤️ for the Discord music community**

**⭐ Star this repository if you found it helpful!**