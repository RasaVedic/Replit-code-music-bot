const { AudioPlayerStatus } = require('@discordjs/voice');
const { getQueue } = require('../utils/QueueManager');
const { playFallbackTrack, cleanupFallbackPlayer, lavalinkManager, lavalinkAvailable } = require('./MusicPlayer');
const { toUnifiedTrack } = require('../utils/TrackHelpers');
const config = require('../config/botConfig');

// Handle button interactions
async function handleButtonInteraction(interaction, guildSettings) {
    const lang = guildSettings.language || 'hi';
    const queue = getQueue(interaction.guild.id);

    try {
        await interaction.deferReply({ ephemeral: true });

        if (!queue || !queue.nowPlaying) {
            return await interaction.editReply({
                content: lang === 'hi' 
                    ? '📭 कोई गाना play नहीं हो रहा है!'
                    : '📭 No music is currently playing!',
                ephemeral: true
            });
        }

        // Handle button actions
        switch (interaction.customId) {
            case 'music_pause':
                if (lavalinkAvailable && lavalinkManager) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) {
                        if (player.paused) {
                            await player.resume();
                            await interaction.editReply({ 
                                content: '▶️ Resumed!',
                                ephemeral: true 
                            });
                        } else {
                            await player.pause();
                            await interaction.editReply({ 
                                content: '⏸️ Paused!',
                                ephemeral: true 
                            });
                        }
                    }
                } else {
                    // Fallback pause/resume
                    const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                    if (audioPlayer) {
                        if (audioPlayer.state.status === AudioPlayerStatus.Paused) {
                            audioPlayer.unpause();
                            await interaction.editReply({ 
                                content: '▶️ Resumed!',
                                ephemeral: true 
                            });
                        } else {
                            audioPlayer.pause();
                            await interaction.editReply({ 
                                content: '⏸️ Paused!',
                                ephemeral: true 
                            });
                        }
                    }
                }
                break;

            case 'music_skip':
                if (lavalinkAvailable && lavalinkManager) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) {
                        await player.skip();
                        await interaction.editReply({ 
                            content: '⏭️ Skipped!',
                            ephemeral: true 
                        });
                    }
                } else {
                    // Fallback skip
                    const nextTrack = queue.next();
                    if (nextTrack) {
                        const unifiedTrack = toUnifiedTrack(nextTrack, 'fallback');
                        queue.nowPlaying = unifiedTrack;
                        await playFallbackTrack(interaction.guild.id, nextTrack);
                        await interaction.editReply({ 
                            content: '⏭️ Skipped!',
                            ephemeral: true 
                        });
                    } else {
                        queue.nowPlaying = null;
                        const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                        if (audioPlayer) audioPlayer.stop();
                        await interaction.editReply({ 
                            content: '⏹️ Queue ended!',
                            ephemeral: true 
                        });
                    }
                }
                break;

            case 'music_stop':
                if (lavalinkAvailable && lavalinkManager) {
                    const player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (player) {
                        await player.destroy();
                    }
                } else {
                    // Fallback stop
                    const audioPlayer = global.audioPlayers.get(interaction.guild.id);
                    if (audioPlayer) audioPlayer.stop();
                    cleanupFallbackPlayer(interaction.guild.id);
                }
                queue.clear();
                queue.nowPlaying = null;
                await interaction.editReply({ 
                    content: '⏹️ Stopped and cleared queue!',
                    ephemeral: true 
                });
                break;

            case 'music_shuffle':
                if (queue.isEmpty()) {
                    await interaction.editReply({ 
                        content: '📭 Queue is empty!',
                        ephemeral: true 
                    });
                } else {
                    queue.shuffle();
                    await interaction.editReply({ 
                        content: '🔀 Queue shuffled!',
                        ephemeral: true 
                    });
                }
                break;

            case 'music_loop':
                queue.loop = !queue.loop;
                await interaction.editReply({ 
                    content: `🔁 Loop ${queue.loop ? 'ON' : 'OFF'}!`,
                    ephemeral: true 
                });
                break;

            case 'music_autoplay':
                queue.autoplay = !queue.autoplay;
                await interaction.editReply({ 
                    content: `🎵 Autoplay ${queue.autoplay ? 'ON' : 'OFF'}!`,
                    ephemeral: true 
                });
                break;

            case 'music_queue':
                let queueText = '';
                if (queue.nowPlaying) {
                    const title = queue.nowPlaying.info?.title || queue.nowPlaying.title;
                    const author = queue.nowPlaying.info?.author || queue.nowPlaying.author;
                    queueText += `**Now Playing:**\n${title} - ${author}\n\n`;
                }
                if (queue.songs.length > 0) {
                    queueText += '**Up Next:**\n';
                    for (let i = 0; i < Math.min(queue.songs.length, 5); i++) {
                        const track = queue.songs[i];
                        const title = track.info?.title || track.title;
                        const author = track.info?.author || track.author;
                        queueText += `${i + 1}. ${title} - ${author}\n`;
                    }
                    if (queue.songs.length > 5) {
                        queueText += `\n...and ${queue.songs.length - 5} more songs`;
                    }
                } else {
                    queueText += 'Queue is empty!';
                }
                await interaction.editReply({ 
                    content: queueText,
                    ephemeral: true 
                });
                break;

            case 'music_previous':
                const prevTrack = queue.previous();
                if (prevTrack) {
                    if (lavalinkAvailable && lavalinkManager) {
                        const player = lavalinkManager.getPlayer(interaction.guild.id);
                        if (player) {
                            await player.play({ track: prevTrack.encoded });
                        }
                    } else {
                        const unifiedTrack = toUnifiedTrack(prevTrack, 'fallback');
                        queue.nowPlaying = unifiedTrack;
                        await playFallbackTrack(interaction.guild.id, prevTrack);
                    }
                    await interaction.editReply({ 
                        content: `⏮️ Playing previous: **${prevTrack.info?.title || prevTrack.title}**`,
                        ephemeral: true 
                    });
                } else {
                    await interaction.editReply({ 
                        content: 'No previous song available!',
                        ephemeral: true 
                    });
                }
                break;

            default:
                await interaction.editReply({ 
                    content: 'Unknown button action!',
                    ephemeral: true 
                });
        }

    } catch (error) {
        console.error('Button interaction error:', error);
        try {
            await interaction.editReply({ 
                content: 'Error processing button action!',
                ephemeral: true 
            });
        } catch (e) {
            console.error('Error sending error reply:', e);
        }
    }
}

module.exports = {
    handleButtonInteraction
};