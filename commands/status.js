const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show bot status, ping, and system information'),
    
    async execute(interaction) {
        const client = interaction.client;
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();
        
        // Format uptime
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        const uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        
        // Calculate ping
        const ping = Date.now() - interaction.createdTimestamp;
        const wsPing = client.ws.ping;
        
        // Format memory usage
        const formatBytes = (bytes) => {
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            if (bytes === 0) return '0 Bytes';
            const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
        };
        
        // Get active queues count
        const activeQueues = global.queues ? global.queues.size : 0;
        const activePlayers = global.audioPlayers ? global.audioPlayers.size : 0;
        
        const statusEmbed = new EmbedBuilder()
            .setTitle('🤖 Bot Status')
            .setColor('#00ff00')
            .addFields(
                { name: '🏓 Ping', value: `${ping}ms`, inline: true },
                { name: '📡 WebSocket', value: `${wsPing}ms`, inline: true },
                { name: '⏱️ Uptime', value: uptimeString, inline: true },
                { name: '🖥️ Servers', value: `${client.guilds.cache.size}`, inline: true },
                { name: '👥 Users', value: `${client.users.cache.size}`, inline: true },
                { name: '🎵 Active Queues', value: `${activeQueues}`, inline: true },
                { name: '🎶 Active Players', value: `${activePlayers}`, inline: true },
                { name: '📊 Memory Usage', value: formatBytes(memoryUsage.heapUsed), inline: true },
                { name: '🚀 Node.js', value: process.version, inline: true }
            )
            .setFooter({ text: `EchoTune Music Bot • ${new Date().toLocaleString()}` })
            .setTimestamp();

        await interaction.reply({ embeds: [statusEmbed] });
    },
};