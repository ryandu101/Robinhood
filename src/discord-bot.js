// Minimal Discord.js bot with a /orders view command
// Uses env vars; copy .env.example to .env

require('dotenv').config()
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events } = require('discord.js')

// --- Slash command definition ---
const ordersCommand = new SlashCommandBuilder()
  .setName('orders')
  .setDescription('Get crypto price and order book depth for a ticker (e.g., BTC, ETH)')
  .addStringOption(opt => opt
    .setName('ticker')
    .setDescription('Crypto ticker symbol, e.g., BTC, ETH')
    .setRequired(true)
  )
  .addBooleanOption(opt => opt
    .setName('book')
    .setDescription('Include order book depth chart (default: true)')
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

// --- Market data client ---
const market = require('./robinhood')

function formatPriceLine(symbol, quote) {
  const p = quote?.price
  const change = quote?.change
  const pct = quote?.changePercent
  const time = quote?.time ? ` @ ${quote.time}` : ''
  const parts = [
    `${symbol} ${p != null ? p : '—'}`,
    change != null ? `${change >= 0 ? '+' : ''}${change}` : undefined,
    pct != null ? `(${pct >= 0 ? '+' : ''}${pct.toFixed?.(2) ?? pct}%)` : undefined,
  ].filter(Boolean)
  return parts.join(' ') + time
}

function renderDepthChart({ bids, asks, mid }, maxRows = 12, width = 18) {
  // bids: [[price, size], ...] descending by price
  // asks: [[price, size], ...] ascending by price
  const b = (bids || []).slice(0, maxRows)
  const a = (asks || []).slice(0, maxRows)
  const maxBidSize = Math.max(...b.map(x => x[1]), 1)
  const maxAskSize = Math.max(...a.map(x => x[1]), 1)
  const bidBars = b.map(x => '█'.repeat(Math.max(1, Math.round((x[1] / maxBidSize) * width))))
  const askBars = a.map(x => '█'.repeat(Math.max(1, Math.round((x[1] / maxAskSize) * width))))

  const lines = []
  lines.push(`Mid: ${mid ?? '—'}`)
  lines.push('Bids'.padEnd(width) + '  Price        ' + 'Asks')
  const rows = Math.max(b.length, a.length)
  for (let i = 0; i < rows; i++) {
    const lb = i < b.length ? bidBars[i].padEnd(width) : ' '.repeat(width)
    const bp = i < b.length ? String(b[i][0]).padStart(8) : ' '.repeat(8)
    const ap = i < a.length ? String(a[i][0]).padEnd(8) : ' '.repeat(8)
    const la = i < a.length ? askBars[i] : ''
    lines.push(`${lb}  ${bp}  |  ${ap} ${la}`)
  }
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
    const ticker = (interaction.options.getString('ticker') || '').trim().toUpperCase()
    const includeBook = interaction.options.getBoolean('book') ?? true

    await interaction.deferReply() // public reply
    try {
      if (!ticker) {
        await interaction.editReply('Please provide a crypto ticker, e.g., /orders ticker:BTC')
        return
      }
      const symbol = ticker
      const quote = await market.getCryptoQuote(symbol)
      if (!includeBook) {
        await interaction.editReply(formatPriceLine(symbol, quote))
        return
      }
      const book = await market.getCryptoOrderBook(symbol)
      const chart = renderDepthChart(book)
      const header = formatPriceLine(symbol, quote)
      await interaction.editReply(`${header}\n\n${chart}`)
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
