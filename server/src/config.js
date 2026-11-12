'use strict';

const REQUIRED = ['MOONETIX_API_KEY', 'MOONETIX_POSTBACK_KEY'];

function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
  return {
    port: Number(env.PORT || 3000),
    databasePath: env.DATABASE_PATH || './data.sqlite',
    currencyName: env.CURRENCY_NAME || 'Coins',
    apiBase: 'https://api.moonetix.com',
    apiKey: env.MOONETIX_API_KEY,
    postbackKey: env.MOONETIX_POSTBACK_KEY,
  };
}

module.exports = { loadConfig };
