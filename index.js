import express from 'express';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';
import cors from 'cors';
import crypto from 'crypto';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

// ==== CONFIG ====
const RPC_LIST = [
  'https://bsc-mainnet.nodereal.io/v1/05f8075daa504e9e97eab50c590ae8a2'
];
let currentProvider = null;

async function getProvider() {
  if (currentProvider) {
    try {
      await currentProvider.getBlockNumber();
      return currentProvider;
    } catch (e) {
      currentProvider = null;
    }
  }
  for (const rpc of RPC_LIST) {
    try {
      const testProvider = new ethers.JsonRpcProvider(rpc);
      await testProvider.getBlockNumber();
      console.log('✅ RPC OK:', rpc);
      currentProvider = testProvider;
      return testProvider;
    } catch (e) {
      console.log('❌ RPC falló:', rpc);
    }
  }
  throw new Error('Ningún RPC funciona');
}
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const PAIR_ADDRESS = '0x70163906f11E7a05eb37Dce319602e7ffc4865e5';
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN;
const SUPPORT_CHAT_ID = process.env.SUPPORT_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const MINI_APP_URL = 'https://willowy-starburst-59c5f3.netlify.app';
const SUPPORT_USERNAME = 'JhoalSupportbot';
const COOLDOWN = 30 * 60;
const MIN_BET = 0.1;
const MAX_BET = 1000;

// ==== REFERIDOS ====
const REFERRAL_REWARD = 1000;
const REFERRAL_BOT_USERNAME = process.env.REFERRAL_BOT_USERNAME || 'JhoalFaucetBot';
const REFERRAL_BANNER_URL = process.env.REFERRAL_BANNER_URL || 'https://i.imgur.com/xoIBdWv.png';

// ==== MONITOR DE DEPÓSITOS ====
const MONITOR_START_BLOCK = 122925000;
const BATCH_SIZE = 100;
const BLOCKS_PER_CYCLE = 2000;
const BATCH_DELAY_MS = 100;

// ==== LUNA LLENA ====
const MOON_GROWTH_MULTIPLIER = 1.9;
const MOON_DURATION_MIN = 10;
const MOON_MIN_PER_DAY = 1;
const MOON_MAX_PER_DAY = 5;

// ==== ADSGRAM ====
const AD_REWARD_AMOUNT = 5;
const AD_COOLDOWN = 10 * 60;

const provider = new ethers.JsonRpcProvider(RPC_LIST[0]);
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

// ==== SUPABASE ====
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==== ENCRIPTACIÓN ====
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.warn('⚠️ ENCRYPTION_KEY no está configurada.');
}

function encryptPrivateKey(pk) {
  if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY no configurada');
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(pk, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptPrivateKey(encrypted) {
  if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY no configurada');
  const parts = encrypted.split(':');
  if (parts.length !== 2) throw new Error('Formato de private key inválido');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedHex = parts[1];
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ==== ESTADO LUNA LLENA ====
const moonState = {
  active: false,
  startedAt: 0,
  endsAt: 0,
  nextEventAt: 0,
  eventsToday: 0,
  todayKey: ''
};

function todayKeyUTC() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleNextMoon() {
  const now = Math.floor(Date.now() / 1000);
  const key = todayKeyUTC();
  if (moonState.todayKey !== key) {
    moonState.todayKey = key;
    moonState.eventsToday = 0;
  }
  if (moonState.eventsToday >= MOON_MAX_PER_DAY) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    moonState.nextEventAt = Math.floor(tomorrow.getTime() / 1000) + randInt(0, 3600);
    return;
  }
  const remainingMin = MOON_MIN_PER_DAY - moonState.eventsToday;
  const hoursLeftToday = 24 - new Date().getUTCHours();
  let delay;
  if (remainingMin > 0 && hoursLeftToday <= remainingMin) {
    delay = randInt(60, 1800);
  } else {
    delay = randInt(1800, 5 * 3600);
  }
  moonState.nextEventAt = now + delay;
}

function activateMoon() {
  const now = Math.floor(Date.now() / 1000);
  moonState.active = true;
  moonState.startedAt = now;
  moonState.endsAt = now + MOON_DURATION_MIN * 60;
  moonState.eventsToday += 1;
  console.log('🌕 LUNA LLENA ACTIVADA hasta', new Date(moonState.endsAt * 1000).toISOString());
  notificarLunaLlena();
}

async function notificarLunaLlena() {
  if (!bot) return;
  try {
    const { data: usuarios } = await supabase.from('users_balance').select('chat_id').not('chat_id', 'is', null);
    if (!usuarios || usuarios.length === 0) return;
    for (const u of usuarios) {
      try {
        await bot.sendMessage(u.chat_id,
          '🌕 *¡LUNA LLENA ACTIVA!*\n\nLas plantas crecen *90% más rápido* durante los próximos *10 minutos*.\n\n👉 Abre el Huerto y riega ahora para aprovechar.',
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🌱 Abrir Huerto', web_app: { url: MINI_APP_URL } }]] } }
        );
      } catch (e) {}
    }
  } catch (e) {}
}

function deactivateMoon() {
  moonState.active = false;
  moonState.startedAt = 0;
  moonState.endsAt = 0;
  console.log('🌑 Luna llena terminada');
  scheduleNextMoon();
}

function tickMoon() {
  const now = Math.floor(Date.now() / 1000);
  const key = todayKeyUTC();
  if (moonState.todayKey !== key) {
    moonState.todayKey = key;
    moonState.eventsToday = 0;
  }
  if (moonState.active && now >= moonState.endsAt) {
    deactivateMoon();
    return;
  }
  if (!moonState.active && moonState.nextEventAt > 0 && now >= moonState.nextEventAt) {
    activateMoon();
  }
}

moonState.todayKey = todayKeyUTC();
scheduleNextMoon();
setInterval(tickMoon, 30 * 1000);

// ==== ESTADO BENDICIÓN DEL FARAÓN ====
const BLESSING_DURATION = 30 * 60 * 1000;
const BLESSING_FRUIT_MULTIPLIER = 2;

const blessingState = {
  active: false,
  startedAt: 0,
  endsAt: 0,
  eventScheduledToday: false,
  todayKey: ''
};

function scheduleBlessing() {
  const key = todayKeyUTC();
  if (blessingState.todayKey !== key) {
    blessingState.todayKey = key;
    blessingState.eventScheduledToday = false;
    blessingState.active = false;
  }
  if (!blessingState.eventScheduledToday) {
    blessingState.eventScheduledToday = true;
    const randomHour = randInt(0, 23);
    const randomMin = randInt(0, 59);
    console.log(`👑 Bendición del Faraón programada para hoy a las ${randomHour}:${randomMin}`);

    const now = new Date();
    const targetTime = new Date();
    targetTime.setUTCHours(randomHour, randomMin, 0, 0);

    let msUntilEvent = targetTime.getTime() - now.getTime();
    if (msUntilEvent < 0) msUntilEvent += 24 * 60 * 60 * 1000;

    setTimeout(activateBlessing, msUntilEvent);
  }
}

function activateBlessing() {
  blessingState.active = true;
  blessingState.startedAt = Date.now();
  blessingState.endsAt = Date.now() + BLESSING_DURATION;
  console.log('👑 ¡BENDICIÓN DEL FARAÓN ACTIVA! Fruto x2');
  notificarBendicion();

  setTimeout(() => {
    blessingState.active = false;
    console.log('👑 Bendición del Faraón terminada.');
    scheduleBlessing();
  }, BLESSING_DURATION);
}

async function notificarBendicion() {
  if (!bot) return;
  try {
    const { data: usuarios } = await supabase.from('users_balance').select('chat_id').not('chat_id', 'is', null);
    if (!usuarios || usuarios.length === 0) return;
    for (const u of usuarios) {
      try {
        await bot.sendMessage(u.chat_id,
          '👑 *¡BENDICIÓN DEL FARAÓN ACTIVA!*\n\nTodos los que cosechen durante los próximos *30 minutos* obtendrán *Fruto x2*.\n\n👉 Abre el Huerto y cosecha ahora.',
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🌱 Abrir Huerto', web_app: { url: MINI_APP_URL } }]] } }
        );
      } catch (e) {}
    }
  } catch (e) {}
}

scheduleBlessing();

// ==== MONITOR DE DEPÓSITOS ====
const ifaceTransfer = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
let monitorRunning = false;

async function checkDeposits() {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    const currentBlock = await provider.getBlockNumber();
    const { data: users, error } = await supabase.from('users_balance')
      .select('user_id, deposit_address, wallet_balance, last_deposit_block')
      .not('deposit_address', 'is', null);
    if (error || !users || users.length === 0) {
      monitorRunning = false;
      return;
    }
    const toBlock = currentBlock - 3;
    for (const u of users) {
      try {
        let fromBlock = (!u.last_deposit_block || u.last_deposit_block === 0) ? MONITOR_START_BLOCK : u.last_deposit_block + 1;
        if (fromBlock > toBlock) continue;
        const maxToBlock = Math.min(fromBlock + BLOCKS_PER_CYCLE, toBlock);
        const allLogs = [];
        let batchStart = fromBlock;
        while (batchStart <= maxToBlock) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, maxToBlock);
          try {
            const batchLogs = await provider.getLogs({
              address: TOKEN_ADDRESS,
              topics: [TRANSFER_TOPIC, null, ethers.zeroPadValue(u.deposit_address.toLowerCase(), 32)],
              fromBlock: batchStart,
              toBlock: batchEnd
            });
            allLogs.push(...batchLogs);
          } catch (batchErr) {}
          batchStart = batchEnd + 1;
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
        await supabase.from('users_balance').update({ last_deposit_block: maxToBlock }).eq('user_id', u.user_id);
        for (const log of allLogs) {
          const decoded = ifaceTransfer.parseLog({ topics: log.topics, data: log.data });
          const amount = parseFloat(ethers.formatUnits(decoded.args.value, 18));
          const txHash = log.transactionHash;
          const fromAddress = decoded.args.from;
          const { data: existing } = await supabase.from('deposits').select('tx_hash').eq('tx_hash', txHash).maybeSingle();
          if (existing) continue;
          await supabase.from('deposits').insert({ user_id: u.user_id, wallet: fromAddress, amount, tx_hash: txHash, created_at: Math.floor(Date.now() / 1000) });
          const newWalletBalance = parseFloat(u.wallet_balance || 0) + amount;
          await supabase.from('users_balance').update({ wallet_balance: newWalletBalance }).eq('user_id', u.user_id);
          u.wallet_balance = newWalletBalance;
          await addHistory(u.user_id, 'deposit', amount, '💵 Depósito a wallet personal', null, txHash);
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {}
    }
  } catch (e) {}
  monitorRunning = false;
}

setInterval(checkDeposits, 60 * 1000);
setTimeout(checkDeposits, 15 * 1000);

// ==== VALIDACIÓN INITDATA ====
function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckArr = [];
    for (const [key, value] of params.entries()) {
      dataCheckArr.push(key + '=' + value);
    }
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash !== hash) return null;
    const authDate = parseInt(params.get('auth_date') || '0');
    if (Math.floor(Date.now() / 1000) - authDate > 86400) return null;
    const userJson = params.get('user');
    if (!userJson) return null;
    const userObj = JSON.parse(userJson);
    return userObj.id ? String(userObj.id) : null;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const initData = req.body.initData || req.headers['x-init-data'] || req.query.initData;
  const verifiedUserId = validateInitData(initData);
  if (!verifiedUserId) return res.status(401).json({ error: 'No autorizado: initData inválido o expirado' });
  const claimedUserId = req.body.userId || req.params.userId;
  if (claimedUserId && String(claimedUserId) !== String(verifiedUserId)) return res.status(401).json({ error: 'No autorizado: userId no coincide' });
  req.userId = verifiedUserId;
  next();
}

// ==== HUERTO ====
const PLANT_LEVELS = {
  basic:   { name: 'Básica',  emoji: '🌱', price: 10000, waterCost: 40,  fruitValue: 125, sellPrice: 20400, canSell: true  },
  medium:  { name: 'Media',   emoji: '🌿', price: 20000, waterCost: 80,  fruitValue: 250, sellPrice: 40800, canSell: true  },
  premium: { name: 'Premium', emoji: '🌳', price: 30000, waterCost: 120, fruitValue: 375, sellPrice: 61200, canSell: true  },
  pro:     { name: 'Pro',     emoji: '🌴', price: 40000, waterCost: 160, fruitValue: 500, sellPrice: 0,     canSell: false }
};

const MAX_PLANTS = 12;
const GROW_TIME_MIN = 25;
const PERFECT_WINDOW = 35;
const ROT_TIME = 60;
const PLANT_LIFETIME_DAYS = 30;
const PLANT_LIFETIME_SECONDS = PLANT_LIFETIME_DAYS * 24 * 60 * 60;
const LIFETIME_MINUTES = PLANT_LIFETIME_DAYS * 24 * 60;

function getSellPrice(plant) {
  const level = PLANT_LEVELS[plant.level];
  if (!level.canSell) return 0;
  const now = Math.floor(Date.now() / 1000);
  const createdAt = plant.created_at || now;
  const ageMinutes = Math.max(0, (now - createdAt) / 60);
  if (ageMinutes >= LIFETIME_MINUTES) return 0;
  const percentage = 1 - (ageMinutes / LIFETIME_MINUTES);
  return Math.max(0, Math.floor(level.price * percentage));
}

function getPlantStatus(plant) {
  const now = Math.floor(Date.now() / 1000);
  const level = PLANT_LEVELS[plant.level];
  const createdAt = plant.created_at || now;
  const ageSeconds = now - createdAt;
  const lifetimeLeft = PLANT_LIFETIME_SECONDS - ageSeconds;
  const daysLeft = Math.max(0, Math.floor(lifetimeLeft / 86400));

  if (lifetimeLeft <= 0) {
    return { status: 'expired', value: 0, minutesLeft: 0, progress: 0, canRefund: false, daysLeft: 0, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
  }

  if (plant.status === 'dry' || !plant.last_watered) {
    return { status: 'dry', value: 0, minutesLeft: 0, progress: 0, canRefund: false, daysLeft, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
  }

  const moonMult = parseFloat(plant.moon_multiplier || 1) || 1;
  const effectiveGrowTime = GROW_TIME_MIN / moonMult;
  const elapsed = (now - plant.last_watered) / 60;

  if (elapsed < effectiveGrowTime) {
    const progress = Math.floor((elapsed / effectiveGrowTime) * 100);
    return { status: 'growing', value: 0, minutesLeft: Math.ceil(effectiveGrowTime - elapsed), progress: Math.min(progress, 99), canRefund: false, moonBoost: moonMult > 1, daysLeft, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
  }

  const elapsedSinceReady = elapsed - effectiveGrowTime;
  const perfectDuration = PERFECT_WINDOW - GROW_TIME_MIN;

  if (elapsedSinceReady <= perfectDuration) {
    return { status: 'ready', value: level.fruitValue, minutesLeft: Math.ceil(perfectDuration - elapsedSinceReady), progress: 100, canRefund: false, moonBoost: moonMult > 1, daysLeft, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
  }

  const witheringTotal = ROT_TIME - PERFECT_WINDOW;
  const witheringElapsed = elapsedSinceReady - perfectDuration;

  if (witheringElapsed <= witheringTotal) {
    const withering = witheringElapsed / witheringTotal;
    const value = level.fruitValue * (1 - withering * 0.1);
    return { status: 'withering', value: Math.max(0, value), minutesLeft: Math.ceil(witheringTotal - witheringElapsed), progress: 100, canRefund: false, moonBoost: moonMult > 1, daysLeft, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
  }

  return { status: 'rotten', value: 0, minutesLeft: 0, progress: 0, canRefund: true, moonBoost: moonMult > 1, daysLeft, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
}

// ==== HELPERS ====
function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'hace ' + seconds + 's';
  if (seconds < 3600) return 'hace ' + Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return 'hace ' + Math.floor(seconds / 3600) + 'h';
  return 'hace ' + Math.floor(seconds / 86400) + 'd';
}

function spinRoulette() {
  const random = Math.random() * 100;
  if (random < 37) return 0;
  else if (random < 82) return 1.1;
  else if (random < 90) return 2;
  else if (random < 95) return 4;
  else if (random < 98) return 6;
  else if (random < 99) return 8;
  else return 10;
}

async function getUser(userId) {
  const { data } = await supabase.from('users_balance').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

async function ensureUser(userId) {
  const user = await getUser(userId);
  if (!user) {
    await supabase.from('users_balance').insert({ user_id: userId, balance: 0 });
    return await getUser(userId);
  }
  return user;
}

async function addHistory(userId, type, amount, description, metadata, txHash) {
  try {
    await supabase.from('history').insert({
      user_id: userId, type, amount, description,
      metadata: metadata || null, tx_hash: txHash || null,
      created_at: Math.floor(Date.now() / 1000)
    });
  } catch (e) { console.error('Error history:', e); }
}

async function refundPlant(userId, plantId) {
  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', userId).maybeSingle();
    if (!plant) return { success: false, error: 'Planta no encontrada' };
    const status = getPlantStatus(plant);
    if (status.status !== 'rotten') return { success: false, error: 'La planta todavía no está podrida' };
    const level = PLANT_LEVELS[plant.level];
    const refundAmount = level.waterCost * 0.9;
    const user = await ensureUser(userId);
    const newBalance = parseFloat(user.balance) + refundAmount;
    await supabase.from('users_balance').update({ balance: newBalance }).eq('user_id', userId);
    await supabase.from('history').insert({
      user_id: userId, type: 'plant_refund', amount: refundAmount,
      description: 'Reembolso 90% del riego (' + level.name + ')',
      metadata: String(plantId), tx_hash: null,
      created_at: Math.floor(Date.now() / 1000)
    });
    await supabase.from('plants').update({ status: 'dry', last_watered: null, moon_multiplier: 1 }).eq('id', plantId).eq('user_id', userId);
    return { success: true, amount: refundAmount, message: '¡Recibiste ' + refundAmount.toFixed(2) + ' JHOAL de reembolso (90% del riego)!' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function cleanupExpiredPlants() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const limiteExpiracion = now - PLANT_LIFETIME_SECONDS;
    const { data: expiradas } = await supabase
      .from('plants')
      .select('id, user_id, level, created_at')
      .lt('created_at', limiteExpiracion);
    if (!expiradas || expiradas.length === 0) return;
    console.log(`🧹 ${expiradas.length} plantas expiradas detectadas`);
    for (const p of expiradas) {
      const level = PLANT_LEVELS[p.level];
      const nombreNivel = level ? level.name : p.level;
      await supabase.from('history').insert({
        user_id: p.user_id,
        type: 'plant_expired',
        amount: 0,
        description: '💀 Tu planta ' + nombreNivel + ' ha expirado (30 días). ¡Ya puedes sembrar otra planta en su lugar! 🌱',
        metadata: String(p.id),
        tx_hash: null,
        created_at: now
      });
    }
    const ids = expiradas.map(p => p.id);
    await supabase.from('plants').delete().in('id', ids);
    console.log(`🧹 ${expiradas.length} plantas eliminadas (espacios libres)`);
  } catch (e) {
    console.error('Error cleanupExpiredPlants:', e);
  }
}

async function cleanupOldPlants() {
  try {
    console.log('🧹 Buscando plantas viejas sin created_at...');
    const now = Math.floor(Date.now() / 1000);
    const { data: sinFecha } = await supabase.from('plants').select('id').is('created_at', null);
    if (sinFecha && sinFecha.length > 0) {
      const ids = sinFecha.map(p => p.id);
      await supabase.from('plants').update({ created_at: now }).in('id', ids);
      console.log('✅ Fechas asignadas a', sinFecha.length, 'plantas viejas');
    } else {
      console.log('✅ No hay plantas sin fecha');
    }
  } catch (e) {
    console.error('Error cleanupOldPlants:', e);
  }
}

// ==== REFERIDOS HELPERS ====
async function otorgarRecompensaReferido(referrerId, referredId) {
  try {
    const { data: yaExiste } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_id', referredId)
      .maybeSingle();
    if (yaExiste) return { success: false, error: 'Ya se pagó este referido' };

    const referredUser = await ensureUser(referredId);
    if (!referredUser.total_claimed || parseFloat(referredUser.total_claimed) < 1) {
      return { success: false, error: 'El referido aún no reclama el faucet' };
    }

    const { error: insErr } = await supabase.from('referrals').insert({
      referrer_id: referrerId,
      referred_id: referredId,
      reward: REFERRAL_REWARD,
      created_at: Math.floor(Date.now() / 1000)
    });
    if (insErr) return { success: false, error: insErr.message };

    const referrer = await ensureUser(referrerId);
    const nuevoBalance = parseFloat(referrer.balance || 0) + REFERRAL_REWARD;
    await supabase.from('users_balance')
      .update({ balance: nuevoBalance })
      .eq('user_id', referrerId);

    await addHistory(
      referrerId,
      'referral_reward',
      REFERRAL_REWARD,
      '🎁 Recompensa por referido (' + referredId + ')',
      null,
      null
    );

    console.log(`🎁 Referido pagado: ${referrerId} +${REFERRAL_REWARD} JHOAL por ${referredId}`);

    if (bot && referrer.chat_id) {
      try {
        await bot.sendMessage(referrer.chat_id,
          `🎁 *¡NUEVO REFERIDO!*\n\nGanaste *${REFERRAL_REWARD} JHOAL* por invitar a un nuevo guerrero.\n\n💰 Total acreditado en tu saldo.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
    }

    return { success: true };
  } catch (e) {
    console.error('Error otorgarRecompensaReferido:', e);
    return { success: false, error: e.message };
  }
}

async function intentarPagarReferido(userId) {
  try {
    const { data: pendiente } = await supabase
      .from('referrals_pending')
      .select('*')
      .eq('referred_id', userId)
      .maybeSingle();
    if (!pendiente) return;
    const result = await otorgarRecompensaReferido(pendiente.referrer_id, userId);
    if (result.success) {
      await supabase.from('referrals_pending').delete().eq('referred_id', userId);
    }
  } catch (e) {
    console.error('Error intentarPagarReferido:', e);
  }
}

// ==== ENDPOINTS ====
app.get('/moon-status', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  res.json({
    success: true,
    active: moonState.active,
    startedAt: moonState.startedAt,
    endsAt: moonState.endsAt,
    secondsLeft: moonState.active ? Math.max(0, moonState.endsAt - now) : 0,
    multiplier: MOON_GROWTH_MULTIPLIER,
    durationMinutes: MOON_DURATION_MIN,
    eventsToday: moonState.eventsToday
  });
});

app.get('/blessing-status', (req, res) => {
  const now = Date.now();
  res.json({
    success: true,
    active: blessingState.active,
    startedAt: blessingState.startedAt,
    endsAt: blessingState.endsAt,
    secondsLeft: blessingState.active ? Math.max(0, Math.floor((blessingState.endsAt - now) / 1000)) : 0,
    multiplier: BLESSING_FRUIT_MULTIPLIER
  });
});

app.post('/register-referral', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { referrerId } = req.body;
  if (!referrerId || String(referrerId) === String(userId)) {
    return res.json({ success: true, message: 'Sin referido válido' });
  }
  try {
    const { data: yaPagado } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_id', userId)
      .maybeSingle();
    if (yaPagado) return res.json({ success: true, message: 'Ya referido' });

    const { data: yaPendiente } = await supabase
      .from('referrals_pending')
      .select('id')
      .eq('referred_id', userId)
      .maybeSingle();
    if (yaPendiente) return res.json({ success: true, message: 'Ya pendiente' });

    await supabase.from('referrals_pending').insert({
      referrer_id: String(referrerId),
      referred_id: String(userId),
      created_at: Math.floor(Date.now() / 1000)
    });

    console.log(`🔗 Referido pendiente: ${referrerId} ← ${userId}`);
    res.json({ success: true, message: 'Referido registrado, se paga al primer reclamo' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/my-referrals/:userId', requireAuth, async (req, res) => {
  const userId = req.userId;
  try {
    const { data: referidos } = await supabase
      .from('referrals')
      .select('referred_id, reward, created_at')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false });

    const total = (referidos || []).reduce((s, r) => s + parseFloat(r.reward || 0), 0);

    res.json({
      success: true,
      link: 'https://t.me/' + REFERRAL_BOT_USERNAME + '?start=ref_' + userId,
      count: (referidos || []).length,
      totalEarned: total,
      rewardPerReferral: REFERRAL_REWARD,
      referrals: referidos || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/register-user', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { chatId } = req.body;
  if (!chatId) return res.json({ success: true, message: 'Sin chatId' });
  try {
    await ensureUser(userId);
    await supabase.from('users_balance').update({ chat_id: chatId }).eq('user_id', userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/my-deposit-wallet', requireAuth, async (req, res) => {
  const userId = req.userId;
  try {
    const user = await ensureUser(userId);
    if (user.deposit_address) {
      return res.json({ success: true, address: user.deposit_address, walletBalance: parseFloat(user.wallet_balance || 0) });
    }
    const newWallet = ethers.Wallet.createRandom();
    const encryptedKey = encryptPrivateKey(newWallet.privateKey);
    await supabase.from('users_balance')
      .update({
        deposit_address: newWallet.address,
        deposit_private_key: encryptedKey,
        wallet_balance: 0,
        last_deposit_block: await getProvider().then(p => p.getBlockNumber()).then(b => b - 10)
      })
      .eq('user_id', userId);
    res.json({ success: true, address: newWallet.address, walletBalance: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/move-to-game', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
  try {
    const user = await ensureUser(userId);
    if (!user.deposit_address || !user.deposit_private_key) return res.status(400).json({ error: 'No tienes wallet personal' });
    if (parseFloat(user.wallet_balance || 0) < amount) return res.status(400).json({ error: 'Saldo insuficiente en wallet' });
    const realBalanceWei = await token.balanceOf(user.deposit_address);
    const realBalance = parseFloat(ethers.formatUnits(realBalanceWei, 18));
    if (realBalance < amount) return res.status(400).json({ error: 'La wallet no tiene fondos suficientes' });
    const bnbNeeded = ethers.parseEther('0.000002');
    const bnbBalance = await provider.getBalance(user.deposit_address);
    if (bnbBalance < bnbNeeded) {
      const bnbTx = await wallet.sendTransaction({ to: user.deposit_address, value: bnbNeeded });
      await bnbTx.wait();
    }
    const pk = decryptPrivateKey(user.deposit_private_key);
    const userSigner = new ethers.Wallet(pk, provider);
    const userToken = new ethers.Contract(TOKEN_ADDRESS, ABI, userSigner);
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await userToken.transfer(wallet.address, amountWei);
    await tx.wait();
    const newWalletBalance = parseFloat(user.wallet_balance) - amount;
    const newGameBalance = parseFloat(user.balance) + amount;
    await supabase.from('users_balance').update({ wallet_balance: newWalletBalance, balance: newGameBalance }).eq('user_id', userId);
    await addHistory(userId, 'deposit_game', amount, '🎮 Movido al saldo del juego', null, tx.hash);
    res.json({ success: true, txHash: tx.hash, newWalletBalance, newGameBalance, explorer: 'https://bscscan.com/tx/' + tx.hash });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/claim', requireAuth, async (req, res) => {
  const userId = req.userId;
  try {
    const user = await ensureUser(userId);
    const now = Math.floor(Date.now() / 1000);
    if (user.last_claim && now - user.last_claim < COOLDOWN) {
      const restante = COOLDOWN - (now - user.last_claim);
      return res.status(429).json({ error: 'Espera ' + Math.floor(restante / 60) + 'm ' + (restante % 60) + 's antes de reclamar otra vez' });
    }
    const newBalance = parseFloat(user.balance) + 1;
    const newClaimed = parseFloat(user.total_claimed || 0) + 1;
    await supabase.from('users_balance').update({ balance: newBalance, total_claimed: newClaimed, last_claim: now }).eq('user_id', userId);
    await addHistory(userId, 'faucet', 1, 'Reclamo del faucet', null, null);

    intentarPagarReferido(userId);

    res.json({ success: true, amount: 1, message: '¡1 JHOAL añadido a tu saldo!' });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.post('/claim-ad-reward-manual', requireAuth, async (req, res) => {
  const userId = req.userId;
  try {
    const user = await ensureUser(userId);
    const now = Math.floor(Date.now() / 1000);
    const lastAdReward = user.last_ad_reward || 0;
    if (now - lastAdReward < AD_COOLDOWN) {
      const restante = AD_COOLDOWN - (now - lastAdReward);
      return res.status(429).json({ error: 'Espera ' + Math.ceil(restante / 60) + ' min para ver otro anuncio' });
    }
    const newBalance = parseFloat(user.balance) + AD_REWARD_AMOUNT;
    await supabase.from('users_balance').update({ balance: newBalance, last_ad_reward: now }).eq('user_id', userId);
    await addHistory(userId, 'ad_reward', AD_REWARD_AMOUNT, '📺 Recompensa por ver anuncio', null, null);
    res.json({ success: true, amount: AD_REWARD_AMOUNT, newBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/claim-ad-reward', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Falta userId' });

    const user = await ensureUser(userId);
    const now = Math.floor(Date.now() / 1000);
    const lastAdReward = user.last_ad_reward || 0;

    if (now - lastAdReward < AD_COOLDOWN) {
      console.log(`⚠️ AdsGram: user ${userId} en cooldown`);
      return res.json({ success: true, message: 'Cooldown activo' });
    }

    const newBalance = parseFloat(user.balance) + AD_REWARD_AMOUNT;
    await supabase.from('users_balance').update({ balance: newBalance, last_ad_reward: now }).eq('user_id', userId);
    await addHistory(userId, 'ad_reward', AD_REWARD_AMOUNT, '📺 Recompensa por ver anuncio (AdsGram)', null, null);

    console.log(`✅ AdsGram: user ${userId} +${AD_REWARD_AMOUNT} JHOAL`);
    res.json({ success: true, amount: AD_REWARD_AMOUNT, newBalance });
  } catch (e) {
    console.error('Error claim-ad-reward AdsGram:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/balance-game/:userId', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    if (!user) return res.json({ success: true, balance: 0, wallet_balance: 0, total_claimed: 0, total_won: 0, total_lost: 0, last_claim: 0, last_ad_reward: 0 });
    res.json({
      success: true,
      balance: parseFloat(user.balance),
      wallet_balance: parseFloat(user.wallet_balance || 0),
      total_claimed: parseFloat(user.total_claimed || 0),
      total_won: parseFloat(user.total_won || 0),
      total_lost: parseFloat(user.total_lost || 0),
      last_claim: user.last_claim || 0,
      last_ad_reward: user.last_ad_reward || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/bet', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: 'Faltan datos' });
  if (amount < MIN_BET || amount > MAX_BET) return res.status(400).json({ error: 'Apuesta inválida (' + MIN_BET + '-' + MAX_BET + ')' });
  try {
    const user = await ensureUser(userId);
    if (parseFloat(user.balance) < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
    const multiplier = spinRoulette();
    const payout = amount * multiplier;
    const profit = payout - amount;
    const now = Math.floor(Date.now() / 1000);
    let newBalance, newWon, newLost;
    if (multiplier === 0) {
      newBalance = parseFloat(user.balance) - amount;
      newWon = parseFloat(user.total_won || 0);
      newLost = parseFloat(user.total_lost || 0) + amount;
    } else {
      newBalance = parseFloat(user.balance) - amount + payout;
      newWon = parseFloat(user.total_won || 0) + profit;
      newLost = parseFloat(user.total_lost || 0);
    }
    await supabase.from('users_balance').update({ balance: newBalance, total_won: newWon, total_lost: newLost }).eq('user_id', userId);
    await supabase.from('bets').insert({ user_id: userId, amount, multiplier, payout, result: multiplier === 0 ? 'lose' : 'win', created_at: now });
    if (multiplier === 0) {
      await addHistory(userId, 'dice_lose', -amount, 'Perdiste en los dados (x0)', null, null);
    } else {
      await addHistory(userId, 'dice_win', profit, 'Ganaste x' + multiplier + ' en los dados', null, null);
    }
    res.json({ success: true, multiplier, payout, profit, newBalance });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.get('/bet-history/:userId', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('bets').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(10);
    res.json({ success: true, bets: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/withdraw', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { wallet: userWallet, amount } = req.body;
  if (!userWallet || !amount) return res.status(400).json({ error: 'Faltan datos' });
  if (!ethers.isAddress(userWallet)) return res.status(400).json({ error: 'Wallet inválida' });
  if (amount <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
  try {
    const user = await ensureUser(userId);
    if (parseFloat(user.balance) < amount) return res.status(400).json({ error: 'Saldo insuficiente' });
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await token.transfer(userWallet, amountWei);
    const newBalance = parseFloat(user.balance) - amount;
    const newWithdrawn = parseFloat(user.total_withdrawn || 0) + amount;
    await supabase.from('users_balance').update({ balance: newBalance, total_withdrawn: newWithdrawn }).eq('user_id', userId);
    await supabase.from('withdrawals').insert({ user_id: userId, wallet: userWallet, amount, tx_hash: tx.hash, created_at: Math.floor(Date.now() / 1000) });
    await addHistory(userId, 'withdraw', -amount, 'Retiro a wallet', null, tx.hash);
    await tx.wait();
    res.json({ success: true, txHash: tx.hash, explorer: 'https://bscscan.com/tx/' + tx.hash, amount });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.get('/deposit-info', (req, res) => {
  res.json({ success: true, depositWallet: wallet.address, tokenAddress: TOKEN_ADDRESS, minDeposit: 1 });
});

app.post('/buy-plant', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { level } = req.body;
  if (!level) return res.status(400).json({ error: 'Faltan datos' });
  if (!PLANT_LEVELS[level]) return res.status(400).json({ error: 'Nivel inválido' });
  try {
    const user = await ensureUser(userId);
    const { count } = await supabase.from('plants').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (count >= MAX_PLANTS) return res.status(400).json({ error: 'Máximo ' + MAX_PLANTS + ' plantas por usuario' });
    const plantInfo = PLANT_LEVELS[level];
    if (parseFloat(user.balance) < plantInfo.price) return res.status(400).json({ error: 'Saldo insuficiente. Necesitás ' + plantInfo.price + ' JHOAL' });
    const now = Math.floor(Date.now() / 1000);
    const newBalance = parseFloat(user.balance) - plantInfo.price;
    await supabase.from('users_balance').update({ balance: newBalance }).eq('user_id', userId);
    await supabase.from('plants').insert({ user_id: userId, level, status: 'dry', created_at: now, moon_multiplier: 1 });
    await addHistory(userId, 'plant_buy', -plantInfo.price, 'Compraste planta ' + plantInfo.name, null, null);
    res.json({ success: true, message: '¡Compraste una planta ' + plantInfo.name + '!', expiresInDays: PLANT_LIFETIME_DAYS });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.post('/water-plant', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { plantId } = req.body;
  if (!plantId) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', userId).maybeSingle();
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });
    const status = getPlantStatus(plant);
    if (status.status === 'expired') {
      return res.status(400).json({ error: '🌱 Esta planta ya cumplió su ciclo. Plantá una nueva semilla.' });
    }
    if (status.status !== 'dry' && status.status !== 'rotten') return res.status(400).json({ error: 'La planta todavía tiene fruto o está creciendo' });
    const user = await ensureUser(userId);
    const level = PLANT_LEVELS[plant.level];
    if (parseFloat(user.balance) < level.waterCost) return res.status(400).json({ error: 'Saldo insuficiente. Necesitás ' + level.waterCost + ' JHOAL' });
    const now = Math.floor(Date.now() / 1000);
    const newBalance = parseFloat(user.balance) - level.waterCost;
    const moonMult = moonState.active ? MOON_GROWTH_MULTIPLIER : 1;
    const effectiveGrowTime = Math.round((GROW_TIME_MIN / moonMult) * 10) / 10;
    await supabase.from('users_balance').update({ balance: newBalance }).eq('user_id', userId);
    await supabase.from('plants').update({ last_watered: now, status: 'growing', moon_multiplier: moonMult }).eq('id', plantId).eq('user_id', userId);
    const moonMsg = moonMult > 1 ? ' 🌕 ¡Luna Llena activa!' : '';
    await addHistory(userId, 'plant_water', -level.waterCost, 'Regaste ' + level.name + (moonMult > 1 ? ' (Luna Llena 🌕)' : ''), null, null);
    res.json({ success: true, message: '¡Regaste tu planta! Lista en ' + effectiveGrowTime + ' minutos.' + moonMsg, moonActive: moonMult > 1, growTimeMinutes: effectiveGrowTime });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.post('/harvest', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { plantId } = req.body;
  if (!plantId) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', userId).maybeSingle();
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });

    const status = getPlantStatus(plant);
    if (status.status === 'expired') return res.status(400).json({ error: '🌱 Esta planta ya cumplió su ciclo.' });
    if (status.status !== 'ready' && status.status !== 'withering') return res.status(400).json({ error: 'Todavía no podés cosechar esta planta' });

    let value = status.value;
    if (value <= 0) return res.status(400).json({ error: 'El fruto está podrido' });

    let multiplicadorBendicion = 1;
    if (blessingState.active) {
      multiplicadorBendicion = BLESSING_FRUIT_MULTIPLIER;
      value = value * multiplicadorBendicion;
    }

    const user = await ensureUser(userId);
    const newBalance = parseFloat(user.balance) + value;
    const newWon = parseFloat(user.total_won || 0) + value;
    await supabase.from('users_balance').update({ balance: newBalance, total_won: newWon }).eq('user_id', userId);
    await supabase.from('plants').update({ status: 'dry', last_watered: null, moon_multiplier: 1 }).eq('id', plantId).eq('user_id', userId);

    const level = PLANT_LEVELS[plant.level];
    const msg = multiplicadorBendicion > 1 ? ' 👑 ¡Bendición del Faraón x2 aplicada!' : '';
    await addHistory(userId, 'plant_harvest', value, 'Cosechaste ' + level.name + msg, null, null);

    res.json({ success: true, value, message: '¡Cosechaste ' + value.toFixed(2) + ' JHOAL!' + msg });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.post('/sell-plant', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { plantId } = req.body;
  if (!plantId) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', userId).maybeSingle();
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });
    const level = PLANT_LEVELS[plant.level];
    if (!level.canSell) return res.status(400).json({ error: '❌ La planta ' + level.name + ' no se puede vender.' });
    const sellValue = getSellPrice(plant);
    if (sellValue <= 0) {
      return res.status(400).json({ error: 'La planta ya no tiene valor de venta. Dejala cumplir su ciclo.' });
    }
    const user = await ensureUser(userId);
    const newBalance = parseFloat(user.balance) + sellValue;
    await supabase.from('users_balance').update({ balance: newBalance }).eq('user_id', userId);
    await supabase.from('plants').delete().eq('id', plantId).eq('user_id', userId);
    const ageMinutes = Math.floor((Date.now()/1000 - plant.created_at) / 60);
    await addHistory(userId, 'plant_sell', sellValue, 'Vendiste ' + level.name + ' (minuto ' + ageMinutes + ')', null, null);
    res.json({ success: true, value: sellValue, message: '¡Vendiste por ' + sellValue.toLocaleString() + ' JHOAL!' });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.post('/refund-plant', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { plantId } = req.body;
  if (!plantId) return res.status(400).json({ error: 'Faltan datos' });
  const result = await refundPlant(userId, plantId);
  if (result.success) {
    res.json({ success: true, amount: result.amount, message: result.message });
  } else {
    res.status(400).json({ error: result.error });
  }
});

app.get('/my-plants/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { data: plants } = await supabase.from('plants').select('*').eq('user_id', userId).order('created_at', { ascending: true });

    const plantsWithStatus = (plants || []).map(function(p) {
      const status = getPlantStatus(p);
      const level = PLANT_LEVELS[p.level];
      const sellValue = getSellPrice(p);
      const now = Math.floor(Date.now() / 1000);
      const createdAt = p.created_at || now;
      const ageMinutes = Math.max(0, (now - createdAt) / 60);
      const sellPercentage = level.canSell ? Math.max(0, Math.round((1 - ageMinutes / LIFETIME_MINUTES) * 100)) : 0;
      return {
        id: p.id, level: p.level, levelName: level.name, emoji: level.emoji,
        status: status.status, value: status.value,
        minutesLeft: status.minutesLeft || 0, progress: status.progress || 0,
        waterCost: level.waterCost, fruitValue: level.fruitValue,
        sellPrice: sellValue,
        sellPercentage: sellPercentage,
        originalSellPrice: level.price,
        canSell: level.canSell && sellValue > 0,
        lastWatered: p.last_watered,
        canRefund: status.canRefund || false,
        refundAmount: status.canRefund ? (level.waterCost * 0.9) : 0,
        moonBoost: status.moonBoost || false,
        daysLeft: status.daysLeft || 0,
        expiresAt: status.expiresAt || null
      };
    });

    res.json({
      success: true,
      plants: plantsWithStatus,
      count: plantsWithStatus.length,
      maxPlants: MAX_PLANTS,
      plantLevels: PLANT_LEVELS,
      lifetimeDays: PLANT_LIFETIME_DAYS,
      moon: { active: moonState.active, endsAt: moonState.endsAt, multiplier: MOON_GROWTH_MULTIPLIER },
      blessing: { active: blessingState.active, endsAt: blessingState.endsAt, multiplier: BLESSING_FRUIT_MULTIPLIER }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.get('/history/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type;
    let query = supabase.from('history').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (type && type !== 'all') query = query.eq('type', type);
    const { data: history } = await query;
    const { data: allHistory } = await supabase.from('history').select('type, amount').eq('user_id', userId);
    let summary = { faucet: 0, dice: 0, deposit: 0, withdraw: 0, garden: 0, referral: 0, total: 0 };
    (allHistory || []).forEach(function(h) {
      const amount = parseFloat(h.amount) || 0;
      if (h.type === 'faucet') summary.faucet += amount;
      else if (h.type === 'dice_win' || h.type === 'dice_lose') summary.dice += amount;
      else if (h.type === 'deposit' || h.type === 'deposit_game') summary.deposit += amount;
      else if (h.type === 'withdraw') summary.withdraw += amount;
      else if (h.type === 'referral_reward') summary.referral += amount;
      else if (h.type && h.type.startsWith('plant_')) summary.garden += amount;
      summary.total += amount;
    });
    res.json({ success: true, history: history || [], summary: summary });
  } catch (error) {
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

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
    res.json({ success: true, priceUsd: usdtAmount / jhoalAmount, jhoalPerUsdt: jhoalAmount / usdtAmount, jhoalReserve: jhoalAmount, usdtReserve: usdtAmount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/balance', async (req, res) => {
  try {
    const balance = await token.balanceOf(wallet.address);
    const bnb = await provider.getBalance(wallet.address);
    res.json({ wallet: wallet.address, jhoal: ethers.formatUnits(balance, 18) + ' JHOAL', bnb: ethers.formatEther(bnb) + ' BNB' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/huerto-warning', (req, res) => {
  res.json({
    success: true,
    title: '⚠️ AVISO IMPORTANTE – HUERTO DE HORUS ⚠️',
    message: '🌱 El que no cosecha, PIERDE.\nLas plantas duran solo 30 días. Si no las RIEGAS y cosechás a tiempo, el fruto se pudre.\n💰 Podés reclamar el 90% del riego si se pudre.\n📉 El precio de venta de la planta baja cada minuto.\n👀 Estate atento a tus plantas.',
    lifetimeDays: PLANT_LIFETIME_DAYS,
    refundPercent: 90
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'Horus Faucet + Dados + Huerto + Historial + Luna Llena + Bendición + AdsGram + Referidos funcionando' });
});

// ==== BOT PRINCIPAL ====
let bot = null;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Bot principal iniciado');

  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
      console.log('⚠️ Conflicto de polling - verificar instancias duplicadas');
    } else {
      console.log('⚠️ Polling error:', error.code);
    }
  });

  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const name = msg.from.first_name || 'guerrero';
    const payload = (match[1] || '').trim();

    if (payload && payload.startsWith('ref_')) {
      const referrerId = payload.replace('ref_', '').trim();
      if (referrerId && referrerId !== userId) {
        try {
          const { data: yaPagado } = await supabase
            .from('referrals')
            .select('id')
            .eq('referred_id', userId)
            .maybeSingle();
          if (!yaPagado) {
            const { data: yaPendiente } = await supabase
              .from('referrals_pending')
              .select('id')
              .eq('referred_id', userId)
              .maybeSingle();
            if (!yaPendiente) {
              await supabase.from('referrals_pending').insert({
                referrer_id: String(referrerId),
                referred_id: userId,
                created_at: Math.floor(Date.now() / 1000)
              });
              console.log(`🔗 Referido pendiente desde /start: ${referrerId} ← ${userId}`);
            }
          }
        } catch (e) {
          console.error('Error registrando referido en /start:', e);
        }
      }
    }

    bot.sendMessage(chatId,
      '⚱ *HORUS FAUCET - La ofrenda del Dios Horus* 🦅\n\n' +
      '¡Bienvenido, ' + name + '!\n\n' +
      '💰 Reclama *1 JHOAL GRATIS* cada 30 minutos\n' +
      '📺 Mirá anuncios y ganá *5 JHOAL extra*\n' +
      '🎲 Juega en *Los Dados de Horus*\n' +
      '🌱 Planta en el *Huerto de Horus*\n' +
      '🌕 Atento a la *Luna Llena*\n' +
      '👑 Atento a la *Bendición del Faraón*\n' +
      '🎁 Gana *1000 JHOAL* por cada amigo que invites\n' +
      '📜 Mirá tu *Historial*\n\n' +
      '👉 Toca "Abrir Horus Faucet" para empezar.',
      { parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏛 Abrir Horus Faucet', web_app: { url: MINI_APP_URL } }]] } }
    );
  });

  bot.onText(/\/faucet/, (msg) => {
    bot.sendMessage(msg.chat.id, '🏛 *Abrir Horus Faucet*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🏛 Abrir Horus Faucet', web_app: { url: MINI_APP_URL } }]] }
    });
  });

  bot.onText(/\/invitar|\/referidos|\/ref/, async (msg) => {
    const userId = String(msg.from.id);
    const link = 'https://t.me/' + REFERRAL_BOT_USERNAME + '?start=ref_' + userId;
    const texto =
      '🏛 *HORUS FAUCET* 🦅\n\n' +
      '🎁 *INVITA Y GANA ' + REFERRAL_REWARD + ' JHOAL*\n' +
      'por cada amigo que entre con tu enlace y reclame su primer faucet.\n\n' +
      '🔗 *Tu enlace único:*\n`' + link + '`\n\n' +
      '📋 Copialo y compartilo en tus grupos.\n' +
      '💎 Sin límite de referidos.';
    try {
      await bot.sendPhoto(msg.chat.id, REFERRAL_BANNER_URL, {
        caption: texto,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Compartir enlace', url: 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('🎁 Gana 1000 JHOAL gratis en Horus Faucet 🏛') }],
            [{ text: '🏛 Abrir Horus Faucet', web_app: { url: MINI_APP_URL } }]
          ]
        }
      });
    } catch (e) {
      await bot.sendMessage(msg.chat.id, texto, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Compartir enlace', url: 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('🎁 Gana 1000 JHOAL gratis en Horus Faucet 🏛') }],
            [{ text: '🏛 Abrir Horus Faucet', web_app: { url: MINI_APP_URL } }]
          ]
        }
      });
    }
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
      '🆘 *AYUDA*\n\n/start - Iniciar\n/faucet - Abrir faucet\n/invitar - Tu enlace de referidos\n/price - Precio\n/help - Esta ayuda\n\n📩 Soporte: @' + SUPPORT_USERNAME,
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
      '🆘 *SOPORTE HORUS FAUCET*\n\n¡Hola, ' + name + '!\n\nPodés enviarme texto, fotos, videos, audios o documentos.\n\nTe vamos a responder a la brevedad.',
      { parse_mode: 'Markdown' }
    );
  });

  supportBot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text && text.startsWith('/')) return;
    const userName = msg.from.first_name || 'Usuario';
    const userUsername = msg.from.username ? '@' + msg.from.username : 'sin username';
    const userId = msg.from.id;
    const header = '📩 *NUEVO MENSAJE DE SOPORTE*\n\n👤 De: ' + userName + '\n🔗 Username: ' + userUsername + '\n🆔 ID: `' + userId + '`\n\n';
    try {
      if (msg.text) {
        supportBot.sendMessage(SUPPORT_CHAT_ID, header + '💬 Mensaje:\n' + msg.text, { parse_mode: 'Markdown' });
        supportBot.sendMessage(chatId, '✅ *Mensaje recibido*', { parse_mode: 'Markdown' });
      }
    } catch (err) {}
  });
}

// ==== INICIAR SERVIDOR ====
app.listen(process.env.PORT || 3000, () => {
  console.log('Horus Faucet corriendo en puerto', process.env.PORT || 3000);
  console.log('Wallet:', wallet.address);
  console.log('Bot principal:', BOT_TOKEN ? 'SÍ' : 'NO');
  console.log('Bot de soporte:', SUPPORT_BOT_TOKEN ? 'SÍ' : 'NO');
  console.log('Supabase:', SUPABASE_URL ? 'SÍ' : 'NO');
  console.log('🌕 Luna Llena: x' + MOON_GROWTH_MULTIPLIER);
  console.log('👑 Bendición del Faraón: Fruto x' + BLESSING_FRUIT_MULTIPLIER);
  console.log('🌱 Plantas duran ' + PLANT_LIFETIME_DAYS + ' días');
  console.log('📺 AdsGram: +' + AD_REWARD_AMOUNT + ' JHOAL cada ' + (AD_COOLDOWN/60) + ' min');
  console.log('🎁 Referidos: +' + REFERRAL_REWARD + ' JHOAL por referido válido');
  console.log('🧹 Limpieza automática de plantas: ACTIVADA');

  cleanupOldPlants();
  cleanupExpiredPlants();
  setInterval(cleanupExpiredPlants, 5 * 60 * 1000);
  setInterval(cleanupOldPlants, 6 * 60 * 60 * 1000);
});
