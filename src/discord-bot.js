// Minimal Discord.js bot with a /orders view command
// Uses env vars; copy .env.example to .env

require('dotenv').config()
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } = require('discord.js')

// --- Slash command definition ---
const ordersCommand = new SlashCommandBuilder()
  .setName('orders')
  .setDescription('Get stock price or options for a ticker')
  .addStringOption(opt => opt
    .setName('ticker')
    .setDescription('Stock ticker symbol, e.g., AAPL, BABA')
    .setRequired(true)
  )
  .addBooleanOption(opt => opt
    .setName('options')
    .setDescription('If true, show options chain slice instead of stock quote')
    .setRequired(false)
  )
  .addStringOption(opt => opt
    .setName('type')
    .setDescription('Option type (required if options=true)')
    .addChoices(
      { name: 'call', value: 'call' },
      { name: 'put', value: 'put' }
    )
    .setRequired(false)
  )
  .addStringOption(opt => opt
    .setName('expiry')
    .setDescription('Expiry date MM/DD/YY (required if options=true)')
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

// --- Market data client (temporary provider) ---
const market = require('./robinhood')

// --- Discord client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`)
})

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === 'orders') {
    const ticker = (interaction.options.getString('ticker') || '').trim().toUpperCase()
    const wantsOptions = interaction.options.getBoolean('options') || false
    const type = interaction.options.getString('type') || undefined
    const expiry = interaction.options.getString('expiry') || undefined

    await interaction.deferReply() // public reply
    try {
      if (!ticker) {
        await interaction.editReply('Please provide a ticker, e.g., /orders ticker:AAPL')
        return
      }
      if (!wantsOptions) {
        const quote = await market.getQuote(ticker)
        await interaction.editReply(formatQuote(ticker, quote))
        return
      }

      // options flow
      if (!type || !expiry) {
        await interaction.editReply('When options=true, you must provide both type (call/put) and expiry (MM/DD/YY).')
        return
      }
      const table = await market.getOptionsSlice(ticker, type, expiry)
      await interaction.editReply(table)
    } catch (err) {
      console.error(err)
      await interaction.editReply('Error fetching data. Check logs.')
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
