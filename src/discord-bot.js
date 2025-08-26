// Minimal Discord.js bot with a /orders view command
// Uses env vars; copy .env.example to .env

require('dotenv').config()
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js')

// --- Slash command definition ---
const ordersCommand = new SlashCommandBuilder()
  .setName('orders')
  .setDescription('View recent crypto orders')
  .addIntegerOption(opt => opt.setName('limit').setDescription('Number of orders to show (1-20)').setMinValue(1).setMaxValue(20))

async function resolveAppId(rest) {
  if (process.env.DISCORD_APP_ID) return process.env.DISCORD_APP_ID
  // Fetch the current application using the bot token
  const app = await rest.get(Routes.oauth2CurrentApplication())
  if (!app?.id) throw new Error('Unable to resolve Application ID; set DISCORD_APP_ID')
  return app.id
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN)
  const commands = [ordersCommand.toJSON()]
  if (!process.env.DISCORD_BOT_TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN')
  if (!process.env.DISCORD_GUILD_ID) throw new Error('Missing DISCORD_GUILD_ID')
  const appId = await resolveAppId(rest)
  await rest.put(
    Routes.applicationGuildCommands(appId, process.env.DISCORD_GUILD_ID),
    { body: commands }
  )
  console.log('Slash commands registered')
}

// expose for npm run register
module.exports.__register = registerCommands

// --- Robinhood client stub ---
const robinhood = require('./robinhood')

// --- Discord client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`)
})

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === 'orders') {
    const limit = interaction.options.getInteger('limit') ?? 5
    await interaction.deferReply({ ephemeral: true })
    try {
      const orders = await robinhood.listOrders({ limit })
      if (!orders || orders.length === 0) {
        await interaction.editReply('No Information: orders unavailable (LIVE disabled or not configured).')
        return
      }
      const lines = orders.map((o) => {
        const ts = o.timestamp || o.created_at || '—'
        const side = o.side?.toUpperCase?.() || o.side || '—'
        const sym = o.symbol || o.crypto_symbol || '—'
        const qty = o.quantity || o.notional || '—'
        const status = o.status || '—'
        return `• ${ts} | ${side} ${qty} ${sym} — ${status}`
      })
      await interaction.editReply(lines.slice(0, limit).join('\n'))
    } catch (err) {
      console.error(err)
      await interaction.editReply('Error fetching orders. Check logs.')
    }
  }
})

async function main() {
  await registerCommands()
  await client.login(process.env.DISCORD_BOT_TOKEN)
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Startup failed:', e)
    process.exit(1)
  })
}
