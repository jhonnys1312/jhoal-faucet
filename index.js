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
const RPC = 'https://rpc.ankr.com/bsc';
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
const AMOUNT = ethers.parseUnits('1', 18);
const COOLDOWN = 30 * 60;
const MIN_BET = 0.1;
const MAX_BET = 1000;

// ==== MONITOR DE DEPÓSITOS ====
const MONITOR_START_BLOCK = 122925000;
const BATCH_SIZE = 50;
const BLOCKS_PER_CYCLE = 500;
const BATCH_DELAY_MS = 200;

// ==== LUNA LLENA ====
const MOON_GROWTH_MULTIPLIER = 1.9;
const MOON_DURATION_MIN = 10;
const MOON_MIN_PER_DAY = 1;
const MOON_MAX_PER_DAY = 5;

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

// ==== SUPABASE ====
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==== ENCRIPTACIÓN DE PRIVATE KEYS ====
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.warn('⚠️ ENCRYPTION_KEY no está configurada. Las private keys no se podrán encriptar.');
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
  if (!bot) {
    console.log('No hay bot configurado, no se puede notificar');
    return;
  }

  try {
    const { data: usuarios } = await supabase
      .from('users_balance')
      .select('chat_id')
      .not('chat_id', 'is', null);

    if (!usuarios || usuarios.length === 0) {
      console.log('Sin usuarios con chat_id registrado');
      return;
    }

    console.log('🌕 Notificando a', usuarios.length, 'usuarios');

    for (const u of usuarios) {
      try {
        await bot.sendMessage(
          u.chat_id,
          '🌕 *¡LUNA LLENA ACTIVA!*\n\n' +
          'Las plantas crecen *90% más rápido* durante los próximos *10 minutos*.\n\n' +
          '👉 Abre el Huerto y riega ahora para aprovechar.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🌱 Abrir Huerto', web_app: { url: MINI_APP_URL } }
              ]]
            }
          }
        );
      } catch (e) {
        // Si el usuario bloqueó el bot, ignorar
      }
    }
  } catch (e) {
    console.error('Error notificando Luna Llena:', e);
  }
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

// ================================================================
// ==== MONITOR DE DEPÓSITOS A WALLETS PERSONALES ====
// ================================================================
const ifaceTransfer = new ethers.Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

let monitorRunning = false;

async function checkDeposits() {
  if (monitorRunning) {
    console.log('⏭️ Monitor ya corriendo, saltando...');
    return;
  }
  monitorRunning = true;

  try {
    const currentBlock = await provider.getBlockNumber();

    const { data: users, error } = await supabase
      .from('users_balance')
      .select('user_id, deposit_address, wallet_balance, last_deposit_block')
      .not('deposit_address', 'is', null);

    if (error) {
      console.error('Error obteniendo usuarios:', error);
      monitorRunning = false;
      return;
    }

    if (!users || users.length === 0) {
      monitorRunning = false;
      return;
    }

    const MIN_CONFIRMATIONS = 3;
    const toBlock = currentBlock - MIN_CONFIRMATIONS;

    for (const u of users) {
      try {
        let fromBlock;
        if (!u.last_deposit_block || u.last_deposit_block === 0) {
          fromBlock = MONITOR_START_BLOCK;
        } else {
          fromBlock = u.last_deposit_block + 1;
        }

        if (fromBlock > toBlock) continue;

        const maxToBlock = Math.min(fromBlock + BLOCKS_PER_CYCLE, toBlock);

        console.log(`🔍 Wallet ${u.deposit_address} → bloques ${fromBlock}-${maxToBlock}`);

        const allLogs = [];
        let batchStart = fromBlock;

        while (batchStart <= maxToBlock) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, maxToBlock);

          try {
            const batchLogs = await provider.getLogs({
              address: TOKEN_ADDRESS,
              topics: [
                TRANSFER_TOPIC,
                null,
                ethers.zeroPadValue(u.deposit_address.toLowerCase(), 32)
              ],
              fromBlock: batchStart,
              toBlock: batchEnd
            });

            allLogs.push(...batchLogs);
          } catch (batchErr) {
            console.error(`Error en lote ${batchStart}-${batchEnd}:`, batchErr.message);
          }

          batchStart = batchEnd + 1;
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }

        await supabase.from('users_balance')
          .update({ last_deposit_block: maxToBlock })
          .eq('user_id', u.user_id);

        if (allLogs.length === 0) continue;

        console.log(`📥 ${allLogs.length} transferencia(s) detectada(s) para user ${u.user_id}`);

        for (const log of allLogs) {
          const decoded = ifaceTransfer.parseLog({
            topics: log.topics,
            data: log.data
          });

          const amount = parseFloat(ethers.formatUnits(decoded.args.value, 18));
          const txHash = log.transactionHash;
          const fromAddress = decoded.args.from;

          const { data: existing } = await supabase
            .from('deposits')
            .select('tx_hash')
            .eq('tx_hash', txHash)
            .maybeSingle();

          if (existing) {
            console.log(`⏭️ Depósito duplicado ignorado: ${txHash}`);
            continue;
          }

          await supabase.from('deposits').insert({
            user_id: u.user_id,
            wallet: fromAddress,
            amount: amount,
            tx_hash: txHash,
            created_at: Math.floor(Date.now() / 1000)
          });

          const newWalletBalance = parseFloat(u.wallet_balance || 0) + amount;

          await supabase.from('users_balance')
            .update({ wallet_balance: newWalletBalance })
            .eq('user_id', u.user_id);

          u.wallet_balance = newWalletBalance;

          await addHistory(
            u.user_id,
            'deposit',
            amount,
            'Depósito detectado automáticamente',
            null,
            txHash
          );

          console.log(`✅ Depósito acreditado: user ${u.user_id} +${amount} JHOAL (tx: ${txHash})`);
        }

        await new Promise(r => setTimeout(r, 500));

      } catch (e) {
        console.error(`Error revisando wallet ${u.deposit_address}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Error checkDeposits:', e);
  }

  monitorRunning = false;
}

setInterval(checkDeposits, 60 * 1000);
setTimeout(checkDeposits, 15 * 1000);

// ================================================================

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

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) return null;

    const authDate = parseInt(params.get('auth_date') || '0');
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return null;

    const userJson = params.get('user');
    if (!userJson) return null;
    const userObj = JSON.parse(userJson);
    return userObj.id ? String(userObj.id) : null;
  } catch (e) {
    console.error('Error validateInitData:', e);
    return null;
  }
}

function requireAuth(req, res, next) {
  const initData = req.body.initData || req.headers['x-init-data'] || req.query.initData;
  const verifiedUserId = validateInitData(initData);

  if (!verifiedUserId) {
    return res.status(401).json({ error: 'No autorizado: initData inválido o expirado' });
  }

  const claimedUserId = req.body.userId || req.params.userId;
  if (claimedUserId && String(claimedUserId) !== String(verifiedUserId)) {
    return res.status(401).json({ error: 'No autorizado: userId no coincide' });
  }

  req.userId = verifiedUserId;
  next();
}

// ==== HUERTO DE HORUS ====
const PLANT_LEVELS = {
  basic: { name: 'Básica', emoji: '🌱', price: 10, waterCost: 1, fruitValue: 1.5, sellPrice: 9 },
  medium: { name: 'Media', emoji: '🌿', price: 50, waterCost: 5, fruitValue: 7.5, sellPrice: 45 },
  premium: { name: 'Premium', emoji: '🌳', price: 250, waterCost: 25, fruitValue: 37.5, sellPrice: 225 },
  pro: { name: 'Pro', emoji: '🌴', price: 1000, waterCost: 100, fruitValue: 150, sellPrice: 900 }
};

const MAX_PLANTS = 12;
const GROW_TIME_MIN = 25;
const PERFECT_WINDOW = 35;
const ROT_TIME = 60;

function getPlantStatus(plant) {
  if (plant.status === 'refunded') {
    return { status: 'refunded', value: 0, minutesLeft: 0, progress: 0, canRefund: false };
  }
  if (plant.status === 'dry' || !plant.last_watered) {
    return { status: 'dry', value: 0, minutesLeft: 0, progress: 0, canRefund: false };
  }

  const now = Math.floor(Date.now() / 1000);
  const level = PLANT_LEVELS[plant.level];

  const moonMult = parseFloat(plant.moon_multiplier || 1) || 1;
  const effectiveGrowTime = GROW_TIME_MIN / moonMult;

  const elapsed = (now - plant.last_watered) / 60;

  if (elapsed < effectiveGrowTime) {
    const progress = Math.floor((elapsed / effectiveGrowTime) * 100);
    return {
      status: 'growing',
      value: 0,
      minutesLeft: Math.ceil(effectiveGrowTime - elapsed),
      progress: Math.min(progress, 99),
      canRefund: false,
      moonBoost: moonMult > 1
    };
  }

  const elapsedSinceReady = elapsed - effectiveGrowTime;
  const perfectDuration = PERFECT_WINDOW - GROW_TIME_MIN;

  if (elapsedSinceReady <= perfectDuration) {
    return {
      status: 'ready',
      value: level.fruitValue,
      minutesLeft: Math.ceil(perfectDuration - elapsedSinceReady),
      progress: 100,
      canRefund: false,
      moonBoost: moonMult > 1
    };
  }

  const witheringTotal = ROT_TIME - PERFECT_WINDOW;
  const witheringElapsed = elapsedSinceReady - perfectDuration;

  if (witheringElapsed <= witheringTotal) {
    const withering = witheringElapsed / witheringTotal;
    const value = level.fruitValue * (1 - withering * 0.1);
    return {
      status: 'withering',
      value: Math.max(0, value),
      minutesLeft: Math.ceil(witheringTotal - witheringElapsed),
      progress: 100,
      canRefund: false,
      moonBoost: moonMult > 1
    };
  }

  return { status: 'rotten', value: 0, minutesLeft: 0, progress: 0, canRefund: true, moonBoost: moonMult > 1 };
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
  if (random < 33) return 0;
  else if (random < 78) return 1.1;
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
      user_id: userId,
      type: type,
      amount: amount,
      description: description,
      metadata: metadata || null,
      tx_hash: txHash || null,
      created_at: Math.floor(Date.now() / 1000)
    });
  } catch (e) {
    console.error('Error history:', e);
  }
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
      user_id: userId,
      type: 'plant_refund',
      amount: refundAmount,
      description: 'Reembolso por planta marchita (' + level.name + ')',
      metadata: String(plantId),
      tx_hash: null,
      created_at: Math.floor(Date.now() / 1000)
    });

    await supabase.from('plants').update({ status: 'dry', last_watered: null, moon_multiplier: 1 }).eq('id', plantId).eq('user_id', userId);

    return { success: true, amount: refundAmount, message: '¡Recibiste ' + refundAmount.toFixed(2) + ' JHOAL de reembolso! Plantá de nuevo cuando quieras.' };
  } catch (e) {
    console.error('Error refund:', e);
    return { success: false, error: e.message };
  }
}

// ==== ENDPOINT: MOON STATUS ====
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

// ==== ENDPOINT: REGISTRAR CHAT_ID ====
app.post('/register-user', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { chatId } = req.body;
  
  if (!chatId) {
    return res.json({ success: true, message: 'Sin chatId' });
  }
  
  try {
    const user = await ensureUser(userId);
    await supabase.from('users_balance')
      .update({ chat_id: chatId })
      .eq('user_id', userId);
    
    res.json({ success: true });
  } catch (e) {
    console.error('Error register-user:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: MI WALLET DE DEPÓSITO ====
app.post('/my-deposit-wallet', requireAuth, async (req, res) => {
  const userId = req.userId;
  try {
    const user = await ensureUser(userId);
    
    if (user.deposit_address) {
      return res.json({ 
        success: true, 
        address: user.deposit_address,
        walletBalance: parseFloat(user.wallet_balance || 0)
      });
    }
    
    console.log('🔐 Generando nueva wallet para user', userId);
    const newWallet = ethers.Wallet.createRandom();
    const encryptedKey = encryptPrivateKey(newWallet.privateKey);
    
    await supabase.from('users_balance')
      .update({ 
        deposit_address: newWallet.address,
        deposit_private_key: encryptedKey,
        wallet_balance: 0,
        last_deposit_block: 0
      })
      .eq('user_id', userId);
    
    console.log('✅ Wallet generada:', newWallet.address);
    
    res.json({ 
      success: true, 
      address: newWallet.address,
      walletBalance: 0
    });
  } catch (e) {
    console.error('Error my-deposit-wallet:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: MOVER DE WALLET AL JUEGO ====
app.post('/move-to-game', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { amount } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Cantidad inválida' });
  }
  
  try {
    const user = await ensureUser(userId);
    
    if (!user.deposit_address || !user.deposit_private_key) {
      return res.status(400).json({ error: 'No tienes wallet personal' });
    }
    
    if (parseFloat(user.wallet_balance || 0) < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente en wallet' });
    }
    
    const realBalanceWei = await token.balanceOf(user.deposit_address);
    const realBalance = parseFloat(ethers.formatUnits(realBalanceWei, 18));
    
    if (realBalance < amount) {
      return res.status(400).json({ error: 'La wallet no tiene fondos suficientes' });
    }
    
    const bnbNeeded = ethers.parseEther('0.0003');
    const bnbBalance = await provider.getBalance(user.deposit_address);
    
    if (bnbBalance < bnbNeeded) {
      console.log('⛽ Enviando BNB para gas a', user.deposit_address);
      const bnbTx = await wallet.sendTransaction({
        to: user.deposit_address,
        value: bnbNeeded
      });
      await bnbTx.wait();
    }
    
    const pk = decryptPrivateKey(user.deposit_private_key);
    const userSigner = new ethers.Wallet(pk, provider);
    const userToken = new ethers.Contract(TOKEN_ADDRESS, ABI, userSigner);
    
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await userToken.transfer(wallet.address, amountWei);
    console.log('📤 Mover al juego TX:', tx.hash);
    
    await tx.wait();
    
    const newWalletBalance = parseFloat(user.wallet_balance) - amount;
    const newGameBalance = parseFloat(user.balance) + amount;
    
    await supabase.from('users_balance')
      .update({ wallet_balance: newWalletBalance, balance: newGameBalance })
      .eq('user_id', userId);
    
    await addHistory(userId, 'deposit', amount, 'Movido al saldo del juego', null, tx.hash);
    
    res.json({ 
      success: true, 
      txHash: tx.hash,
      newWalletBalance: newWalletBalance,
      newGameBalance: newGameBalance,
      explorer: 'https://bscscan.com/tx/' + tx.hash
    });
  } catch (e) {
    console.error('Error move-to-game:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: RECLAMAR ====
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

    res.json({ success: true, amount: 1, message: '¡1 JHOAL añadido a tu saldo!' });
  } catch (error) {
    console.error('Error claim:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: BALANCE ====
app.get('/balance-game/:userId', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    if (!user) return res.json({ success: true, balance: 0, wallet_balance: 0, total_claimed: 0, total_won: 0, total_lost: 0, last_claim: 0 });
    res.json({
      success: true,
      balance: parseFloat(user.balance),
      wallet_balance: parseFloat(user.wallet_balance || 0),
      total_claimed: parseFloat(user.total_claimed || 0),
      total_won: parseFloat(user.total_won || 0),
      total_lost: parseFloat(user.total_lost || 0),
      last_claim: user.last_claim || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: APOSTAR ====
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
    await supabase.from('bets').insert({ user_id: userId, amount: amount, multiplier: multiplier, payout: payout, result: multiplier === 0 ? 'lose' : 'win', created_at: now });

    if (multiplier === 0) {
      await addHistory(userId, 'dice_lose', -amount, 'Perdiste en los dados (x0)', null, null);
    } else {
      await addHistory(userId, 'dice_win', profit, 'Ganaste x' + multiplier + ' en los dados', null, null);
    }

    res.json({ success: true, multiplier: multiplier, payout: payout, profit: profit, newBalance: newBalance });
  } catch (error) {
    console.error('Error bet:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: HISTORIAL DE APUESTAS ====
app.get('/bet-history/:userId', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('bets').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(10);
    res.json({ success: true, bets: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: RETIRAR ====
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
    console.log('Withdraw TX:', tx.hash);

    const newBalance = parseFloat(user.balance) - amount;
    const newWithdrawn = parseFloat(user.total_withdrawn || 0) + amount;

    await supabase.from('users_balance').update({ balance: newBalance, total_withdrawn: newWithdrawn }).eq('user_id', userId);
    await supabase.from('withdrawals').insert({ user_id: userId, wallet: userWallet, amount: amount, tx_hash: tx.hash, created_at: Math.floor(Date.now() / 1000) });
    await addHistory(userId, 'withdraw', -amount, 'Retiro a wallet', null, tx.hash);
    await tx.wait();

    res.json({ success: true, txHash: tx.hash, explorer: 'https://bscscan.com/tx/' + tx.hash, amount: amount });
  } catch (error) {
    console.error('Error withdraw:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== ENDPOINT: INFO DE DEPÓSITO ====
app.get('/deposit-info', (req, res) => {
  res.json({ success: true, depositWallet: wallet.address, tokenAddress: TOKEN_ADDRESS, minDeposit: 1 });
});

// ==== HUERTO: COMPRAR ====
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
    await supabase.from('plants').insert({ user_id: userId, level: level, status: 'dry', created_at: now, moon_multiplier: 1 });
    await addHistory(userId, 'plant_buy', -plantInfo.price, 'Compraste planta ' + plantInfo.name, null, null);

    res.json({ success: true, message: '¡Compraste una planta ' + plantInfo.name + '!' });
  } catch (error) {
    console.error('Error buy-plant:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== HUERTO: REGAR ====
app.post('/water-plant', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { plantId } = req.body;
  if (!plantId) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', userId).maybeSingle();
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });

    const status = getPlantStatus(plant);
    if (status.status !== 'dry' && status.status !== 'rotten') return res.status(400).json({ error: 'La planta todavía tiene fruto o está creciendo' });

    const user = await ensureUser(userId);
    const level = PLANT_LEVELS[plant.level];
    if (parseFloat(user.balance) < level.waterCost) return res.status(400).json({ error: 'Saldo insuficiente. Necesitás ' + level.waterCost + ' JHOAL' });

    const now = Math.floor(Date.now() / 1000);
    const newBalance = parseFloat(user.balance) - level.waterCost;

    const moonMult = moonState.active ? MOON_GROWTH_MULTIPLIER : 1;
    const effectiveGrowTime = Math.round((GROW_TIME_MIN / moonMult) * 10) / 10;

    await supabase.from('users_balance').update({ balance: newBalance }).eq('user_id', userId);
    await supabase.from('plants').update({
      last_watered: now,
      status: 'growing',
      moon_multiplier: moonMult
    }).eq('id', plantId).eq('user_id', userId);

    const moonMsg = moonMult > 1 ? ' 🌕 ¡Luna Llena activa! Crecerá en ~' + effectiveGrowTime + ' min.' : '';
    await addHistory(userId, 'plant_water', -level.waterCost, 'Regaste ' + level.name + (moonMult > 1 ? ' (Luna Llena 🌕)' : ''), null, null);

    res.json({
      success: true,
      message: '¡Regaste tu planta! Lista en ' + effectiveGrowTime + ' minutos.' + moonMsg,
      moonActive: moonMult > 1,
      growTimeMinutes: effectiveGrowTime
    });
  } catch (error) {
    console.error('Error water-plant:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== HUERTO: COSECHAR ====
app.post('/harvest', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { plantId } = req.body;
  if (!plantId) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', userId).maybeSingle();
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });

    const status = getPlantStatus(plant);
    if (status.status !== 'ready' && status.status !== 'withering') return res.status(400).json({ error: 'Todavía no podés cosechar esta planta' });

    const value = status.value;
    if (value <= 0) return res.status(400).json({ error: 'El fruto está podrido' });

    const user = await ensureUser(userId);
    const newBalance = parseFloat(user.balance) + value;
    const newWon = parseFloat(user.total_won || 0) + value;

    await supabase.from('users_balance').update({ balance: newBalance, total_won: newWon }).eq('user_id', userId);
    await supabase.from('plants').update({ status: 'dry', last_watered: null, moon_multiplier: 1 }).eq('id', plantId).eq('user_id', userId);

    const level = PLANT_LEVELS[plant.level];
    await addHistory(userId, 'plant_harvest', value, 'Cosechaste ' + level.name, null, null);

    res.json({ success: true, value: value, message: '¡Cosechaste ' + value.toFixed(2) + ' JHOAL!' });
  } catch (error) {
    console.error('Error harvest:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== HUERTO: VENDER ====
app.post('/sell-plant', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { plantId } = req.body;
  if (!plantId) return res.status(400).json({ error: 'Faltan datos' });

  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', userId).maybeSingle();
    if (!plant) return res.status(400).json({ error: 'Planta no encontrada' });

    const level = PLANT_LEVELS[plant.level];
    const sellValue = level.sellPrice;

    const user = await ensureUser(userId);
    const newBalance = parseFloat(user.balance) + sellValue;

    await supabase.from('users_balance').update({ balance: newBalance }).eq('user_id', userId);
    await supabase.from('plants').delete().eq('id', plantId).eq('user_id', userId);
    await addHistory(userId, 'plant_sell', sellValue, 'Vendiste ' + level.name, null, null);

    res.json({ success: true, value: sellValue, message: '¡Vendiste por ' + sellValue + ' JHOAL!' });
  } catch (error) {
    console.error('Error sell-plant:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== HUERTO: RECLAMAR DEVOLUCIÓN ====
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

// ==== HUERTO: MIS PLANTAS ====
app.get('/my-plants/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { data: plants } = await supabase.from('plants').select('*').eq('user_id', userId).order('created_at', { ascending: true });

    const plantsWithStatus = (plants || []).map(function(p) {
      const status = getPlantStatus(p);
      const level = PLANT_LEVELS[p.level];
      return {
        id: p.id, level: p.level, levelName: level.name, emoji: level.emoji,
        status: status.status, value: status.value,
        minutesLeft: status.minutesLeft || 0, progress: status.progress || 0,
        waterCost: level.waterCost, fruitValue: level.fruitValue, sellPrice: level.sellPrice,
        lastWatered: p.last_watered,
        canRefund: status.canRefund || false,
        refundAmount: status.canRefund ? (level.waterCost * 0.9) : 0,
        moonBoost: status.moonBoost || false
      };
    });

    res.json({
      success: true,
      plants: plantsWithStatus,
      count: plantsWithStatus.length,
      maxPlants: MAX_PLANTS,
      plantLevels: PLANT_LEVELS,
      moon: {
        active: moonState.active,
        endsAt: moonState.endsAt,
        multiplier: MOON_GROWTH_MULTIPLIER
      }
    });
  } catch (error) {
    console.error('Error my-plants:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== HISTORIAL ====
app.get('/history/:userId', requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type;

    let query = supabase.from('history').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (type && type !== 'all') query = query.eq('type', type);

    const { data: history } = await query;
    const { data: allHistory } = await supabase.from('history').select('type, amount').eq('user_id', userId);

    let summary = { faucet: 0, dice: 0, deposit: 0, withdraw: 0, garden: 0, total: 0 };

    (allHistory || []).forEach(function(h) {
      const amount = parseFloat(h.amount) || 0;
      if (h.type === 'faucet') summary.faucet += amount;
      else if (h.type === 'dice_win' || h.type === 'dice_lose') summary.dice += amount;
      else if (h.type === 'deposit') summary.deposit += amount;
      else if (h.type === 'withdraw') summary.withdraw += amount;
      else if (h.type && h.type.startsWith('plant_')) summary.garden += amount;
      summary.total += amount;
    });

    res.json({ success: true, history: history || [], summary: summary });
  } catch (error) {
    console.error('Error history:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

// ==== PRECIO ====
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

// ==== BALANCE FAUCET ====
app.get('/balance', async (req, res) => {
  try {
    const balance = await token.balanceOf(wallet.address);
    const bnb = await provider.getBalance(wallet.address);
    res.json({ wallet: wallet.address, jhoal: ethers.formatUnits(balance, 18) + ' JHOAL', bnb: ethers.formatEther(bnb) + ' BNB' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ROOT ====
app.get('/', (req, res) => {
  res.json({ status: 'Faucet JHOAL + Dados + Huerto + Historial + Luna Llena funcionando' });
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

  bot.onText(/\/start/, (msg) => {
    const name = msg.from.first_name || 'guerrero';
    bot.sendMessage(msg.chat.id,
      '⚱ *JHOAL - La ofrenda del dios* 🦅\n\n' +
      '¡Bienvenido, ' + name + '!\n\n' +
      '💰 Reclama *1 JHOAL GRATIS* cada 30 minutos\n' +
      '🎲 Juega en *Los Dados de Horus*\n' +
      '🌱 Planta en el *Huerto de Horus*\n' +
      '🌕 Atento a la *Luna Llena*\n' +
      '📜 Mirá tu *Historial*\n' +
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
      'Podés enviarme:\n' +
      '📝 Texto\n' +
      '📷 Fotos\n' +
      '🎥 Videos\n' +
      '🎵 Audios\n' +
      '📎 Documentos\n\n' +
      'Te vamos a responder a la brevedad.',
      { parse_mode: 'Markdown' }
    );
  });

  supportBot.onText(/\/reply\s+(\d+)\s+([\s\S]+)/, async (msg, match) => {
    const fromId = msg.from.id;
    const targetId = match[1];
    const replyText = match[2].trim();

    if (String(fromId) !== String(SUPPORT_CHAT_ID)) {
      return supportBot.sendMessage(msg.chat.id, '❌ No tenés permiso para usar este comando.');
    }

    try {
      await supportBot.sendMessage(targetId,
        '📩 *RESPUESTA DE SOPORTE:*\n\n' + replyText + '\n\n💬 Para responder, escribí de nuevo.',
        { parse_mode: 'Markdown' }
      );
      supportBot.sendMessage(msg.chat.id, '✅ Respuesta enviada al usuario ' + targetId);
    } catch (err) {
      supportBot.sendMessage(msg.chat.id, '❌ Error al enviar: ' + err.message);
    }
  });

  supportBot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.startsWith('/')) return;

    const userName = msg.from.first_name || 'Usuario';
    const userUsername = msg.from.username ? '@' + msg.from.username : 'sin username';
    const userId = msg.from.id;

    const header =
      '📩 *NUEVO MENSAJE DE SOPORTE*\n\n' +
      '👤 De: ' + userName + '\n' +
      '🔗 Username: ' + userUsername + '\n' +
      '🆔 ID: `' + userId + '`\n\n';

    try {
      if (msg.text) {
        supportBot.sendMessage(SUPPORT_CHAT_ID, header + '💬 Mensaje:\n' + msg.text, { parse_mode: 'Markdown' });
        supportBot.sendMessage(chatId, '✅ *Mensaje recibido*\n\nTu consulta fue enviada al equipo de soporte.', { parse_mode: 'Markdown' });
      }
      else if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        supportBot.sendPhoto(SUPPORT_CHAT_ID, photo.file_id, {
          caption: header + '📷 Foto' + (msg.caption ? ':\n' + msg.caption : ''),
          parse_mode: 'Markdown'
        });
        supportBot.sendMessage(chatId, '✅ *Foto recibida*\n\nFue enviada al equipo de soporte.', { parse_mode: 'Markdown' });
      }
      else if (msg.video) {
        supportBot.sendVideo(SUPPORT_CHAT_ID, msg.video.file_id, {
          caption: header + '🎥 Video' + (msg.caption ? ':\n' + msg.caption : ''),
          parse_mode: 'Markdown'
        });
        supportBot.sendMessage(chatId, '✅ *Video recibido*\n\nFue enviado al equipo de soporte.', { parse_mode: 'Markdown' });
      }
      else if (msg.audio || msg.voice) {
        const audioId = (msg.audio && msg.audio.file_id) || (msg.voice && msg.voice.file_id);
        supportBot.sendAudio(SUPPORT_CHAT_ID, audioId, {
          caption: header + '🎵 Audio',
          parse_mode: 'Markdown'
        });
        supportBot.sendMessage(chatId, '✅ *Audio recibido*\n\nFue enviado al equipo de soporte.', { parse_mode: 'Markdown' });
      }
      else if (msg.document) {
        supportBot.sendDocument(SUPPORT_CHAT_ID, msg.document.file_id, {
          caption: header + '📎 Documento' + (msg.caption ? ':\n' + msg.caption : ''),
          parse_mode: 'Markdown'
        });
        supportBot.sendMessage(chatId, '✅ *Documento recibido*\n\nFue enviado al equipo de soporte.', { parse_mode: 'Markdown' });
      }
      else if (msg.sticker) {
        supportBot.sendMessage(SUPPORT_CHAT_ID, header + '🎨 Sticker', { parse_mode: 'Markdown' });
        supportBot.sendSticker(SUPPORT_CHAT_ID, msg.sticker.file_id);
        supportBot.sendMessage(chatId, '✅ *Sticker recibido*', { parse_mode: 'Markdown' });
      }
      else {
        supportBot.sendMessage(SUPPORT_CHAT_ID, header + '📎 Mensaje tipo desconocido', { parse_mode: 'Markdown' });
        supportBot.sendMessage(chatId, '✅ *Mensaje recibido*');
      }
    } catch (err) {
      console.error('Error enviando a soporte:', err);
      supportBot.sendMessage(chatId, '❌ Error al enviar tu mensaje. Intenta de nuevo.');
    }
  });
}

// ==== INICIAR SERVIDOR ====
app.listen(process.env.PORT || 3000, () => {
  console.log('Faucet JHOAL + Dados + Huerto + Historial + Luna Llena corriendo en puerto', process.env.PORT || 3000);
  console.log('Wallet:', wallet.address);
  console.log('Bot principal:', BOT_TOKEN ? 'SÍ' : 'NO');
  console.log('Bot de soporte:', SUPPORT_BOT_TOKEN ? 'SÍ' : 'NO');
  console.log('Supabase:', SUPABASE_URL ? 'SÍ' : 'NO');
  console.log('Validación initData:', BOT_TOKEN ? 'ACTIVADA' : 'DESACTIVADA (falta BOT_TOKEN)');
  console.log('🌕 Luna Llena: 1-' + MOON_MAX_PER_DAY + ' eventos/día, ' + MOON_DURATION_MIN + ' min c/u, x' + MOON_GROWTH_MULTIPLIER + ' crecimiento');
  console.log('💾 Monitor de depósitos: ACTIVADO (cada 60s)');
});
