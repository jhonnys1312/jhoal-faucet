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
const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN;
const SUPPORT_CHAT_ID = process.env.SUPPORT_CHAT_ID;
const MINI_APP_URL = 'https://willowy-starburst-59c5f3.netlify.app';
const SUPPORT_USERNAME = 'JhoalSupportbot';
const AMOUNT = ethers.parseUnits('1', 18);
const COOLDOWN = 30 * 60;
const MIN_BET = 0.1;
const MAX_BET = 1000;
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

db.exec(`CREATE TABLE IF NOT EXISTS users_balance (
  user_id INTEGER PRIMARY KEY,
  balance REAL DEFAULT 0,
  total_claimed REAL DEFAULT 0,
  total_won REAL DEFAULT 0,
  total_lost REAL DEFAULT 0,
  total_deposited REAL DEFAULT 0,
  total_withdrawn REAL DEFAULT 0,
  last_claim INTEGER DEFAULT 0
)`);

db.exec(`CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount REAL,
  multiplier REAL,
  payout REAL,
  result TEXT,
  created_at INTEGER
)`);

db.exec(`CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  wallet TEXT,
  amount REAL,
  tx_hash TEXT,
  created_at INTEGER
)`);

db.exec(`CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  wallet TEXT,
  amount REAL,
  tx_hash TEXT UNIQUE,
  created_at INTEGER
)`);

db.exec(`CREATE TABLE IF NOT EXISTS plants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  level TEXT,
  planted_at INTEGER,
  last_watered INTEGER,
  status TEXT DEFAULT 'dry',
  created_at INTEGER
)`);

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'hace ' + seconds + 's';
  if (seconds < 3600) return 'hace ' + Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return 'hace ' + Math.floor(seconds / 3600) + 'h';
  return 'hace ' + Math.floor(seconds / 86400) + 'd';
}

function spinRoulette() {
  const random = Math.random() * 100;
  if (random < 38) return 0;
  else if (random < 85) return 1.1;
  else if (random < 95) return 2;
  else if (random < 98) return 4;
  else if (random < 99.3) return 6;
  else if (random < 99.8) return 8;
  else return 10;
}

// ==== HUERTO DE HORUS ====
const PLANT_LEVELS = {
  basic: { name: 'Básica', emoji: '🌱', price: 1, waterCost: 0.1, fruitValue: 0.5, growTime: 25, witherTime: 25 },
  medium: { name: 'Media', emoji: '🌿', price: 5, waterCost: 0.5, fruitValue: 2.5, growTime: 25, witherTime: 25 },
  premium: { name: 'Premium', emoji: '🌳', price: 25, waterCost: 2.5, fruitValue: 12.5, growTime: 25, witherTime: 25 },
  pro: { name: 'Pro', emoji: '🌴', price: 100, waterCost: 10, fruitValue: 50, growTime: 25, witherTime: 25 }
};

const MAX_PLANTS = 12;

function getPlantStatus(plant) {
  if (plant.status === 'dry' || !plant.last_watered) {
    return { status: 'dry', value: 0, minutesLeft: 0, progress: 0 };
  }
  const now = Math.floor(Date.now() / 1000);
  const elapsed = (now - plant.last_watered) / 60;
  const level = PLANT_LEVELS[plant.level];

  if (elapsed < 25) {
    return {
      status: 'growing',
      value: 0,
      minutesLeft: Math.ceil(25 - elapsed),
      progress: Math.floor((elapsed / 25) * 100)
    };
  } else if (elapsed <= 35) {
    return {
      status: 'ready',
      value: level.fruitValue,
      minutesLeft: Math.ceil(35 - elapsed),
      progress: 100
    };
  } else if (elapsed <= 60) {
    const withering = (elapsed - 35) / 25;
    const value = level.fruitValue * (1 - withering);
    return {
      status: 'withering',
      value: Math.max(0, value),
      minutesLeft: Math.ceil(60 - elapsed),
      progress: 100
    };
  } else {
    return { status: 'rotten', value: 0, minutesLeft: 0, progress: 0 };
  }
}

// ==== ENDPOINT: RECLAMAR ====
app.post('/claim', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Falta userId' });

  const now = Math.floor(Date.now() / 1000);
  const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);

  if (user && now - user.last_claim < COOLDOWN) {
    const restante = COOLDOWN - (now - user.last_claim);
    return res.status(429).json({
      error: 'Espera ' + Math.floor(restante / 60) + 'm ' + (restante % 60) + 's antes de reclamar otra vez'
    });
  }

  try {
    if (user) {
      db.prepare('UPDATE users_balance SET balance = balance + 1, total_claimed = total_claimed + 1, last_claim = ? WHERE user_id = ?').run(now, userId);
    } else {
      db.prepare('INSERT INTO users_balance (user_id, balance, total_claimed, last_claim) VALUES (?, 1, 1, ?)').run(userId, now);
    }
    res.json({ success: true, amount: 1, message: '¡1 JHOAL añadido a tu saldo!' });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: BALANCE DEL JUEGO ====
app.get('/balance-game/:userId', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(req.params.userId);
    if (!user) {
      return res.json({ success: true, balance: 0, total_claimed: 0, total_won: 0, total_lost: 0, last_claim: 0 });
    }
    res.json({
      success: true,
      balance: user.balance,
      total_claimed: user.total_claimed,
      total_won: user.total_won,
      total_lost: user.total_lost,
      last_claim: user.last_claim || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: APOSTAR ====
app.post('/bet', async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: 'Faltan datos' });
  if (amount < MIN_BET || amount > MAX_BET) return res.status(400).json({ error: 'Apuesta inválida (' + MIN_BET + '-' + MAX_BET + ')' });

  try {
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);
    if (!user || user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });

    const multiplier = spinRoulette();
    const payout = amount * multiplier;
    const profit = payout - amount;
    const now = Math.floor(Date.now() / 1000);

    if (multiplier === 0) {
      db.prepare('UPDATE users_balance SET balance = balance - ?, total_lost = total_lost + ? WHERE user_id = ?').run(amount, amount, userId);
    } else {
      db.prepare('UPDATE users_balance SET balance = balance - ? + ?, total_won = total_won + ? WHERE user_id = ?').run(amount, payout, profit, userId);
    }

    db.prepare('INSERT INTO bets (user_id, amount, multiplier, payout, result, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId, amount, multiplier, payout, multiplier === 0 ? 'lose' : 'win', now
    );

    const newUser = db.prepare('SELECT balance FROM users_balance WHERE user_id = ?').get(userId);

    res.json({
      success: true,
      multiplier: multiplier,
      payout: payout,
      profit: profit,
      newBalance: newUser.balance
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: RETIRAR ====
app.post('/withdraw', async (req, res) => {
  const { userId, wallet: userWallet, amount } = req.body;
  if (!userId || !userWallet || !amount) return res.status(400).json({ error: 'Faltan datos' });
  if (!ethers.isAddress(userWallet)) return res.status(400).json({ error: 'Wallet inválida' });
  if (amount <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

  try {
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);
    if (!user || user.balance < amount) return res.status(400).json({ error: 'Saldo insuficiente' });

    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await token.transfer(userWallet, amountWei);
    console.log('Withdraw TX:', tx.hash);

    db.prepare('UPDATE users_balance SET balance = balance - ?, total_withdrawn = total_withdrawn + ? WHERE user_id = ?').run(amount, amount, userId);

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
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: HISTORIAL DE APUESTAS ====
app.get('/bet-history/:userId', (req, res) => {
  try {
    const bets = db.prepare('SELECT * FROM bets WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.userId);
    res.json({ success: true, bets: bets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: INFO DE DEPÓSITO ====
app.get('/deposit-info', (req, res) => {
  res.json({
    success: true,
    depositWallet: wallet.address,
    tokenAddress: TOKEN_ADDRESS,
    minDeposit: 1
  });
});

// ==== ENDPOINT: VERIFICAR DEPÓSITO ====
app.post('/verify-deposit', async (req, res) => {
  const { userId, txHash } = req.body;

  if (!userId || !txHash) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'Hash de transacción inválido' });
  }

  try {
    const existing = db.prepare('SELECT * FROM deposits WHERE tx_hash = ?').get(txHash);
    if (existing) {
      return res.status(400).json({ error: 'Esta transacción ya fue usada' });
    }

    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return res.status(400).json({ error: 'Transacción no encontrada. Espera 1-2 minutos.' });
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return res.status(400).json({ error: 'Transacción no confirmada todavía. Espera 1-2 minutos.' });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({ error: 'La transacción falló' });
    }

    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const transferLog = receipt.logs.find(function(log) {
      return log.topics[0] === transferTopic &&
             log.address.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
    });

    if (!transferLog) {
      return res.status(400).json({ error: 'No se encontró transferencia de JHOAL en la transacción' });
    }

    const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    const decoded = iface.parseLog(transferLog);

    if (decoded.args.to.toLowerCase() !== wallet.address.toLowerCase()) {
      return res.status(400).json({ error: 'La transferencia no fue a la wallet correcta' });
    }

    const amount = parseFloat(ethers.formatUnits(decoded.args.value, 18));

    if (amount < 1) {
      return res.status(400).json({ error: 'El depósito mínimo es 1 JHOAL' });
    }

    const block = await provider.getBlock(receipt.blockNumber);
    const now = Math.floor(Date.now() / 1000);
    if (block && now - block.timestamp > 3600) {
      return res.status(400).json({ error: 'Transacción muy antigua (más de 1 hora)' });
    }

    const nowReg = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO deposits (user_id, wallet, amount, tx_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId, decoded.args.from, amount, txHash, nowReg
    );

    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);
    if (user) {
      db.prepare('UPDATE users_balance SET balance = balance + ?, total_deposited = total_deposited + ? WHERE user_id = ?').run(amount, amount, userId);
    } else {
      db.prepare('INSERT INTO users_balance (user_id, balance, total_deposited) VALUES (?, ?, ?)').run(userId, amount, amount);
    }

    res.json({
      success: true,
      amount: amount,
      message: '¡Depositaste ' + amount.toFixed(2) + ' JHOAL!'
    });
  } catch (error) {
    console.error('Error deposit:', error);
    res.status(500).json({ error: 'Error al verificar: ' + error.message });
  }
});

// ==== ENDPOINTS: HUERTO DE HORUS ====

// Comprar planta
app.post('/buy-plant', async (req, res) => {
  const { userId, level } = req.body;
  
  if (!userId || !level) return res.status(400).json({ error: 'Faltan datos' });
  if (!PLANT_LEVELS[level]) return res.status(400).json({ error: 'Nivel inválido' });
  
  try {
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);
    if (!user) return res.status(400).json({ error: 'Usuario no existe' });
    
    const plantCount = db.prepare('SELECT COUNT(*) as count FROM plants WHERE user_id = ?').get(userId);
    if (plantCount.count >= MAX_PLANTS) {
      return res.status(400).json({ error: 'Máximo ' + MAX_PLANTS + ' plantas por usuario' });
    }
    
    const plantInfo = PLANT_LEVELS[level];
    if (user.balance < plantInfo.price) {
      return res.status(400).json({ error: 'Saldo insuficiente. Necesitás ' + plantInfo.price + ' JHOAL' });
    }
    
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE users_balance SET balance = balance - ? WHERE user_id = ?').run(plantInfo.price, userId);
    db.prepare('INSERT INTO plants (user_id, level, status, created_at) VALUES (?, ?, ?, ?)').run(userId, level, 'dry', now);
    
    res.json({ success: true, message: '¡Compraste una planta ' + plantInfo.name + '!' });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// Regar planta
app.post('/water-plant', async (req, res) => {
  const { userId, plantId } = req.body;
  
  if (!userId || !plantId) return res.status(400).json({ error: 'Faltan datos' });
  
  try {
    const plant = db.prepare('SELECT * FROM plants WHERE id = ? AND user_id = ?').get(plantId, userId);
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });
    
    const status = getPlantStatus(plant);
    if (status.status !== 'dry' && status.status !== 'rotten') {
      return res.status(400).json({ error: 'La planta todavía tiene fruto o está creciendo' });
    }
    
    const user = db.prepare('SELECT * FROM users_balance WHERE user_id = ?').get(userId);
    const level = PLANT_LEVELS[plant.level];
    
    if (user.balance < level.waterCost) {
      return res.status(400).json({ error: 'Saldo insuficiente. Necesitás ' + level.waterCost + ' JHOAL' });
    }
    
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE users_balance SET balance = balance - ? WHERE user_id = ?').run(level.waterCost, userId);
    db.prepare('UPDATE plants SET last_watered = ?, status = ? WHERE id = ?').run(now, 'growing', plantId);
    
    res.json({ success: true, message: '¡Regaste tu planta! Lista en 25 minutos.' });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// Cosechar
app.post('/harvest', async (req, res) => {
  const { userId, plantId } = req.body;
  
  if (!userId || !plantId) return res.status(400).json({ error: 'Faltan datos' });
  
  try {
    const plant = db.prepare('SELECT * FROM plants WHERE id = ? AND user_id = ?').get(plantId, userId);
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });
    
    const status = getPlantStatus(plant);
    if (status.status !== 'ready' && status.status !== 'withering') {
      return res.status(400).json({ error: 'Todavía no podés cosechar esta planta' });
    }
    
    const value = status.value;
    if (value <= 0) return res.status(400).json({ error: 'El fruto está podrido' });
    
    db.prepare('UPDATE users_balance SET balance = balance + ?, total_won = total_won + ? WHERE user_id = ?').run(value, value, userId);
    db.prepare('UPDATE plants SET status = ?, last_watered = NULL WHERE id = ?').run('dry', plantId);
    
    res.json({ success: true, value: value, message: '¡Cosechaste ' + value.toFixed(2) + ' JHOAL!' });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// Ver mis plantas
app.get('/my-plants/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const plants = db.prepare('SELECT * FROM plants WHERE user_id = ? ORDER BY created_at ASC').all(userId);
    
    const plantsWithStatus = plants.map(function(p) {
      const status = getPlantStatus(p);
      const level = PLANT_LEVELS[p.level];
      return {
        id: p.id,
        level: p.level,
        levelName: level.name,
        emoji: level.emoji,
        status: status.status,
        value: status.value,
        minutesLeft: status.minutesLeft || 0,
        progress: status.progress || 0,
        waterCost: level.waterCost,
        fruitValue: level.fruitValue,
        lastWatered: p.last_watered
      };
    });
    
    res.json({
      success: true,
      plants: plantsWithStatus,
      count: plants.length,
      maxPlants: MAX_PLANTS,
      plantLevels: PLANT_LEVELS
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
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

// ==== ENDPOINT: ROOT ====
app.get('/', (req, res) => {
  res.json({ status: 'Faucet JHOAL + Dados de Horus + Huerto funcionando' });
});

// ==== BOT PRINCIPAL ====
let bot = null;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Bot principal iniciado');

  bot.onText(/\/start/, (msg) => {
    const name = msg.from.first_name || 'guerrero';
    bot.sendMessage(msg.chat.id,
      '⚱ *JHOAL - La ofrenda del dios* 🦅\n\n' +
      '¡Bienvenido, ' + name + '!\n\n' +
      '💰 Reclama *1 JHOAL GRATIS* cada 30 minutos\n' +
      '🎲 Juega en *Los Dados de Horus*\n' +
      '🌱 Planta en el *Huerto de Horus*\n' +
      '📊 Precio actual: *$0.00005 USD*\n\n' +
      '👉 Toca "Abrir Faucet" para empezar.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/faucet/, (msg) => {
    bot.sendMessage(msg.chat.id, '🚰 *Abrir Faucet*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '⚱ Abrir Faucet', web_app: { url: MINI_APP_URL } }]] }
    });
  });

  bot.onText(/\/price/, async (msg) => {
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
      bot.sendMessage(msg.chat.id,
        '💰 *PRECIO JHOAL*\n\n' +
        '💵 1 JHOAL = *$' + (usdtAmount / jhoalAmount).toFixed(8) + '*\n' +
        '💎 1 USDT = *' + Math.round(jhoalAmount / usdtAmount).toLocaleString() + ' JHOAL*',
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      bot.sendMessage(msg.chat.id, '❌ Error al consultar precio.');
    }
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '🆘 *AYUDA*\n\n/start - Iniciar\n/faucet - Abrir faucet\n/price - Precio\n/help - Esta ayuda\n\n📩 Soporte: @' + SUPPORT_USERNAME,
      { parse_mode: 'Markdown' }
    );
  });
}

// ==== BOT DE SOPORTE ====
if (SUPPORT_BOT_TOKEN && SUPPORT_CHAT_ID) {
  const supportBot = new TelegramBot(SUPPORT_BOT_TOKEN, { polling: true });
  console.log('Bot de soporte iniciado');

  supportBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || 'usuario';
    supportBot.sendMessage(chatId,
      '🆘 *SOPORTE JHOAL*\n\n' +
      '¡Hola, ' + name + '!\n\n' +
      'Por favor escribí tu consulta en un solo mensaje. Incluí:\n\n' +
      '1. Tu problema (ej: depósito no verificado)\n' +
      '2. El hash de la transacción (si aplica)\n' +
      '3. Tu ID de Telegram\n\n' +
      'Te vamos a responder a la brevedad.',
      { parse_mode: 'Markdown' }
    );
  });

  supportBot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const userName = msg.from.first_name || 'Usuario';
    const userUsername = msg.from.username ? '@' + msg.from.username : 'sin username';
    const userId = msg.from.id;

    const supportMessage =
      '📩 *NUEVO MENSAJE DE SOPORTE*\n\n' +
      '👤 De: ' + userName + '\n' +
      '🔗 Username: ' + userUsername + '\n' +
      '🆔 ID: `' + userId + '`\n\n' +
      '💬 Mensaje:\n' + text;

    supportBot.sendMessage(SUPPORT_CHAT_ID, supportMessage, {
      parse_mode: 'Markdown'
    }).then(() => {
      supportBot.sendMessage(chatId,
        '✅ *Mensaje recibido*\n\n' +
        'Tu consulta fue enviada al equipo de soporte. Te vamos a responder a la brevedad.',
        { parse_mode: 'Markdown' }
      );
    }).catch((err) => {
      console.error('Error enviando a soporte:', err);
    });
  });
}

// ==== INICIAR SERVIDOR ====
app.listen(process.env.PORT || 3000, () => {
  console.log('Faucet JHOAL + Dados + Huerto corriendo en puerto', process.env.PORT || 3000);
  console.log('Wallet:', wallet.address);
  console.log('Bot principal:', BOT_TOKEN ? 'SÍ' : 'NO');
  console.log('Bot de soporte:', SUPPORT_BOT_TOKEN ? 'SÍ' : 'NO');
});
