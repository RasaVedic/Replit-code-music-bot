const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const YouTube = require('youtube-sr').default;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('गाने search करें और list से choose करें')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('गाने का नाम या artist')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const query = interaction.options.getString('query');

        try {
            const searchResults = await YouTube.search(query, { limit: 10 });
            
            if (!searchResults || searchResults.length === 0) {
                return interaction.editReply('❌ कोई गाना नहीं मिला! दूसरा नाम try करें।');
            }

            const embed = new EmbedBuilder()
                .setTitle(`🔍 Search Results for: ${query}`)
                .setColor('#00ff00')
                .setDescription('नीचे dropdown से अपना गाना choose करें:')
                .setTimestamp();

            const options = searchResults.slice(0, 10).map((video, index) => ({
                label: video.title.length > 100 ? video.title.substring(0, 97) + '...' : video.title,
                description: `⏱️ ${video.duration || 'Unknown'} | 👀 ${video.views || 'N/A'} views`,
                value: video.url,
                emoji: '🎵'
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('song_select')
                .setPlaceholder('अपना गाना choose करें...')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });

        } catch (error) {
            console.error('Search command error:', error);
            return interaction.editReply('❌ Search करने में error हुई! दूसरा query try करें।');
        }
    },
};