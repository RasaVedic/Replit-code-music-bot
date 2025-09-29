const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const play = require('play-dl');
const YouTube = require('youtube-sr').default;

// Constants
const ERROR_MESSAGES = {
    NO_MEMBER: '❌ Member information not available. Please try again.',
    NO_VOICE_CHANNEL: '❌ आपको पहले किसी voice channel में join करना होगा!',
    NO_RESULTS: '❌ कोई गाना नहीं मिला! दूसरा नाम try करें।',
    PLAYBACK_ERROR: '❌ गाना play करने में error हुई! दूसरा गाना try करें।'
};

const SUCCESS_MESSAGES = {
    ADDED_TO_QUEUE: '📋 **{title}** को queue में add कर दिया! Position: {position}',
    NOW_PLAYING: '🎵 अब play हो रहा है: **{title}**'
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
     * @param {string} query - Search query or URL
     * @returns {Promise<Object>} Video information
     */
    static async searchVideo(query) {
        try {
            // Check if it's a valid YouTube URL
            if (play.yt_validate(query) === 'video') {
                const info = await play.video_info(query);
                return {
                    url: info.url,
                    title: info.title,
                    duration: info.durationInSec,
                    thumbnail: info.thumbnails[0]?.url
                };
            }

            // Search for video
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
            
            // Fallback to youtube-sr
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
     * @param {Object} videoData - Video information
     * @param {Object} user - User who requested the song
     * @returns {Object} Song object
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
     * Join voice channel
     * @param {Object} voiceChannel - Voice channel object
     * @param {Object} guild - Guild object
     * @returns {Object} Voice connection
     */
    static joinVoiceChannel(voiceChannel, guild) {
        try {
            return joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });
        } catch (error) {
            console.log('Voice connection already exists or error:', error.message);
            return null;
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

    /**
     * Execute play command
     * @param {Object} interaction - Discord interaction object
     */
    async execute(interaction) {
        await interaction.deferReply();

        // Validate member and voice channel
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
            
            // Create song object
            const song = MusicService.createSongObject(videoData, interaction.user);

            // Setup voice connection and audio player
            const connection = MusicService.joinVoiceChannel(voiceChannel, interaction.guild);
            const queue = global.getQueue(interaction.guild.id);
            const player = global.createGuildAudioPlayer(interaction.guild.id);

            if (connection) {
                connection.subscribe(player);
            }

            // Handle queue logic
            if (queue.nowPlaying) {
                queue.add(song);
                const response = SUCCESS_MESSAGES.ADDED_TO_QUEUE
                    .replace('{title}', song.title)
                    .replace('{position}', queue.songs.length);
                return interaction.editReply(response);
            } else {
                queue.add(song);
                global.playNext(interaction.guild.id);
                const response = SUCCESS_MESSAGES.NOW_PLAYING.replace('{title}', song.title);
                return interaction.editReply(response);
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