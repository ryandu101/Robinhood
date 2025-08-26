# Robinhood Discord Bot (Scaffold)

This project scaffolds a Discord bot using discord.js with a basic `/orders` command. It currently uses a Robinhood client stub and returns mock data unless `LIVE=true` is set and the environment variables are configured per official documentation.

## Setup

1. Copy `.env.example` to `.env` and fill in values.
2. Install dependencies.
3. Register the slash commands.
4. Run the bot.

## Environment Variables

- DISCORD_BOT_TOKEN: Bot token from Discord Developer Portal
- DISCORD_APP_ID: Application (client) ID
- DISCORD_GUILD_ID: Guild ID for command registration
- RH_CLIENT_ID, RH_API_KEY, RH_SHARED_SECRET, RH_ACCOUNT_NUMBER: Per Robinhood docs
- RH_BASE_URL: Base URL for the trading API (default: Robinhood Crypto placeholder)
- LIVE=true to enable real HTTP calls (ensure schemas/headers match docs)

## Scripts

- npm run dev: start the bot
- npm run start: same as dev
- npm run register: register the slash commands into the specified guild

## Notes

- The Robinhood client has a placeholder signing function. Replace with the official algorithm and headers from the docs before enabling LIVE.
- The `/orders` command replies ephemerally with recent orders. In mock mode it synthesizes data.

