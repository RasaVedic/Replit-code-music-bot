module.exports = {
    // Bot Configuration
    BOT: {
        TOKEN: process.env.DISCORD_TOKEN,
        PREFIX: '!',
        MAX_QUEUE_SIZE: 500,
        DEFAULT_VOLUME: 50,
        OWNER_IDS: ['YOUR_USER_ID'], // Add your Discord user ID here
    },

    // Lavalink Configuration
    LAVALINK: {
        HOST: 'localhost',
        PORT: 2333,
        PASSWORD: 'youshallnotpass',
        SECURE: false,
        IDENTIFIER: 'main-node'
    },

    // Command Aliases
    ALIASES: {
        // Play commands
        'p': 'play',
        'pl': 'play',
        'music': 'play',
        
        // Skip commands
        's': 'skip',
        'sk': 'skip',
        'next': 'skip',
        
        // Queue commands
        'q': 'queue',
        'qu': 'queue',
        'list': 'queue',
        
        // Volume commands
        'v': 'volume',
        'vol': 'volume',
        
        // Loop commands
        'l': 'loop',
        'repeat': 'loop',
        
        // Stop commands
        'stp': 'stop',
        'halt': 'stop',
        'disconnect': 'stop',
        'dc': 'stop',
        
        // Status commands
        'st': 'status',
        'stat': 'status',
        'ping': 'status',
        
        // New audio commands
        'ly': 'lyrics',
        'eq': 'equalizer',
        
        // Pause commands
        'pause': 'pause',
        'resume': 'resume',
        
        // Help commands
        'h': 'help',
        'commands': 'help',
        'cmd': 'help',
        
        // Prefix commands
        'prefix': 'setprefix',
        'changeprefix': 'setprefix',
        
        // Search commands
        'search': 'search',
        'find': 'search',
        
        // Shuffle commands
        'shuffle': 'shuffle',
        'mix': 'shuffle',
        
        // Clear commands
        'clear': 'clear',
        'empty': 'clear',
        
        // Now playing commands
        'np': 'nowplaying',
        'current': 'nowplaying',
        'playing': 'nowplaying'
    },

    // Colors for embeds
    COLORS: {
        SUCCESS: '#00ff00',
        ERROR: '#ff0000',
        WARNING: '#ffff00',
        INFO: '#00ffff',
        MUSIC: '#9932cc',
        QUEUE: '#ff69b4'
    },

    // Emojis
    EMOJIS: {
        PLAY: '▶️',
        PAUSE: '⏸️',
        STOP: '⏹️',
        SKIP: '⏭️',
        PREVIOUS: '⏮️',
        VOLUME: '🔊',
        QUEUE: '📋',
        LOOP: '🔂',
        SHUFFLE: '🔀',
        MUSIC: '🎵',
        SUCCESS: '✅',
        ERROR: '❌',
        WARNING: '⚠️',
        LOADING: '⏳',
        AUTO: '🤖'
    },

    // Language translations
    MESSAGES: {
        hi: {
            NO_VOICE_CHANNEL: '❌ पहले किसी voice channel में join करें!',
            BOT_NO_PERMISSION: '❌ मुझे इस voice channel में join करने की permission नहीं है!',
            NO_SONG_PLAYING: '❌ कोई गाना play नहीं हो रहा है!',
            QUEUE_EMPTY: '❌ Queue empty है!',
            SONG_ADDED: '✅ गाना queue में add हो गया:',
            NOW_PLAYING: '🎵 अब play हो रहा है:',
            SONG_SKIPPED: '⏭️ गाना skip कर दिया:',
            MUSIC_STOPPED: '⏹️ Music stop कर दिया!',
            MUSIC_PAUSED: '⏸️ Music pause कर दिया!',
            MUSIC_RESUMED: '▶️ Music resume कर दिया!',
            VOLUME_SET: '🔊 Volume set कर दिया:',
            PREFIX_CHANGED: '✅ Server prefix change हो गया:',
            AUTOPLAY_ON: '🤖 Autoplay on कर दिया!',
            AUTOPLAY_OFF: '🤖 Autoplay off कर दिया!',
            LOOP_ON: '🔂 Loop mode on कर दिया!',
            LOOP_OFF: '➡️ Loop mode off कर दिया!',
            QUEUE_CLEARED: '🗑️ Queue clear कर दी!',
            QUEUE_SHUFFLED: '🔀 Queue shuffle कर दी!',
            NO_RESULTS: '❌ कोई result नहीं मिला!',
            ERROR_OCCURRED: '❌ कोई error आई है, कृपया बाद में try करें!',
            LOADING: '⏳ Loading...'
        },
        en: {
            NO_VOICE_CHANNEL: '❌ You need to join a voice channel first!',
            BOT_NO_PERMISSION: '❌ I don\'t have permission to join this voice channel!',
            NO_SONG_PLAYING: '❌ No song is currently playing!',
            QUEUE_EMPTY: '❌ Queue is empty!',
            SONG_ADDED: '✅ Song added to queue:',
            NOW_PLAYING: '🎵 Now playing:',
            SONG_SKIPPED: '⏭️ Skipped song:',
            MUSIC_STOPPED: '⏹️ Music stopped!',
            MUSIC_PAUSED: '⏸️ Music paused!',
            MUSIC_RESUMED: '▶️ Music resumed!',
            VOLUME_SET: '🔊 Volume set to:',
            PREFIX_CHANGED: '✅ Server prefix changed to:',
            AUTOPLAY_ON: '🤖 Autoplay enabled!',
            AUTOPLAY_OFF: '🤖 Autoplay disabled!',
            LOOP_ON: '🔂 Loop mode enabled!',
            LOOP_OFF: '➡️ Loop mode disabled!',
            QUEUE_CLEARED: '🗑️ Queue cleared!',
            QUEUE_SHUFFLED: '🔀 Queue shuffled!',
            NO_RESULTS: '❌ No results found!',
            ERROR_OCCURRED: '❌ An error occurred, please try again later!',
            LOADING: '⏳ Loading...'
        }
    },

    // Music sources priority
    SOURCES: {
        YOUTUBE: 'ytsearch',
        SPOTIFY: 'spsearch',
        SOUNDCLOUD: 'scsearch',
        DEFAULT: 'ytsearch'
    }
};