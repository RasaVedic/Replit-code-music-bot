const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType,
    EmbedBuilder
} = require('discord.js');
const { getQueue, setQueue } = require('./QueueManager');
const { audioPlayers, playNext } = require('./CommandHandlers');
const { AudioPlayerStatus } = require('@discordjs/voice');

/**
 * Handle music control buttons
 */
async function handleMusicControls(interaction) {
    if (!interaction.isButton()) return;

    const { customId, guildId, message } = interaction;
    const queue = getQueue(guildId);
    
    // Defer the reply immediately
    await interaction.deferReply({ ephemeral: true });

    try {
        switch (customId) {
            case 'pause_resume':
                await handlePauseResume(interaction, queue);
                break;
            case 'skip':
                await handleSkip(interaction, queue);
                break;
            case 'stop':
                await handleStop(interaction, queue);
                break;
            case 'queue':
                await handleQueue(interaction, queue);
                break;
            case 'volume_up':
                await handleVolumeUp(interaction);
                break;
            case 'volume_down':
                await handleVolumeDown(interaction);
                break;
            case 'shuffle':
                await handleShuffle(interaction, queue);
                break;
            case 'loop':
                await handleLoop(interaction);
                break;
            default:
                await interaction.editReply({
                    content: '❌ Unknown button action!',
                    ephemeral: true
                });
        }
    } catch (error) {
        console.error('Button handler error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while processing your request!',
            ephemeral: true
        });
    }
}

/**
 * Handle pause/resume button
 */
async function handlePauseResume(interaction, queue) {
    const player = audioPlayers.get(interaction.guildId);
    
    if (!player || !queue || queue.length === 0) {
        return await interaction.editReply({
            content: '❌ No music is currently playing!',
            ephemeral: true
        });
    }

    if (player.state.status === AudioPlayerStatus.Playing) {
        player.pause();
        await interaction.editReply({
            content: '⏸️ Music paused!',
            ephemeral: true
        });
        
        // Update button in original message if possible
        await updateControlButtons(interaction, true);
    } else if (player.state.status === AudioPlayerStatus.Paused) {
        player.unpause();
        await interaction.editReply({
            content: '▶️ Music resumed!',
            ephemeral: true
        });
        
        // Update button in original message if possible
        await updateControlButtons(interaction, false);
    } else {
        await interaction.editReply({
            content: '❌ Player is not in a valid state!',
            ephemeral: true
        });
    }
}

/**
 * Handle skip button
 */
async function handleSkip(interaction, queue) {
    const player = audioPlayers.get(interaction.guildId);
    
    if (!player || !queue || queue.length === 0) {
        return await interaction.editReply({
            content: '❌ No music to skip!',
            ephemeral: true
        });
    }

    player.stop();
    await interaction.editReply({
        content: '⏭️ Skipped to next song!',
        ephemeral: true
    });
}

/**
 * Handle stop button
 */
async function handleStop(interaction, queue) {
    const player = audioPlayers.get(interaction.guildId);
    
    if (!player || !queue || queue.length === 0) {
        return await interaction.editReply({
            content: '❌ No music is playing!',
            ephemeral: true
        });
    }

    // Clear queue
    setQueue(interaction.guildId, []);
    player.stop();
    
    await interaction.editReply({
        content: '🛑 Stopped playback and cleared queue!',
        ephemeral: true
    });
}

/**
 * Handle queue button
 */
async function handleQueue(interaction, queue) {
    if (!queue || queue.length === 0) {
        return await interaction.editReply({
            content: '📭 Queue is empty!',
            ephemeral: true
        });
    }

    const queueList = queue.slice(0, 10).map((song, index) => 
        `**${index + 1}.** ${song.title} - ${formatDuration(song.duration)}\n   👤 ${song.requestedBy.username}`
    ).join('\n\n');

    const totalDuration = queue.reduce((total, song) => total + (song.duration || 0), 0);
    
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('📋 Current Queue')
        .setDescription(queueList)
        .addFields(
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
        )
        .setTimestamp();

    if (queue.length > 10) {
        embed.setFooter({ text: `And ${queue.length - 10} more songs...` });
    }

    await interaction.editReply({
        embeds: [embed],
        ephemeral: true
    });
}

/**
 * Handle volume up button
 */
async function handleVolumeUp(interaction) {
    const player = audioPlayers.get(interaction.guildId);
    
    if (!player) {
        return await interaction.editReply({
            content: '❌ No music is playing!',
            ephemeral: true
        });
    }

    // Volume control placeholder
    // In a real implementation, you would adjust the volume here
    
    await interaction.editReply({
        content: '🔊 Volume increased! (Volume control needs implementation)',
        ephemeral: true
    });
}

/**
 * Handle volume down button
 */
async function handleVolumeDown(interaction) {
    const player = audioPlayers.get(interaction.guildId);
    
    if (!player) {
        return await interaction.editReply({
            content: '❌ No music is playing!',
            ephemeral: true
        });
    }

    // Volume control placeholder
    // In a real implementation, you would adjust the volume here
    
    await interaction.editReply({
        content: '🔉 Volume decreased! (Volume control needs implementation)',
        ephemeral: true
    });
}

/**
 * Handle shuffle button
 */
async function handleShuffle(interaction, queue) {
    if (!queue || queue.length <= 1) {
        return await interaction.editReply({
            content: queue?.length === 0 ? '📭 Queue is empty!' : '❌ Need at least 2 songs to shuffle!',
            ephemeral: true
        });
    }

    // Shuffle the queue (excluding currently playing song if any)
    const currentSong = queue[0];
    const remainingQueue = queue.slice(1);
    
    // Fisher-Yates shuffle algorithm
    for (let i = remainingQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingQueue[i], remainingQueue[j]] = [remainingQueue[j], remainingQueue[i]];
    }
    
    // Reconstruct queue with current song at top
    const shuffledQueue = [currentSong, ...remainingQueue];
    setQueue(interaction.guildId, shuffledQueue);
    
    await interaction.editReply({
        content: '🔀 Queue shuffled!',
        ephemeral: true
    });
}

/**
 * Handle loop button
 */
async function handleLoop(interaction) {
    // Get or initialize loop state for this guild
    if (!global.loopStates) global.loopStates = new Map();
    
    const currentState = global.loopStates.get(interaction.guildId) || 'off';
    let newState;
    let stateText;

    switch (currentState) {
        case 'off':
            newState = 'queue';
            stateText = '🔁 Queue Loop';
            break;
        case 'queue':
            newState = 'song';
            stateText = '🔂 Single Loop';
            break;
        case 'song':
            newState = 'off';
            stateText = '❌ Loop Off';
            break;
        default:
            newState = 'off';
            stateText = '❌ Loop Off';
    }

    global.loopStates.set(interaction.guildId, newState);
    
    await interaction.editReply({
        content: `${stateText} ${getLoopEmoji(newState)}`,
        ephemeral: true
    });
}

/**
 * Get loop emoji based on state
 */
function getLoopEmoji(state) {
    switch (state) {
        case 'queue': return '🔁';
        case 'song': return '🔂';
        default: return '❌';
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
 * Create music control buttons
 */
function createMusicControls() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('pause_resume')
                .setLabel('Pause/Resume')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⏯️'),
            new ButtonBuilder()
                .setCustomId('skip')
                .setLabel('Skip')
                .setStyle(ButtonStyle.Success)
                .setEmoji('⏭️'),
            new ButtonBuilder()
                .setCustomId('stop')
                .setLabel('Stop')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('⏹️'),
            new ButtonBuilder()
                .setCustomId('queue')
                .setLabel('Queue')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📋'),
            new ButtonBuilder()
                .setCustomId('loop')
                .setLabel('Loop')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔁')
        );
}

/**
 * Create additional control buttons
 */
function createAdditionalControls() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('volume_down')
                .setLabel('Volume -')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔉'),
            new ButtonBuilder()
                .setCustomId('volume_up')
                .setLabel('Volume +')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔊'),
            new ButtonBuilder()
                .setCustomId('shuffle')
                .setLabel('Shuffle')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔀')
        );
}

/**
 * Update control buttons in the original message
 */
async function updateControlButtons(interaction, isPaused) {
    try {
        if (interaction.message && interaction.message.editable) {
            const mainRow = createMusicControls();
            
            // Update pause/resume button based on current state
            const pauseResumeButton = mainRow.components[0];
            if (isPaused) {
                pauseResumeButton.setLabel('Resume').setEmoji('▶️');
            } else {
                pauseResumeButton.setLabel('Pause').setEmoji('⏸️');
            }
            
            await interaction.message.edit({
                components: [mainRow, createAdditionalControls()]
            });
        }
    } catch (error) {
        console.error('Error updating control buttons:', error);
    }
}

/**
 * Check if loop is enabled for a guild
 */
function isLoopEnabled(guildId) {
    if (!global.loopStates) return false;
    const state = global.loopStates.get(guildId);
    return state === 'queue' || state === 'song';
}

/**
 * Get loop state for a guild
 */
function getLoopState(guildId) {
    if (!global.loopStates) return 'off';
    return global.loopStates.get(guildId) || 'off';
}

/**
 * Handle loop logic when song ends
 */
function handleLoopLogic(guildId, queue, currentSong) {
    if (!global.loopStates) return false;
    
    const loopState = global.loopStates.get(guildId);
    
    if (loopState === 'song' && currentSong) {
        // Add current song back to the beginning of queue
        queue.unshift(currentSong);
        setQueue(guildId, queue);
        return true;
    }
    
    if (loopState === 'queue' && currentSong) {
        // Add current song to the end of queue
        queue.push(currentSong);
        setQueue(guildId, queue);
        return true;
    }
    
    return false;
}

module.exports = {
    handleMusicControls,
    createMusicControls,
    createAdditionalControls,
    isLoopEnabled,
    getLoopState,
    handleLoopLogic,
    updateControlButtons
};