import express from 'express';
import { ethers } from 'ethers';
import Database from 'better-sqlite3';
import TelegramBot from 'node-telegram-bot-api';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

// ==== CONFIG ====
const RPC = 'https://bsc-dataseed.binance.org/';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const PAIR_ADDRESS = '0x70163906f11E7a05eb37Dce319602e7ffc4865e5';
const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = 'https://willowy-starburst-59c5f3.netlify.app';
const AMOUNT = ethers.parseUnits('1', 18);
const COOLDOWN = 30 * 60;
const MIN_WITHDRAW = ethers.parseUnits('1', 18); // Sin mínimo (1 JHOAL técnico)
// ================

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
const token = new ethers.Contract(TOKEN_ADDRESS, ABI, wallet);

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)'
];
const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);

// ==== BASE DE DATOS ====
const db = new Database('faucet.db');

// Tabla de usuarios (saldo interno)
db.exec(`CREATE TABLE IF NOT EXISTS users_balance (
  user_id INTEGER PRIMARY KEY,
  balance REAL DEFAULT 0,
  total_claimed REAL DEFAULT 0,
  total_won REAL DEFAULT 0,
  total_lost REAL DEFAULT 0,
  last_claim INTEGER DEFAULT 0
)`);

// Tabla de apuestas
db.exec(`CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount REAL,
  multiplier REAL,
  payout REAL,
  result TEXT,
  created_at INTEGER
)`);

// Tabla de retiros
db.exec(`CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  wallet TEXT,
  amount REAL,
  tx_hash TEXT,
  created_at INTEGER
)`);

// Migración: si la tabla claims existe, migrar
try {
  const oldClaims = db.prepare('SELECT * FROM claims').all();
  if (oldClaims.length > 0) {
    for (const claim of oldClaims) {
      db.prepare('INSERT OR IGNORE INTO users_balance (user_id, balance, last_claim) VALUES (?, ?, ?)').run(claim.user_id, 0, claim.last_claim);
    }
  }
} catch (e) {
  // Si no existe la tabla claims, no hay nada que migrar
}

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'hace ' + seconds + 's';
  if (seconds < 3600) return 'hace ' + Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return 'hace ' + Math.floor(seconds / 3600) + 'h';
  return 'hace ' + Math.floor(seconds / 86400) + 'd';
}

// ==== FUNCIÓN: GIRAR RULETA ====
function spinRoulette() {
  const random = Math.random() * 100;
  
  if (random < 40) {
    return 0;      // 40% pierde todo
  } else if (random < 85) {
    return 1.1;    // 45% gana 1.1
  } else if (random < 95) {
    return 2;      // 10% gana 2
  } else if (random < 98) {
    return 4;      // 3% gana 4
  } else if (random < 99.5) {
    return 6;      // 1.5% gana 6
  } else if (random < 99.9) {
    return 8;      // 0.4% gana 8
  } else {
    return 10;     // 0.1% gana 10
  }
}

// ==== ENDPOINT: RECLAMAR (ahora va al saldo interno) ====
app.post('/claim', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Falta userId' });
  }

  const now = Math.floor(Date.now() / 1000);
  const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);

  if (user && now - user.last_claim < COOLDOWN) {
    const restante = COOLDOWN - (now - user.last_claim);
    const minutos = Math.floor(restante / 60);
    const segundos = restante % 60;
    return res.status(429).json({
      error: 'Espera ' + minutos + 'm ' + segundos + 's antes de reclamar otra vez'
    });
  }

  try {
    // Sumar al saldo interno
    if (user) {
      db.prepare('UPDATE users_balance SET balance = balance + 1, total_claimed = total_claimed + 1, last_claim = ? WHERE user_id = ?').run(now, userId);
    } else {
      db.prepare('INSERT INTO users_balance (user_id, balance, total_claimed, last_claim) VALUES (?, 1, 1, ?)').run(userId, now);
    }

    res.json({
      success: true,
      amount: 1,
      message: '¡1 JHOAL añadido a tu saldo de juego!'
    });
  } catch (error) {
    console.error('Error claim:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: VER SALDO DEL JUEGO ====
app.get('/balance-game/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);
    
    if (!user) {
      return res.json({
        success: true,
        balance: 0,
        total_claimed: 0,
        total_won: 0,
        total_lost: 0
      });
    }

    res.json({
      success: true,
      balance: user.balance,
      total_claimed: user.total_claimed,
      total_won: user.total_won,
      total_lost: user.total_lost,
      last_claim: user.last_claim
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: APOSTAR ====
app.post('/bet', async (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (amount <= 0 || amount > 1000) {
    return res.status(400).json({ error: 'Apuesta inválida (1-1000 JHOAL)' });
  }

  try {
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);

    if (!user || user.balance < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    // Girar ruleta
    const multiplier = spinRoulette();
    const payout = amount * multiplier;
    const profit = payout - amount;
    const now = Math.floor(Date.now() / 1000);

    // Actualizar saldo
    if (multiplier === 0) {
      db.prepare('UPDATE users_balance SET balance = balance - ?, total_lost = total_lost + ? WHERE user_id = ?').run(amount, amount, userId);
    } else {
      db.prepare('UPDATE users_balance SET balance = balance - ? + ?, total_won = total_won + ? WHERE user_id = ?').run(amount, payout, profit, userId);
    }

    // Registrar apuesta
    db.prepare('INSERT INTO bets (user_id, amount, multiplier, payout, result, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId, amount, multiplier, payout, multiplier === 0 ? 'lose' : 'win', now
    );

    const newUser = db.prepare('SELECT balance FROM users_balance WHERE user_id = ?').get(userId);

    res.json({
      success: true,
      multiplier: multiplier,
      payout: payout,
      profit: profit,
      newBalance: newUser.balance,
      message: multiplier === 0 ? 'Perdiste todo' : '¡Ganaste ' + payout + ' JHOAL!'
    });
  } catch (error) {
    console.error('Error bet:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: RETIRAR ====
app.post('/withdraw', async (req, res) => {
  const { userId, wallet: userWallet, amount } = req.body;

  if (!userId || !userWallet || !amount) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (!ethers.isAddress(userWallet)) {
    return res.status(400).json({ error: 'Wallet inválida' });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: 'Cantidad inválida' });
  }

  try {
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);

    if (!user || user.balance < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    // Enviar JHOAL on-chain
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await token.transfer(userWallet, amountWei);
    
    console.log('Withdraw TX:', tx.hash);

    // Restar del saldo
    db.prepare('UPDATE users_balance SET balance = balance - ? WHERE user_id = ?').run(amount, userId);

    // Registrar retiro
    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO withdrawals (user_id, wallet, amount, tx_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId, userWallet, amount, tx.hash, now
    );

    await tx.wait();

    res.json({
      success: true,
      txHash: tx.hash,
      explorer: 'https://bscscan.com/tx/' + tx.hash,
      amount: amount
    });
  } catch (error) {
    console.error('Error withdraw:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: HISTORIAL DE APUESTAS ====
app.get('/bet-history/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const bets = db.prepare('SELECT * FROM bets WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId);
    res.json({ success: true, bets: bets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: BALANCE FAUCET ====
app.get('/balance', async (req, res) => {
  try {
    const balance = await token.balanceOf(wallet.address);
    const bnb = await provider.getBalance(wallet.address);
    res.json({
      wallet: wallet.address,
      jhoal: ethers.formatUnits(balance, 18) + ' JHOAL',
      bnb: ethers.formatEther(bnb) + ' BNB'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: PRECIO ====
app.get('/price', async (req, res) => {
  try {
    const reserves = await pair.getReserves();
    const token0 = await pair.token0();
    let jhoalReserve, usdtReserve;
    if (token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
      jhoalReserve = reserves.reserve0;
      usdtReserve = reserves.reserve1;
    } else {
      jhoalReserve = reserves.reserve1;
      usdtReserve = reserves.reserve0;
    }
    const jhoalAmount = parseFloat(ethers.formatUnits(jhoalReserve, 18));
    const usdtAmount = parseFloat(ethers.formatUnits(usdtReserve, 18));
    res.json({
      success: true,
      priceUsd: usdtAmount / jhoalAmount,
      jhoalPerUsdt: jhoalAmount / usdtAmount,
      jhoalReserve: jhoalAmount,
      usdtReserve: usdtAmount
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: ÚLTIMAS APUESTAS (público) ====
app.get('/recent-bets', (req, res) => {
  try {
    const bets = db.prepare('SELECT * FROM bets ORDER BY created_at DESC LIMIT 10').all();
    const recent = bets.map(b => ({
      userId: b.user_id,
      amount: b.amount,
      multiplier: b.multiplier,
      payout: b.payout,
      result: b.result,
      ago: timeAgo(b.created_at)
    }));
    res.json({ success: true, bets: recent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: ROOT ====
app.get('/', (req, res) => {
  res.json({ status: 'Faucet JHOAL + Ruleta de Horus funcionando' });
});

// ==== BOT DE TELEGRAM ====
let bot = null;

if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Bot de Telegram iniciado');

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || 'guerrero';
    const welcome = 
      '⚱ *JHOAL - La ofrenda del dios* 🦅\n\n' +
      '¡Bienvenido, ' + name + '!\n\n' +
      '💰 Reclama *1 JHOAL GRATIS* cada 30 minutos\n' +
      '🎡 Juega en *La Ruleta de Horus*\n' +
      '📊 Precio actual: *$0.00005 USD*\n\n' +
      '👉 Toca "Abrir Faucet" para empezar.';
    
    bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/faucet/, (msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
      inline_keyboard: [[
        { text: '⚱ Abrir Faucet', web_app: { url: MINI_APP_URL } }
      ]]
    };
    bot.sendMessage(chatId, '🚰 *Abrir Faucet*\n\nToca el botón para reclamar tu ofrenda.', {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  });

  bot.onText(/\/price/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const reserves = await pair.getReserves();
      const token0 = await pair.token0();
      let jhoalReserve, usdtReserve;
      if (token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
        jhoalReserve = reserves.reserve0;
        usdtReserve = reserves.reserve1;
      } else {
        jhoalReserve = reserves.reserve1;
        usdtReserve = reserves.reserve0;
      }
      const jhoalAmount = parseFloat(ethers.formatUnits(jhoalReserve, 18));
      const usdtAmount = parseFloat(ethers.formatUnits(usdtReserve, 18));
      const priceUsd = usdtAmount / jhoalAmount;
      const jhoalPerUsdt = Math.round(jhoalAmount / usdtAmount);
      
      const message = 
        '💰 *PRECIO JHOAL EN VIVO*\n\n' +
        '💵 1 JHOAL = *$' + priceUsd.toFixed(8) + '*\n' +
        '💎 1 USDT = *' + jhoalPerUsdt.toLocaleString() + ' JHOAL*\n\n' +
        '📊 Liquidez: *$' + usdtAmount.toFixed(2) + '*';
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (e) {
      bot.sendMessage(chatId, '❌ Error al consultar el precio.');
    }
  });

  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const help = 
      '🆘 *AYUDA - JHOAL FAUCET*\n\n' +
      '*Comandos:*\n' +
      '/start - Iniciar\n' +
      '/faucet - Abrir faucet\n' +
      '/price - Ver precio\n' +
      '/help - Esta ayuda\n\n' +
      '*La Ruleta de Horus* 🎡\n' +
      'Reclama JHOAL y multiplícalos en la ruleta.\n' +
      'Gana hasta x10 en cada giro.';
    
    bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
  });

} else {
  console.log('BOT_TOKEN no configurado. El bot no está activo.');
}

// ==== INICIAR SERVIDOR ====
app.listen(process.env.PORT || 3000, () => {
  console.log('Faucet JHOAL + Ruleta de Horus corriendo en puerto', process.env.PORT || 3000);
  console.log('Wallet:', wallet.address);
  console.log('Bot:', BOT_TOKEN ? 'SÍ' : 'NO');
});
