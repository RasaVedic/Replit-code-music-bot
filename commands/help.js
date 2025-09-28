const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config/botConfig');
const { getGuildSettings } = require('../src/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands and their usage'),

    async execute(interaction) {
        const guildSettings = getGuildSettings(interaction.guild.id);
        const prefix = guildSettings.prefix;
        
        const embed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.MUSIC} RagaBot Help & Commands`)
            .setColor(config.COLORS.INFO)
            .setDescription(`**Current Prefix:** \`${prefix}\`\n**Pro Tip:** Use short forms like \`${prefix}p\` instead of \`${prefix}play\` for faster commands!`)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .addFields(
                {
                    name: `${config.EMOJIS.PLAY} Music Playback`,
                    value: `\`${prefix}play\` \`${prefix}p\` - Play song from URL or search\n` +
                          `\`${prefix}skip\` \`${prefix}s\` - Skip current song\n` +
                          `\`${prefix}stop\` \`${prefix}st\` - Stop music & disconnect\n` +
                          `\`${prefix}pause\` - Pause current song\n` +
                          `\`${prefix}resume\` - Resume paused song`,
                    inline: true
                },
                {
                    name: `${config.EMOJIS.VOLUME} Audio Control`,
                    value: `\`${prefix}volume\` \`${prefix}v\` - Set volume (0-100)\n` +
                          `\`${prefix}loop\` \`${prefix}l\` - Toggle loop mode\n` +
                          `\`${prefix}autoplay\` - Smart autoplay toggle\n` +
                          `\`${prefix}shuffle\` - Shuffle queue\n` +
                          `\`${prefix}clear\` - Clear entire queue`,
                    inline: true
                },
                {
                    name: `${config.EMOJIS.QUEUE} Queue Management`,
                    value: `\`${prefix}queue\` \`${prefix}q\` - Show current queue\n` +
                          `\`${prefix}nowplaying\` \`${prefix}np\` - Current song info\n` +
                          `\`${prefix}history\` \`${prefix}h\` - Show play history\n` +
                          `\`${prefix}remove\` \`${prefix}rm\` - Remove song from queue\n` +
                          `\`${prefix}move\` \`${prefix}mv\` - Move song position\n` +
                          `\`${prefix}skipto\` - Jump to queue position`,
                    inline: true
                },
                {
                    name: `🎛️ Advanced Features`,
                    value: `\`${prefix}playlist\` \`${prefix}pl\` - Load playlists\n` +
                          `\`${prefix}voteskip\` \`${prefix}vs\` - Democratic skip\n` +
                          `\`${prefix}bassboost\` \`${prefix}bass\` - Audio enhancement\n` +
                          `\`${prefix}filters\` \`${prefix}fx\` - Audio filters\n` +
                          `\`${prefix}speed\` - Playback speed control\n` +
                          `\`${prefix}leave\` \`${prefix}lv\` - Disconnect bot`,
                    inline: true
                },
                {
                    name: `${config.EMOJIS.SUCCESS} Settings & Info`,
                    value: `\`${prefix}setprefix\` - Change server prefix\n` +
                          `\`${prefix}stats\` - Bot statistics\n` +
                          `\`${prefix}ping\` - Check bot latency\n` +
                          `\`${prefix}invite\` - Get bot invite link\n` +
                          `\`${prefix}support\` - Get support server link`,
                    inline: true
                },
                {
                    name: `${config.EMOJIS.MUSIC} Supported Sources`,
                    value: `🎬 **YouTube** - URLs & searches\n` +
                          `🎵 **Spotify** - Tracks & playlists\n` +
                          `🔊 **SoundCloud** - Direct links\n` +
                          `📻 **Radio Streams** - Direct URLs\n` +
                          `📁 **Local Files** - File uploads`,
                    inline: true
                },
                {
                    name: `⚡ Quick Commands`,
                    value: `**Most Used:**\n` +
                          `\`${prefix}p <song>\` - Play music\n` +
                          `\`${prefix}s\` - Skip song\n` +
                          `\`${prefix}q\` - View queue\n` +
                          `\`${prefix}v <0-100>\` - Set volume\n` +
                          `\`${prefix}l\` - Toggle loop`,
                    inline: true
                }
            )
            .setFooter({ 
                text: '🎵 Use interactive buttons on now playing messages for quick controls!',
                iconURL: interaction.client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Add premium features note if applicable
        const premiumEmbed = new EmbedBuilder()
            .setTitle(`${config.EMOJIS.SUCCESS} Interactive Controls`)
            .setDescription(
                `**Button Controls Available:**\n` +
                `⏮️ **Previous** - Play previous song\n` +
                `⏯️ **Play/Pause** - Toggle playback\n` +
                `⏭️ **Skip** - Skip to next song\n` +
                `⏹️ **Stop** - Stop music & clear queue\n\n` +
                `**Advanced Controls:**\n` +
                `🔂 **Loop** - Toggle loop mode\n` +
                `🤖 **Auto** - Toggle autoplay\n` +
                `🔀 **Shuffle** - Shuffle queue\n` +
                `📋 **Queue** - View detailed queue`
            )
            .setColor(config.COLORS.SUCCESS);

        await interaction.reply({ 
            embeds: [embed, premiumEmbed],
            ephemeral: false 
        });
    },
};