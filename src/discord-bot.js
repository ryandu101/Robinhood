// Minimal Discord.js bot with a /orders view command
// Uses env vars; copy .env.example to .env

require('dotenv').config()
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } = require('discord.js')

// --- Slash command definition ---
const ordersCommand = new SlashCommandBuilder()
  .setName('orders')
  .setDescription('Get Robinhood crypto quote for a ticker pair')
  .addStringOption(opt => opt
    .setName('ticker')
    .setDescription('Crypto base symbol, e.g., BTC, ETH, DOGE')
    .setRequired(true)
  )
  .addStringOption(opt => opt
    .setName('vs')
    .setDescription('Counter currency (default: USD)')
    .setRequired(false)
  )

async function registerCommands({ appId, guildId, token }) {
  const rest = new REST({ version: '10' }).setToken(token)
  const commands = [ordersCommand.toJSON()]
  // Register globally
  await rest.put(
    Routes.applicationCommands(appId),
    { body: commands }
  )
  console.log('Global slash commands registered (can take up to 1 hour to appear)')
  // And also register for guild if provided (immediate availability)
  if (guildId) {
    await rest.put(
      Routes.applicationGuildCommands(appId, guildId),
      { body: commands }
    )
    console.log(`Slash commands registered for guild ${guildId}`)
  }
}

// expose for npm run register (will login to fetch appId if not provided)
module.exports.__register = async function __register() {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('Missing DISCORD_BOT_TOKEN')
  let appId = process.env.DISCORD_APP_ID
  const guildId = process.env.DISCORD_GUILD_ID
  if (!appId) {
    const tmp = new Client({ intents: [GatewayIntentBits.Guilds] })
  await tmp.login(token)
  await new Promise(res => tmp.once(Events.ClientReady, res))
    appId = tmp.application?.id
    await tmp.destroy()
  }
  if (!appId) throw new Error('Unable to resolve application ID')
  await registerCommands({ appId, guildId, token })
}

// --- Robinhood crypto data client ---
const market = require('./robinhood')

function formatCryptoQuote(symbolPair, q) {
  const lines = []
  lines.push(`${symbolPair} — Price: ${q.price}`)
  if (q.bid != null || q.ask != null) lines.push(`Bid: ${q.bid ?? '—'}  Ask: ${q.ask ?? '—'}`)
  if (q.high != null || q.low != null) lines.push(`24h High: ${q.high ?? '—'}  Low: ${q.low ?? '—'}`)
  if (q.change != null || q.changePercent != null) lines.push(`Change: ${q.change ?? '—'} (${q.changePercent != null ? (q.changePercent*100).toFixed(2)+'%' : '—'})`)
  if (q.time) lines.push(`As of: ${q.time}`)
  return lines.join('\n')
}

// --- Discord client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`)
})

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === 'orders') {
    const base = (interaction.options.getString('ticker') || '').trim().toUpperCase()
    const counter = (interaction.options.getString('vs') || 'USD').trim().toUpperCase()
    await interaction.deferReply() // public reply
    try {
      if (!base) {
        await interaction.editReply('Please provide a crypto ticker, e.g., /orders ticker:BTC [vs:USD]')
        return
      }
      const pair = `${base}-${counter}`
      const quote = await market.getCryptoQuote(base, counter)
      await interaction.editReply(formatCryptoQuote(pair, quote))
    } catch (err) {
      console.error(err)
      await interaction.editReply('Error fetching crypto quote. Ensure your Robinhood API keys are set and have Read crypto quotes allowed.')
    }
  }
})

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err)
})

async function main() {
  console.log('Starting Discord bot...')
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) throw new Error('Missing DISCORD_BOT_TOKEN')

  await client.login(token)
  // Ensure ready so client.application is available
  if (!client.isReady()) {
    await new Promise((res) => client.once('ready', res))
  }
  const appId = process.env.DISCORD_APP_ID || client.application?.id
  if (!appId) throw new Error('Unable to resolve application ID')
  const guildId = process.env.DISCORD_GUILD_ID
  console.log(`Application ID: ${appId}${guildId ? ` | Guild ID: ${guildId}` : ' | Global commands mode'}`)
  await registerCommands({ appId, guildId, token })
  console.log('Bot is ready and listening for interactions.')
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Startup failed:', e)
    process.exit(1)
  })
}
