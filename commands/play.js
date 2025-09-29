const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const play = require('play-dl');
const YouTube = require('youtube-sr').default;

// Constants
const ERROR_MESSAGES = {
    NO_MEMBER: '❌ Member information not available. Please try again.',
    NO_VOICE_CHANNEL: '❌ आपको पहले किसी voice channel में join करना होगा!',
    NO_RESULTS: '❌ कोई गाना नहीं मिला! दूसरा नाम try करें।',
    PLAYBACK_ERROR: '❌ गाना play करने में error हुई! दूसरा गाना try करें।'
};

// Initialize YouTube API if available
if (process.env.YT_API_KEY) {
    play.setToken({
        youtube: { api_key: process.env.YT_API_KEY }
    });
} else {
    console.warn('⚠️ YT_API_KEY ENV variable not set! Rate limits may occur.');
}

class MusicService {
    /**
     * Search for a video using play-dl or fallback to youtube-sr
     */
    static async searchVideo(query) {
        try {
            if (play.yt_validate(query) === 'video') {
                const info = await play.video_info(query);
                return {
                    url: info.url,
                    title: info.title,
                    duration: info.durationInSec,
                    thumbnail: info.thumbnails[0]?.url
                };
            }

            const searchResults = await play.search(query, { limit: 1 });
            if (!searchResults?.length) {
                throw new Error('No results found');
            }

            const video = searchResults[0];
            return {
                url: video.url,
                title: video.title,
                duration: video.durationInSec,
                thumbnail: video.thumbnails[0]?.url
            };
        } catch (error) {
            console.warn('⚠️ play-dl error, falling back to youtube-sr:', error.message);
            
            const searchResults = await YouTube.search(query, { limit: 1 });
            if (!searchResults?.length) {
                throw new Error('No results found');
            }

            const video = searchResults[0];
            return {
                url: video.url,
                title: video.title,
                duration: video.durationInSec || 0,
                thumbnail: video.thumbnail?.url
            };
        }
    }

    /**
     * Create song object from video data
     */
    static createSongObject(videoData, user) {
        return {
            title: videoData.title,
            url: videoData.url,
            duration: videoData.duration,
            thumbnail: videoData.thumbnail,
            requestedBy: user
        };
    }

    /**
     * Join voice channel and setup audio player
     */
    static setupVoiceConnection(voiceChannel, guild) {
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            // Create audio player if not exists
            if (!global.audioPlayers) global.audioPlayers = new Map();
            if (!global.audioPlayers.has(guild.id)) {
                const player = createAudioPlayer();
                global.audioPlayers.set(guild.id, player);
                connection.subscribe(player);
            }

            return connection;
        } catch (error) {
            console.log('Voice connection setup:', error.message);
            return null;
        }
    }

    /**
     * Play the next song in queue
     */
    static async playNext(guildId) {
        const queue = global.queues.get(guildId);
        if (!queue || queue.length === 0) return;

        const song = queue[0];
        const player = global.audioPlayers.get(guildId);
        
        if (!player) return;

        try {
            const stream = await play.stream(song.url);
            const resource = createAudioResource(stream.stream, {
                inputType: stream.type
            });
            
            player.play(resource);
            
            player.on('idle', () => {
                // Remove current song and play next
                queue.shift();
                this.playNext(guildId);
            });

        } catch (error) {
            console.error('Playback error:', error);
            queue.shift();
            this.playNext(guildId);
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('YouTube URL या गाने का नाम से play करें')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('YouTube URL या गाने का नाम')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const member = interaction.member;
        if (!member) {
            return interaction.editReply(ERROR_MESSAGES.NO_MEMBER);
        }

        const voiceChannel = member.voice?.channel;
        if (!voiceChannel) {
            return interaction.editReply(ERROR_MESSAGES.NO_VOICE_CHANNEL);
        }

        const query = interaction.options.getString('query');
        if (!query?.trim()) {
            return interaction.editReply('❌ कृपया valid query provide करें!');
        }

        try {
            // Search for video
            const videoData = await MusicService.searchVideo(query);
            const song = MusicService.createSongObject(videoData, interaction.user);

            // Setup voice connection
            MusicService.setupVoiceConnection(voiceChannel, interaction.guild);

            // Get or create queue
            if (!global.queues) global.queues = new Map();
            const guildId = interaction.guild.id;
            
            if (!global.queues.has(guildId)) {
                global.queues.set(guildId, []);
            }

            const queue = global.queues.get(guildId);
            queue.push(song);

            // Check if already playing
            const player = global.audioPlayers.get(guildId);
            const isPlaying = player && player.state.status !== 'idle';

            if (isPlaying) {
                return interaction.editReply(`📋 **${song.title}** को queue में add कर दिया! Position: ${queue.length}`);
            } else {
                await MusicService.playNext(guildId);
                return interaction.editReply(`🎵 अब play हो रहा है: **${song.title}**`);
            }

        } catch (error) {
            console.error('Play command execution error:', error);
            
            if (error.message.includes('No results found')) {
                return interaction.editReply(ERROR_MESSAGES.NO_RESULTS);
            }
            
            return interaction.editReply(ERROR_MESSAGES.PLAYBACK_ERROR);
        }
    },
};