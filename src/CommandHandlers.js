const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource,
    AudioPlayerStatus,
    entersState,
    VoiceConnectionStatus,
    getVoiceConnection
} = require('@discordjs/voice');
const play = require('play-dl');
const { getQueue, setQueue } = require('./QueueManager');
const { searchVideo } = require('./MusicService');

// Lavalink available nahi hai
const lavalinkAvailable = false;

// Global audio players store
const audioPlayers = new Map();
const connections = new Map();

/**
 * Handle play command
 */
async function handlePlayCommand(message, args) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.reply('❌ You need to be in a voice channel to play music!');
    }

    const query = args.join(' ');
    if (!query) {
        return message.reply('❌ Please provide a song name or YouTube URL!');
    }

    try {
        await message.channel.send('🔍 Searching for your song...');

        // Search for video
        const videoData = await searchVideo(query);
        if (!videoData) {
            return message.reply('❌ No results found! Please try a different search.');
        }

        const song = {
            title: videoData.title,
            url: videoData.url,
            duration: videoData.duration,
            thumbnail: videoData.thumbnail,
            requestedBy: message.author
        };

        // Setup voice connection if not exists
        if (!connections.has(message.guild.id)) {
            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });
                
                connections.set(message.guild.id, connection);
                
                // Wait for connection to be ready
                try {
                    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
                } catch (error) {
                    console.error('Voice connection failed:', error);
                    connections.delete(message.guild.id);
                    return message.reply('❌ Failed to connect to voice channel!');
                }
            } catch (error) {
                console.error('Voice connection error:', error);
                return message.reply('❌ Failed to join voice channel!');
            }
        }

        // Setup audio player if not exists
        if (!audioPlayers.has(message.guild.id)) {
            const player = createAudioPlayer();
            audioPlayers.set(message.guild.id, player);
            
            const connection = connections.get(message.guild.id);
            if (connection) {
                connection.subscribe(player);

                // Handle player events
                player.on(AudioPlayerStatus.Idle, () => {
                    setTimeout(() => {
                        playNext(message.guild.id, message);
                    }, 1000);
                });

                player.on('error', error => {
                    console.error('Audio player error:', error);
                    if (message.channel) {
                        message.channel.send('❌ Playback error! Skipping to next song.');
                    }
                    setTimeout(() => {
                        playNext(message.guild.id, message);
                    }, 1000);
                });
            }
        }

        // Get or create queue
        let queue = getQueue(message.guild.id);
        if (!queue) {
            queue = [];
            setQueue(message.guild.id, queue);
        }

        // Add song to queue
        queue.push(song);

        const player = audioPlayers.get(message.guild.id);
        const isPlaying = player && player.state.status === AudioPlayerStatus.Playing;

        if (isPlaying && queue.length > 1) {
            const embed = {
                color: 0x0099ff,
                title: '📋 Added to Queue',
                description: `**${song.title}**`,
                fields: [
                    {
                        name: 'Position',
                        value: `#${queue.length}`,
                        inline: true
                    },
                    {
                        name: 'Requested By',
                        value: song.requestedBy.username,
                        inline: true
                    }
                ],
                thumbnail: {
                    url: song.thumbnail
                },
                timestamp: new Date()
            };
            return message.channel.send({ embeds: [embed] });
        } else {
            await playNext(message.guild.id, message);
            const embed = {
                color: 0x00ff00,
                title: '🎵 Now Playing',
                description: `**${song.title}**`,
                fields: [
                    {
                        name: 'Duration',
                        value: formatDuration(song.duration),
                        inline: true
                    },
                    {
                        name: 'Requested By',
                        value: song.requestedBy.username,
                        inline: true
                    }
                ],
                thumbnail: {
                    url: song.thumbnail
                },
                timestamp: new Date()
            };
            return message.channel.send({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Play command error:', error);
        
        if (error.message.includes('429')) {
            return message.reply('❌ YouTube rate limit exceeded! Please try again in a few minutes.');
        }
        
        return message.reply('❌ Error playing song! Please try again.');
    }
}

/**
 * Format duration from seconds to MM:SS
 */
function formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Play next song in queue
 */
async function playNext(guildId, message = null) {
    const queue = getQueue(guildId);
    if (!queue || queue.length === 0) {
        if (message && message.channel) {
            const embed = {
                color: 0xff6b6b,
                title: '🏁 Queue Finished',
                description: 'No more songs in the queue!',
                timestamp: new Date()
            };
            message.channel.send({ embeds: [embed] });
        }
        
        // Cleanup
        const player = audioPlayers.get(guildId);
        if (player) {
            player.stop();
        }
        
        // Leave voice channel after 5 minutes if no activity
        setTimeout(() => {
            const currentQueue = getQueue(guildId);
            if (!currentQueue || currentQueue.length === 0) {
                const connection = connections.get(guildId);
                if (connection) {
                    connection.destroy();
                    connections.delete(guildId);
                }
                audioPlayers.delete(guildId);
            }
        }, 300000); // 5 minutes
        
        return;
    }

    const song = queue[0];
    const player = audioPlayers.get(guildId);

    if (!player) {
        console.error('No audio player found for guild:', guildId);
        return;
    }

    try {
        // Get stream from YouTube
        const stream = await play.stream(song.url, {
            quality: 2, // 0 = low, 1 = medium, 2 = high
            seek: 0
        });
        
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true
        });

        // Set volume
        if (resource.volume) {
            resource.volume.setVolume(0.7); // 70% volume
        }

        player.play(resource);

        // Remove the currently playing song from queue
        queue.shift();
        setQueue(guildId, queue);

        if (message && message.channel) {
            const embed = {
                color: 0x00ff00,
                title: '🎵 Now Playing',
                description: `**${song.title}**`,
                fields: [
                    {
                        name: 'Duration',
                        value: formatDuration(song.duration),
                        inline: true
                    },
                    {
                        name: 'Requested By',
                        value: song.requestedBy.username,
                        inline: true
                    }
                ],
                thumbnail: {
                    url: song.thumbnail
                },
                timestamp: new Date()
            };
            message.channel.send({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Playback error:', error);
        
        // Remove failed song and try next
        if (queue.length > 0) {
            queue.shift();
            setQueue(guildId, queue);
        }
        
        if (message && message.channel) {
            message.channel.send('❌ Error playing song! Skipping to next.');
        }
        
        setTimeout(() => {
            playNext(guildId, message);
        }, 1000);
    }
}

/**
 * Handle skip command
 */
async function handleSkipCommand(message, args) {
    const queue = getQueue(message.guild.id);
    if (!queue || queue.length === 0) {
        return message.reply('❌ No songs in queue to skip!');
    }

    const player = audioPlayers.get(message.guild.id);
    if (player) {
        player.stop();
        
        const embed = {
            color: 0xffa500,
            title: '⏭️ Skipped',
            description: 'Skipped the current song!',
            timestamp: new Date()
        };
        message.reply({ embeds: [embed] });
    } else {
        message.reply('❌ No music is currently playing!');
    }
}

/**
 * Handle stop command
 */
async function handleStopCommand(message, args) {
    const queue = getQueue(message.guild.id);
    if (!queue || queue.length === 0) {
        return message.reply('❌ No music is playing!');
    }

    // Clear queue
    setQueue(message.guild.id, []);

    const player = audioPlayers.get(message.guild.id);
    if (player) {
        player.stop();
    }

    const embed = {
        color: 0xff0000,
        title: '🛑 Stopped',
        description: 'Stopped playback and cleared the queue!',
        timestamp: new Date()
    };
    message.reply({ embeds: [embed] });
}

/**
 * Handle queue command
 */
async function handleQueueCommand(message, args) {
    const queue = getQueue(message.guild.id);
    if (!queue || queue.length === 0) {
        return message.reply('📭 Queue is empty!');
    }

    const queueList = queue.slice(0, 10).map((song, index) => 
        `**${index + 1}.** ${song.title} - ${formatDuration(song.duration)}\n   👤 ${song.requestedBy.username}`
    ).join('\n\n');

    const totalDuration = queue.reduce((total, song) => total + (song.duration || 0), 0);
    
    const embed = {
        color: 0x0099ff,
        title: '📋 Current Queue',
        description: queueList,
        fields: [
            {
                name: 'Total Songs',
                value: queue.length.toString(),
                inline: true
            },
            {
                name: 'Total Duration',
                value: formatDuration(totalDuration),
                inline: true
            }
        ],
        timestamp: new Date()
    };

    if (queue.length > 10) {
        embed.footer = {
            text: `And ${queue.length - 10} more songs...`
        };
    }

    message.channel.send({ embeds: [embed] });
}

/**
 * Handle join command
 */
async function handleJoinCommand(message, args) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.reply('❌ You need to be in a voice channel to use this command!');
    }

    // Lavalink available nahi hai - fixed variable
    const lavalinkAvailable = false;

    try {
        if (lavalinkAvailable) {
            // Lavalink code (currently disabled)
            message.reply('🔗 Lavalink is currently not available.');
        } else {
            // Discord.js voice connection
            if (connections.has(message.guild.id)) {
                const existingConnection = connections.get(message.guild.id);
                if (existingConnection.joinConfig.channelId === voiceChannel.id) {
                    return message.reply('✅ Already connected to your voice channel!');
                }
                
                // Move to different channel
                existingConnection.destroy();
                connections.delete(message.guild.id);
            }

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            connections.set(message.guild.id, connection);
            
            const embed = {
                color: 0x00ff00,
                title: '✅ Joined Voice Channel',
                description: `Connected to **${voiceChannel.name}**`,
                timestamp: new Date()
            };
            message.reply({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Join command error:', error);
        message.reply('❌ Failed to join voice channel!');
    }
}

/**
 * Handle leave command
 */
async function handleLeaveCommand(message, args) {
    // Lavalink available nahi hai - fixed variable
    const lavalinkAvailable = false;

    try {
        if (lavalinkAvailable) {
            // Lavalink disconnect code
            message.reply('🔗 Lavalink disconnect not available.');
        } else {
            // Discord.js voice disconnect
            const connection = connections.get(message.guild.id);
            if (connection) {
                connection.destroy();
                connections.delete(message.guild.id);
            }

            const player = audioPlayers.get(message.guild.id);
            if (player) {
                player.stop();
                audioPlayers.delete(message.guild.id);
            }

            // Clear queue
            setQueue(message.guild.id, []);

            const embed = {
                color: 0xff6b6b,
                title: '👋 Left Voice Channel',
                description: 'Disconnected from voice channel and cleared queue!',
                timestamp: new Date()
            };
            message.reply({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Leave command error:', error);
        message.reply('❌ Failed to leave voice channel!');
    }
}

/**
 * Handle pause command
 */
async function handlePauseCommand(message, args) {
    const player = audioPlayers.get(message.guild.id);
    if (!player) {
        return message.reply('❌ No music is playing!');
    }

    if (player.state.status === AudioPlayerStatus.Paused) {
        return message.reply('⏸️ Music is already paused!');
    }

    player.pause();
    
    const embed = {
        color: 0xffa500,
        title: '⏸️ Paused',
        description: 'Music playback has been paused!',
        timestamp: new Date()
    };
    message.reply({ embeds: [embed] });
}

/**
 * Handle resume command
 */
async function handleResumeCommand(message, args) {
    const player = audioPlayers.get(message.guild.id);
    if (!player) {
        return message.reply('❌ No music is playing!');
    }

    if (player.state.status === AudioPlayerStatus.Playing) {
        return message.reply('▶️ Music is already playing!');
    }

    player.unpause();
    
    const embed = {
        color: 0x00ff00,
        title: '▶️ Resumed',
        description: 'Music playback has been resumed!',
        timestamp: new Date()
    };
    message.reply({ embeds: [embed] });
}

/**
 * Handle volume command
 */
async function handleVolumeCommand(message, args) {
    const volume = parseInt(args[0]);
    if (isNaN(volume) || volume < 0 || volume > 100) {
        return message.reply('❌ Please provide a volume between 0 and 100!');
    }

    const player = audioPlayers.get(message.guild.id);
    if (!player) {
        return message.reply('❌ No music is playing!');
    }

    // Note: Volume control requires additional implementation
    // This is a placeholder for future implementation
    
    const embed = {
        color: 0x0099ff,
        title: '🔊 Volume',
        description: `Volume set to ${volume}%`,
        footer: {
            text: 'Note: Volume control requires additional implementation'
        },
        timestamp: new Date()
    };
    message.reply({ embeds: [embed] });
}

/**
 * Handle now playing command
 */
async function handleNowPlayingCommand(message, args) {
    const queue = getQueue(message.guild.id);
    if (!queue || queue.length === 0) {
        return message.reply('❌ No music is currently playing!');
    }

    const currentSong = queue[0];
    const player = audioPlayers.get(message.guild.id);
    
    if (!player || player.state.status !== AudioPlayerStatus.Playing) {
        return message.reply('❌ No music is currently playing!');
    }

    const embed = {
        color: 0x00ff00,
        title: '🎵 Now Playing',
        description: `**${currentSong.title}**`,
        fields: [
            {
                name: 'Duration',
                value: formatDuration(currentSong.duration),
                inline: true
            },
            {
                name: 'Requested By',
                value: currentSong.requestedBy.username,
                inline: true
            }
        ],
        thumbnail: {
            url: currentSong.thumbnail
        },
        timestamp: new Date()
    };

    message.channel.send({ embeds: [embed] });
}

/**
 * Cleanup function for when bot shuts down
 */
function cleanupGuild(guildId) {
    const connection = connections.get(guildId);
    if (connection) {
        connection.destroy();
        connections.delete(guildId);
    }

    const player = audioPlayers.get(guildId);
    if (player) {
        player.stop();
        audioPlayers.delete(guildId);
    }

    setQueue(guildId, []);
}

module.exports = {
    handlePlayCommand,
    handleSkipCommand,
    handleStopCommand,
    handleQueueCommand,
    handleJoinCommand,
    handleLeaveCommand,
    handlePauseCommand,
    handleResumeCommand,
    handleVolumeCommand,
    handleNowPlayingCommand,
    playNext,
    cleanupGuild,
    audioPlayers,
    connections
};