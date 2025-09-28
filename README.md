# 🎵 EchoTune - Advanced Discord Music Bot

**EchoTune** is a lightning-fast ⚡, feature-rich Discord music bot with **advanced performance optimizations**, **smart caching**, and **25+ powerful commands**. Supports YouTube, Spotify playlists, and SoundCloud with intelligent fallback systems.

## ⚡ Performance Features

### 🚀 **Speed Optimizations**
- **Smart Caching**: Guild settings and search results cached for instant responses  
- **Concurrent Operations**: Multiple tasks processed simultaneously
- **Memory Management**: Optimized resource cleanup and leak prevention
- **Enhanced Streaming**: Multiple fallback methods with anti-detection
- **Bulk Operations**: Lightning-fast playlist loading

### 🛡️ **Stability & Reliability**
- **Crash-Proof**: Advanced error handling prevents bot crashes
- **Auto-Recovery**: Intelligent reconnection and resource cleanup
- **Resource Monitoring**: Automatic cleanup of idle players and memory
- **Fault Tolerance**: Graceful degradation when services are unavailable

## ✨ Core Features

### 🎵 **Music Playback**
- **Multiple Sources**: YouTube, Spotify playlists, SoundCloud
- **Smart Search**: Cached results with intelligent suggestions  
- **High-Quality Audio**: Optimized streaming with enhanced quality
- **Playlist Auto-Detection**: Automatically detects and loads full playlists
- **Fast Loading**: Concurrent downloads and smart buffering

### 🎛️ **Advanced Controls**
- **Interactive Buttons**: Full control panel with visual feedback
- **Smart Autoplay**: AI-driven song suggestions based on listening patterns
- **Vote System**: Democratic skip voting for fair music control
- **Queue Management**: 10+ queue manipulation commands
- **Audio Filters**: Bass boost, nightcore, speed control

### 📊 **Professional Features**
- **Analytics**: Command usage tracking and performance metrics
- **Multi-Language**: Hindi and English support with auto-detection
- **Custom Prefixes**: Per-server customization
- **History Tracking**: Last 20 songs with replay functionality
- **Database Persistence**: SQLite for reliable data storage

## 🚀 Quick Setup

### Prerequisites
- **Node.js 18+**
- **Discord Bot Token** 
- **2GB+ RAM** (recommended for optimal performance)

### Installation
```bash
# Clone and setup
git clone <repository-url>
cd discord-music-bot
npm install

# Set your bot token
export DISCORD_TOKEN=your_bot_token_here

# Start the bot
npm start
```

### Environment Variables
```env
DISCORD_TOKEN=your_discord_bot_token_here
NODE_ENV=production
```

## 📋 Command Reference

### 🎵 **Music Commands**
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!play` | `!p` | Play song or playlist from URL/search | `!p Tum Hi Ho` |
| `!skip` | `!s` | Skip current song | `!s` |
| `!pause` | `!ps` | Pause current song | `!pause` |
| `!resume` | `!r` | Resume paused song | `!resume` |
| `!stop` | `!st` | Stop music and clear queue | `!stop` |
| `!volume` | `!v` | Set volume (1-100) | `!v 75` |
| `!leave` | `!lv` | Disconnect from voice channel | `!lv` |
| `!join` | `!j` | Join your voice channel | `!join` |

### 🗳️ **Advanced Music Control**
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!voteskip` | `!vs` | Democratic skip voting | `!vs` |
| `!skipto` | `!st` | Skip to specific position in queue | `!skipto 5` |
| `!seek` | - | Seek to time position | `!seek 1:30` |
| `!speed` | `!tempo` | Change playback speed (0.5-2.0) | `!speed 1.25` |
| `!bassboost` | `!bass` | Toggle bass enhancement | `!bass` |
| `!filters` | `!fx` | Audio filters menu | `!filters nightcore` |

### 📋 **Queue Management** 
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!queue` | `!q` | Show current queue | `!q` |
| `!shuffle` | `!sh` | Shuffle queue randomly | `!shuffle` |
| `!move` | `!mv` | Move song to different position | `!move 3 1` |
| `!remove` | `!rm` | Remove song from queue | `!rm 5` |
| `!clear` | - | Clear entire queue | `!clear` |
| `!loop` | `!l` | Toggle song/queue loop | `!loop` |
| `!autoplay` | `!ap` | Toggle smart autoplay | `!ap` |

### 🎵 **Playlist & History**
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!playlist` | `!pl` | Load YouTube/Spotify playlist | `!pl <playlist-url>` |
| `!nowplaying` | `!np` | Show current song info | `!np` |
| `!history` | `!h` | View recently played songs | `!history` |
| `!lyrics` | `!ly` | Get song lyrics | `!lyrics` |

### ⚙️ **System & Settings**
| Command | Aliases | Description | Example |
|---------|---------|-------------|---------|
| `!help` | `!h` | Complete command guide | `!help` |
| `!status` | - | Bot performance stats | `!status` |
| `!setprefix` | - | Change server prefix | `!setprefix ?` |

## 🎛️ Interactive Button Controls

### Main Control Panel
- **⏮️ Previous**: Play previous song from history
- **⏯️ Play/Pause**: Toggle playback with visual feedback
- **⏭️ Skip**: Skip to next song instantly  
- **⏹️ Stop**: Stop music and clear queue completely

### Advanced Controls
- **🔂 Loop**: Toggle loop mode (Song/Queue/Off)
- **🤖 Auto**: Toggle intelligent autoplay
- **🔀 Shuffle**: Randomize queue order
- **📋 Queue**: Quick queue overview
- **🔊 Volume**: Volume control buttons

## 🏗️ Architecture & Performance

### **Modern Tech Stack**
- **Discord.js v14**: Latest Discord API with optimal performance
- **Enhanced Audio Engine**: Custom fallback system with multiple sources  
- **SQLite3**: Lightweight, fast database for settings
- **Smart Caching**: Redis-like in-memory caching for speed
- **Concurrent Processing**: Async operations for maximum throughput

### **Performance Optimizations**
```javascript
// Smart caching system
global.guildSettingsCache = new Map();     // Instant guild settings
global.searchResultsCache = new Map();     // Cached search results  
global.audioPlayers = new Map();           // Efficient player management

// Memory management
CACHE_CONFIG = {
    GUILD_SETTINGS_TTL: 10 * 60 * 1000,    // 10 min cache
    SEARCH_RESULTS_TTL: 30 * 60 * 1000,    // 30 min cache  
    MAX_CACHE_SIZE: 1000,                   // LRU eviction
    CLEANUP_INTERVAL: 5 * 60 * 1000         // Auto cleanup
}
```

### **Intelligent Fallback System**
1. **Primary**: Play-dl with enhanced headers
2. **Secondary**: ytdl-core with rotating user agents  
3. **Tertiary**: Search-based YouTube fallback
4. **Final**: Cached similar content

## 🎵 Playlist Support

### **Auto-Detection**
- **YouTube Playlists**: `https://youtube.com/playlist?list=...`
- **Spotify Playlists**: `https://spotify.com/playlist/...` 
- **Spotify Albums**: `https://spotify.com/album/...`
- **Direct URLs**: Automatically detects and loads full playlists

### **Smart Loading**
```javascript
// Bulk playlist loading for performance
queue.addBulk(playlistTracks);              // Instant queue population
queue.isPlaylist = true;                    // Playlist mode enabled
queue.playlistInfo = metadata;              // Rich playlist information
```

## 🔧 Advanced Configuration

### **Performance Tuning**
```javascript
// config/botConfig.js
module.exports = {
    BOT: {
        MAX_QUEUE_SIZE: 100,           // Queue limit
        DEFAULT_VOLUME: 50,            // Starting volume
        IDLE_TIMEOUT: 300000,          // 5 min idle disconnect
        CACHE_TTL: 600000              // 10 min cache lifetime
    },
    
    PERFORMANCE: {
        CONCURRENT_STREAMS: 3,         // Parallel downloads
        MEMORY_LIMIT: '1GB',           // Memory usage limit  
        GC_INTERVAL: 60000,            // Garbage collection
        LOG_LEVEL: 'info'              // Logging verbosity
    }
}
```

### **Audio Quality Settings**
```javascript
AUDIO_SETTINGS: {
    BITRATE: 'highestaudio',           // Maximum quality
    FILTER: 'audioonly',               // Audio-only streams
    VOLUME_RANGE: [1, 100],            // Volume limits
    BASS_BOOST: [-5, 15],              // Bass range (dB)
    SPEED_RANGE: [0.5, 2.0]            // Speed multiplier
}
```

## 📊 Performance Monitoring

### **Real-Time Statistics**
- **Response Time**: Command execution speed
- **Memory Usage**: RAM consumption tracking
- **Cache Hit Rate**: Performance optimization metrics  
- **Error Rate**: Reliability monitoring
- **Uptime**: Service availability stats

### **Health Monitoring**
```bash
# Check bot performance
!status

# Sample Output:
🤖 Bot Status
🏓 Ping: 45ms
📡 WebSocket: 28ms  
⏱️ Uptime: 2d 14h 32m
🖥️ Memory: 234MB / 1GB
🎵 Active Players: 12
⚡ Cache Hit Rate: 94.2%
```

## 🚀 Deployment Options

### **Replit (Recommended)**
```bash
# Already configured for Replit
# Just add DISCORD_TOKEN to Secrets
# Click Run button ▶️
```

### **Production Deployment**
```yaml
# docker-compose.yml
version: '3.8'
services:
  echotune:
    build: .
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - NODE_ENV=production
    restart: unless-stopped
    mem_limit: 1g
    logging:
      options:
        max-size: "10m"
        max-file: "3"
```

### **Monitoring Setup**
```javascript
// Optional: Add monitoring
const monitor = {
    trackMemory: () => process.memoryUsage(),
    trackLatency: () => Date.now() - commandStart,  
    trackErrors: (error) => console.error(error),
    generateReport: () => generatePerformanceReport()
}
```

## 🔍 Troubleshooting

### **Common Issues**

#### **Music Not Playing**
```bash
# Check logs for parsing errors
!status                    # View bot status
# Try alternative search terms
# Use direct YouTube URLs instead of search
```

#### **Performance Issues**
```bash
# Clear cache manually
# Restart bot if memory usage high
# Check network connectivity
# Reduce queue size if needed
```

#### **Voice Channel Issues**  
```bash
# Verify bot permissions:
# ✅ Connect to Voice Channels
# ✅ Speak in Voice Channels  
# ✅ Use Voice Activity
# ✅ Priority Speaker (optional)
```

### **Debug Commands**
```javascript
// Enable debug logging
process.env.DEBUG = 'discord:*';

// Performance profiling
console.time('command-execution');
// ... command logic ...
console.timeEnd('command-execution');
```

## 🤝 Contributing

### **Development Setup**
```bash
git clone <repository>
cd discord-music-bot
npm install
npm run dev          # Development mode with hot reload
```

### **Code Standards**
- **ES2022 Syntax**: Modern JavaScript features
- **Async/Await**: Promise-based architecture  
- **Error Handling**: Comprehensive try-catch blocks
- **Performance**: Efficient algorithms and caching
- **Documentation**: JSDoc comments for functions

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

## 🎉 Features Showcase

✅ **25+ Commands** - Complete music control  
✅ **Smart Caching** - Lightning-fast responses  
✅ **Auto-Playlists** - Intelligent music discovery  
✅ **Vote System** - Democratic music control  
✅ **Audio Filters** - Enhanced sound experience  
✅ **Performance Monitoring** - Real-time statistics  
✅ **Multi-Language** - Hindi + English support  
✅ **Crash-Proof** - Advanced error handling  
✅ **Memory Optimized** - Efficient resource usage  
✅ **Interactive UI** - Button-based controls  

---

**⚡ Built for Performance • 🎵 Optimized for Music • 💎 Crafted with Care**

**⭐ Star this repository if EchoTune enhanced your Discord server!**