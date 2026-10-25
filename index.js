import express from 'express';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';
import cors from 'cors';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

// ==== CONFIG ====
const RPC_LIST = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org'
];
let currentProvider = null;

async function getProvider() {
  if (currentProvider) {
    try {
      await currentProvider.getBlockNumber();
      return currentProvider;
    } catch (e) { currentProvider = null; }
  }
  for (const rpc of RPC_LIST) {
    try {
      const testProvider = new ethers.JsonRpcProvider(rpc);
      await testProvider.getBlockNumber();
      console.log('✅ RPC OK:', rpc);
      currentProvider = testProvider;
      return testProvider;
    } catch (e) { console.log('❌ RPC falló:', rpc); }
  }
  throw new Error('Ningún RPC funciona');
}

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const PAIR_ADDRESS = '0x70163906f11E7a05eb37Dce319602e7ffc4865e5';
const BTC_PAIR_ADDRESS = '0x3F803EC2b816Ea7F06EC76aA2B6f2532F9892d62';
const BTCB_ADDRESS = '0x7130d2A12B9BCbfAE4F2634d864A1ee1ce3Ead9c';
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN;
const SUPPORT_CHAT_ID = process.env.SUPPORT_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://aged-math-48b9.jsac1234567890.workers.dev/';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://billowing-violet-1aa4.jsac1234567890.workers.dev/';
const SUPPORT_USERNAME = 'JhoalSupportbot';
const COOLDOWN = 30 * 60;
const MIN_BET = 0.1;
const MAX_BET = 1000;
const WITHDRAW_COOLDOWN = 5 * 60;
const VERIFY_DEPOSIT_MAX_DAYS = 7;

// ==== AUTH CONFIG ====
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-en-produccion-' + crypto.randomBytes(16).toString('hex');
const JWT_EXPIRES_IN = '30d';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// ==== REFERIDOS ====
const REFERRAL_REWARD = 1000;
const REFERRAL_BOT_USERNAME = process.env.REFERRAL_BOT_USERNAME || 'Jhoal_faucetbot';
const REFERRAL_BANNER_URL = process.env.REFERRAL_BANNER_URL || 'https://i.imgur.com/xoIBdWv.png';

// ==== HCAPTCHA ====
const HCAPTCHA_SECRET_KEY = process.env.HCAPTCHA_SECRET_KEY;
const HCAPTCHA_SITE_KEY = process.env.HCAPTCHA_SITE_KEY || 'b264c464-eab2-4734-9ad8-ce7aa24a8346';
const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

const userVerifiedCaptcha = new Map();
const CAPTCHA_VERIFICATION_TTL = 0;

const CAPTCHA_DICE_MIN_BETS = 1;
const CAPTCHA_DICE_MAX_BETS = 10;
const userDiceBetCounters = new Map();
const userDiceCaptchaThresholds = new Map();

function getDiceCaptchaThreshold(userId) {
  if (!userDiceCaptchaThresholds.has(userId)) {
    const t = Math.floor(Math.random() * (CAPTCHA_DICE_MAX_BETS - CAPTCHA_DICE_MIN_BETS + 1)) + CAPTCHA_DICE_MIN_BETS;
    userDiceCaptchaThresholds.set(userId, t);
  }
  return userDiceCaptchaThresholds.get(userId);
}

// ==== ANTI-DUPLICADO ====
const operationsInProgress = new Map();
function acquireLock(key) {
  if (operationsInProgress.has(key)) return false;
  operationsInProgress.set(key, Date.now());
  return true;
}
function releaseLock(key) { operationsInProgress.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of operationsInProgress.entries()) {
    if (now - v > 30000) operationsInProgress.delete(k);
  }
}, 30000);

async function verificarHCaptcha(token, remoteip) {
  if (!HCAPTCHA_SECRET_KEY) return { success: true };
  try {
    const params = new URLSearchParams({
      secret: HCAPTCHA_SECRET_KEY,
      response: token,
      remoteip: remoteip || '',
      sitekey: HCAPTCHA_SITE_KEY
    });
    const res = await fetch(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await res.json();
    return data;
  } catch (e) {
    return { success: false, 'error-codes': ['internal-error'] };
  }
}

// ==== LUNA LLENA ====
const MOON_GROWTH_MULTIPLIER = 1.9;
const MOON_DURATION_MIN = 10;
const MOON_MIN_PER_DAY = 1;
const MOON_MAX_PER_DAY = 5;

// ==== ADSGRAM ====
const AD_REWARD_AMOUNT = 5;
const AD_COOLDOWN = 10 * 60;

// ==== COOLDOWN DE COMPRA ====
const BUY_COOLDOWN = 10;

// ==== PREDICCIONES ====
const PREDICTION_ROUND_DURATION = 5 * 60;
const PREDICTION_WINDOW = 3 * 60;
const PREDICTION_COOLDOWN = 2 * 60;
const PREDICTION_BLOCK_LAST_SECONDS = 30;
const PREDICTION_BASE_POOL = 2.5;
const PREDICTION_AD_REWARD = 5;
const PREDICTION_RANGE = 20;
const BURN_WALLET = '0x000000000000000000000000000000000000dEaD';

// ==== CACHÉ DE PRECIOS ====
let btcPriceCache = { price: 0, updatedAt: 0 };
const BTC_CACHE_MS = 60 * 1000;
let jhoalPriceCache = { price: 0, updatedAt: 0 };
const JHOAL_CACHE_MS = 60 * 1000;

const provider = new ethers.JsonRpcProvider(RPC_LIST[0]);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const txProvider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
const txWallet = new ethers.Wallet(PRIVATE_KEY, txProvider);

const ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
const token = new ethers.Contract(TOKEN_ADDRESS, ABI, wallet);
const txToken = new ethers.Contract(TOKEN_ADDRESS, ABI, txWallet);

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)'
];
const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);
const btcPair = new ethers.Contract(BTC_PAIR_ADDRESS, PAIR_ABI, provider);

async function getBTCPrice() {
  const now = Date.now();
  if (now - btcPriceCache.updatedAt < BTC_CACHE_MS && btcPriceCache.price > 0) return btcPriceCache.price;
  try {
    const reserves = await btcPair.getReserves();
    const token0 = await btcPair.token0();
    let btcReserve, usdtReserve;
    if (token0.toLowerCase() === BTCB_ADDRESS.toLowerCase()) {
      btcReserve = reserves.reserve0; usdtReserve = reserves.reserve1;
    } else {
      btcReserve = reserves.reserve1; usdtReserve = reserves.reserve0;
    }
    const btcAmount = parseFloat(ethers.formatUnits(btcReserve, 18));
    const usdtAmount = parseFloat(ethers.formatUnits(usdtReserve, 18));
    if (btcAmount <= 0) throw new Error('Reserva BTC = 0');
    const price = usdtAmount / btcAmount;
    btcPriceCache = { price, updatedAt: now };
    return price;
  } catch (e) { return btcPriceCache.price || 0; }
}

async function getJhoalPrice() {
  const now = Date.now();
  if (now - jhoalPriceCache.updatedAt < JHOAL_CACHE_MS && jhoalPriceCache.price > 0) return jhoalPriceCache.price;
  try {
    const reserves = await pair.getReserves();
    const token0 = await pair.token0();
    let jhoalReserve, usdtReserve;
    if (token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
      jhoalReserve = reserves.reserve0; usdtReserve = reserves.reserve1;
    } else {
      jhoalReserve = reserves.reserve1; usdtReserve = reserves.reserve0;
    }
    const jhoalAmount = parseFloat(ethers.formatUnits(jhoalReserve, 18));
    const usdtAmount = parseFloat(ethers.formatUnits(usdtReserve, 18));
    if (jhoalAmount <= 0) throw new Error('Reserva JHOAL = 0');
    const price = usdtAmount / jhoalAmount;
    jhoalPriceCache = { price, updatedAt: now };
    return price;
  } catch (e) { return jhoalPriceCache.price || 0; }
}
// ==== SUPABASE ====
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==== ENCRIPTACIÓN ====
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
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
const moonState = { active: false, startedAt: 0, endsAt: 0, nextEventAt: 0, eventsToday: 0, todayKey: '' };
function todayKeyUTC() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function scheduleNextMoon() {
  const now = Math.floor(Date.now() / 1000);
  const key = todayKeyUTC();
  if (moonState.todayKey !== key) { moonState.todayKey = key; moonState.eventsToday = 0; }
  if (moonState.eventsToday >= MOON_MAX_PER_DAY) {
    const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0);
    moonState.nextEventAt = Math.floor(tomorrow.getTime() / 1000) + randInt(0, 3600);
    return;
  }
  const remainingMin = MOON_MIN_PER_DAY - moonState.eventsToday;
  const hoursLeftToday = 24 - new Date().getUTCHours();
  let delay;
  if (remainingMin > 0 && hoursLeftToday <= remainingMin) delay = randInt(60, 1800);
  else delay = randInt(1800, 5 * 3600);
  moonState.nextEventAt = now + delay;
}

function activateMoon() {
  const now = Math.floor(Date.now() / 1000);
  moonState.active = true; moonState.startedAt = now;
  moonState.endsAt = now + MOON_DURATION_MIN * 60;
  moonState.eventsToday += 1;
  console.log('🌕 LUNA LLENA ACTIVADA');
  notificarLunaLlena();
}

async function notificarLunaLlena() {
  if (!bot) return;
  try {
    const { data: usuarios } = await supabase.from('users_balance').select('chat_id').not('chat_id', 'is', null);
    if (!usuarios || usuarios.length === 0) return;
    for (const u of usuarios) {
      try {
        await bot.sendMessage(u.chat_id, '🌕 *¡LUNA LLENA ACTIVA!*\n\nLas plantas crecen *90% más rápido*.\n\n👉 Abre el Huerto y riega ahora.', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🌱 Abrir Huerto', web_app: { url: MINI_APP_URL } }]] } });
      } catch (e) {}
    }
  } catch (e) {}
}

function deactivateMoon() { moonState.active = false; moonState.startedAt = 0; moonState.endsAt = 0; scheduleNextMoon(); }
function tickMoon() {
  const now = Math.floor(Date.now() / 1000);
  const key = todayKeyUTC();
  if (moonState.todayKey !== key) { moonState.todayKey = key; moonState.eventsToday = 0; }
  if (moonState.active && now >= moonState.endsAt) { deactivateMoon(); return; }
  if (!moonState.active && moonState.nextEventAt > 0 && now >= moonState.nextEventAt) activateMoon();
}
moonState.todayKey = todayKeyUTC();
scheduleNextMoon();
setInterval(tickMoon, 30 * 1000);

// ==== BENDICIÓN DEL FARAÓN ====
const BLESSING_DURATION = 30 * 60 * 1000;
const BLESSING_FRUIT_MULTIPLIER = 2;
const blessingState = { active: false, startedAt: 0, endsAt: 0, eventScheduledToday: false, todayKey: '' };

function scheduleBlessing() {
  const key = todayKeyUTC();
  if (blessingState.todayKey !== key) { blessingState.todayKey = key; blessingState.eventScheduledToday = false; blessingState.active = false; }
  if (!blessingState.eventScheduledToday) {
    blessingState.eventScheduledToday = true;
    const randomHour = randInt(0, 23); const randomMin = randInt(0, 59);
    const now = new Date(); const targetTime = new Date();
    targetTime.setUTCHours(randomHour, randomMin, 0, 0);
    let msUntilEvent = targetTime.getTime() - now.getTime();
    if (msUntilEvent < 0) msUntilEvent += 24 * 60 * 60 * 1000;
    setTimeout(activateBlessing, msUntilEvent);
  }
}

function activateBlessing() {
  blessingState.active = true; blessingState.startedAt = Date.now(); blessingState.endsAt = Date.now() + BLESSING_DURATION;
  notificarBendicion();
  setTimeout(() => { blessingState.active = false; scheduleBlessing(); }, BLESSING_DURATION);
}

async function notificarBendicion() {
  if (!bot) return;
  try {
    const { data: usuarios } = await supabase.from('users_balance').select('chat_id').not('chat_id', 'is', null);
    if (!usuarios || usuarios.length === 0) return;
    for (const u of usuarios) {
      try {
        await bot.sendMessage(u.chat_id, '👑 *¡BENDICIÓN DEL FARAÓN ACTIVA!*\n\nFruto x2 en el Huerto por 30 minutos.\n\n👉 Abre el Huerto y cosecha.', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🌱 Abrir Huerto', web_app: { url: MINI_APP_URL } }]] } });
      } catch (e) {}
    }
  } catch (e) {}
}
scheduleBlessing();
// ============================================================
// ==== SISTEMA DE AUTENTICACIÓN UNIFICADO ====================
// ============================================================

function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckArr = [];
    for (const [key, value] of params.entries()) dataCheckArr.push(key + '=' + value);
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
    return userObj.id ? { id: String(userObj.id), user: userObj } : null;
  } catch (e) { return null; }
}

function validateTelegramWidget(user) {
  if (!user || !BOT_TOKEN) return null;
  try {
    const { hash, ...data } = user;
    if (!hash) return null;
    const dataCheckArr = Object.keys(data).sort().map(k => `${k}=${data[k]}`);
    const dataCheckString = dataCheckArr.join('\n');
    const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash !== hash) return null;
    const authDate = parseInt(data.auth_date || '0');
    if (Math.floor(Date.now() / 1000) - authDate > 86400) return null;
    return data.id ? { id: String(data.id), user: data } : null;
  } catch (e) { return null; }
}

function signJWT(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }); }
function verifyJWT(token) { try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; } }

async function findOrCreateUserByIdentity({ telegramId, googleId, email, name }) {
  if (telegramId) {
    const { data } = await supabase.from('users_balance').select('*').eq('user_id', String(telegramId)).maybeSingle();
    if (data) return data;
  }
  if (googleId) {
    const { data } = await supabase.from('users_balance').select('*').eq('google_id', googleId).maybeSingle();
    if (data) return data;
  }
  if (email) {
    const { data } = await supabase.from('users_balance').select('*').eq('email', email).maybeSingle();
    if (data) return data;
  }
  const userId = telegramId ? String(telegramId) : (googleId ? 'g_' + googleId : 'u_' + crypto.randomBytes(8).toString('hex'));
  const insertData = {
    user_id: userId, balance: 0, telegram_id: telegramId || null, google_id: googleId || null,
    email: email || null, display_name: name || null, created_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('users_balance').insert(insertData).select().maybeSingle();
  if (error) {
    const { data: fallback } = await supabase.from('users_balance').select('*').eq('user_id', userId).maybeSingle();
    return fallback;
  }
  return data;
}

async function requireAuth(req, res, next) {
  try {
    const initData = req.body?.initData || req.headers['x-init-data'] || req.query?.initData;
    if (initData) {
      const verified = validateInitData(initData);
      if (!verified) return res.status(401).json({ error: 'initData inválido o expirado' });
      const user = await findOrCreateUserByIdentity({ telegramId: verified.id, name: verified.user.first_name });
      if (!user) return res.status(500).json({ error: 'Error de usuario' });
      req.userId = String(user.user_id); req.authMethod = 'telegram_miniapp'; req.user = user;
      return next();
    }
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const payload = verifyJWT(authHeader.slice(7));
      if (!payload) return res.status(401).json({ error: 'JWT inválido o expirado' });
      const { data: user } = await supabase.from('users_balance').select('*').eq('user_id', payload.uid).maybeSingle();
      if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
      req.userId = String(user.user_id); req.authMethod = payload.method; req.user = user;
      return next();
    }
    return res.status(401).json({ error: 'No autorizado: falta initData o Bearer token' });
  } catch (e) { return res.status(500).json({ error: 'Error de autenticación' }); }
}

// --- Endpoints de autenticación ---

app.post('/auth/google', async (req, res) => {
  try {
    if (!googleClient) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurado' });
    const { credential, linkToTelegramId } = req.body;
    if (!credential) return res.status(400).json({ error: 'Falta credential' });

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return res.status(401).json({ error: 'Token de Google inválido' });

    let user;
    if (linkToTelegramId) {
      const { data: tgUser } = await supabase.from('users_balance').select('*').eq('user_id', String(linkToTelegramId)).maybeSingle();
      if (!tgUser) return res.status(404).json({ error: 'Usuario de Telegram no encontrado' });
      await supabase.from('users_balance').update({ google_id: payload.sub, email: payload.email }).eq('user_id', tgUser.user_id);
      user = tgUser;
    } else {
      user = await findOrCreateUserByIdentity({ googleId: payload.sub, email: payload.email, name: payload.name });
    }
    if (!user) return res.status(500).json({ error: 'Error de usuario' });

    const jwtToken = signJWT({ uid: user.user_id, method: 'google' });
    res.json({
      success: true, token: jwtToken,
      user: { userId: user.user_id, balance: parseFloat(user.balance || 0), email: user.email || payload.email, hasTelegram: !!user.telegram_id, hasGoogle: true }
    });
  } catch (e) { res.status(401).json({ error: 'Token de Google inválido: ' + e.message }); }
});

app.post('/auth/generate-tg-code', requireAuth, async (req, res) => {
  try {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const { error } = await supabase.from('users_balance').update({ link_code: code }).eq('user_id', req.userId);
    if (error) return res.status(500).json({ error: 'Error al guardar en DB' });
    res.json({ success: true, code: code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/verify-tg-code', async (req, res) => {
  try {
    const { code, initData } = req.body;
    const verified = validateInitData(initData);
    if (!verified) return res.status(401).json({ error: 'Telegram inválido o expirado' });

    const { data: user } = await supabase.from('users_balance').select('*').eq('link_code', code).maybeSingle();
    if (!user) return res.status(404).json({ error: 'Código incorrecto o ya expiró' });

    await supabase.from('users_balance').update({ telegram_id: String(verified.id), chat_id: String(verified.id), link_code: null }).eq('user_id', user.user_id);
    res.json({ success: true, message: 'Cuenta vinculada' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/telegram-widget', async (req, res) => {
  try {
    const verified = validateTelegramWidget(req.body);
    if (!verified) return res.status(401).json({ error: 'Hash de Telegram inválido' });
    const user = await findOrCreateUserByIdentity({ telegramId: verified.id, name: verified.user.first_name });
    const jwtToken = signJWT({ uid: user.user_id, method: 'telegram_widget' });
    res.json({ success: true, token: jwtToken, user: { userId: user.user_id, balance: parseFloat(user.balance || 0), hasTelegram: true, hasGoogle: !!user.google_id } });
  } catch (e) { res.status(401).json({ error: 'Error: ' + e.message }); }
});

app.post('/auth/link-telegram', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Falta JWT' });
    const payload = verifyJWT(authHeader.slice(7));
    if (!payload) return res.status(401).json({ error: 'JWT inválido' });
    const verified = validateTelegramWidget(req.body.widgetData || req.body);
    if (!verified) return res.status(401).json({ error: 'Hash de Telegram inválido' });

    await supabase.from('users_balance').update({ telegram_id: verified.id, chat_id: verified.id }).eq('user_id', payload.uid);
    res.json({ success: true, message: '✅ Telegram vinculado correctamente' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/link-google', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Falta JWT' });
    const payload = verifyJWT(authHeader.slice(7));
    if (!payload) return res.status(401).json({ error: 'JWT inválido' });
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    const gPayload = ticket.getPayload();
    await supabase.from('users_balance').update({ google_id: gPayload.sub, email: gPayload.email }).eq('user_id', payload.uid);
    res.json({ success: true, message: '✅ Google vinculado correctamente', email: gPayload.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/auth/me', requireAuth, async (req, res) => {
  const u = req.user;
  res.json({ success: true, userId: u.user_id, authMethod: req.authMethod, balance: parseFloat(u.balance || 0), walletBalance: parseFloat(u.wallet_balance || 0), email: u.email || null, telegramId: u.telegram_id || null, googleId: u.google_id || null, hasTelegram: !!u.telegram_id, hasGoogle: !!u.google_id, displayName: u.display_name || null });
});

app.get('/auth/config', (req, res) => {
  res.json({ success: true, googleClientId: GOOGLE_CLIENT_ID || null, telegramBotUsername: REFERRAL_BOT_USERNAME, hcaptchaSiteKey: HCAPTCHA_SITE_KEY, miniAppUrl: MINI_APP_URL, webAppUrl: WEB_APP_URL });
});
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
  if (random < 46) return 0;
  else if (random < 87) return 1.1;
  else if (random < 93) return 2;
  else if (random < 96) return 4;
  else if (random < 98) return 6;
  else if (random < 99) return 8;
  else return 10;
}
async function getUser(userId) { const { data } = await supabase.from('users_balance').select('*').eq('user_id', userId).maybeSingle(); return data; }
async function ensureUser(userId) {
  const user = await getUser(userId);
  if (!user) { await supabase.from('users_balance').insert({ user_id: userId, balance: 0 }); return await getUser(userId); }
  return user;
}
async function addHistory(userId, type, amount, description, metadata, txHash) {
  try {
    await supabase.from('history').insert({ user_id: userId, type, amount, description, metadata: metadata || null, tx_hash: txHash || null, created_at: Math.floor(Date.now() / 1000) });
  } catch (e) {}
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
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) + refundAmount }).eq('user_id', userId);
    await supabase.from('history').insert({ user_id: userId, type: 'plant_refund', amount: refundAmount, description: 'Reembolso 90% (' + level.name + ')', metadata: String(plantId), created_at: Math.floor(Date.now() / 1000) });
    await supabase.from('plants').update({ status: 'dry', last_watered: null, moon_multiplier: 1 }).eq('id', plantId).eq('user_id', userId);
    return { success: true, amount: refundAmount, message: '¡Recibiste ' + refundAmount.toFixed(2) + ' JHOAL!' };
  } catch (e) { return { success: false, error: e.message }; }
}

async function cleanupExpiredPlants() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const limiteExpiracion = now - PLANT_LIFETIME_SECONDS;
    const { data: expiradas } = await supabase.from('plants').select('id, user_id, level, created_at').lt('created_at', limiteExpiracion);
    if (!expiradas || expiradas.length === 0) return;
    for (const p of expiradas) {
      const level = PLANT_LEVELS[p.level];
      await supabase.from('history').insert({ user_id: p.user_id, type: 'plant_expired', amount: 0, description: '💀 Tu planta ' + (level ? level.name : p.level) + ' ha expirado.', metadata: String(p.id), created_at: now });
    }
    const ids = expiradas.map(p => p.id);
    await supabase.from('plants').delete().in('id', ids);
  } catch (e) {}
}

async function cleanupOldPlants() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const { data: sinFecha } = await supabase.from('plants').select('id').is('created_at', null);
    if (sinFecha && sinFecha.length > 0) {
      await supabase.from('plants').update({ created_at: now }).in('id', sinFecha.map(p => p.id));
    }
  } catch (e) {}
}

async function otorgarRecompensaReferido(referrerId, referredId) {
  try {
    const { data: yaExiste } = await supabase.from('referrals').select('id').eq('referred_id', referredId).maybeSingle();
    if (yaExiste) return { success: false };
    const referredUser = await ensureUser(referredId);
    if (!referredUser.total_claimed || parseFloat(referredUser.total_claimed) < 1) return { success: false };
    await supabase.from('referrals').insert({ referrer_id: referrerId, referred_id: referredId, reward: REFERRAL_REWARD, created_at: Math.floor(Date.now() / 1000) });
    const referrer = await ensureUser(referrerId);
    await supabase.from('users_balance').update({ balance: parseFloat(referrer.balance || 0) + REFERRAL_REWARD }).eq('user_id', referrerId);
    await addHistory(referrerId, 'referral_reward', REFERRAL_REWARD, '🎁 Recompensa por referido', null, null);
    if (bot && referrer.chat_id) { try { await bot.sendMessage(referrer.chat_id, `🎁 *¡NUEVO REFERIDO!*\n\nGanaste *${REFERRAL_REWARD} JHOAL*`, { parse_mode: 'Markdown' }); } catch (e) {} }
    return { success: true };
  } catch (e) { return { success: false }; }
}

async function intentarPagarReferido(userId) {
  try {
    const { data: pendiente } = await supabase.from('referrals_pending').select('*').eq('referred_id', userId).maybeSingle();
    if (!pendiente) return;
    const result = await otorgarRecompensaReferido(pendiente.referrer_id, userId);
    if (result.success) await supabase.from('referrals_pending').delete().eq('referred_id', userId);
  } catch (e) {}
}

// ==== PREDICCIONES ====
let predictionLoopRunning = false;
function getPredictionRoundNumber() { return Math.floor(Date.now() / 1000 / PREDICTION_ROUND_DURATION); }
function getSecondsUntilNextRound() { const now = Math.floor(Date.now() / 1000); return Math.max(0, ((getPredictionRoundNumber() + 1) * PREDICTION_ROUND_DURATION) - now); }

async function ensurePredictionRound() {
  const roundNumber = getPredictionRoundNumber();
  try {
    const { data: existing } = await supabase.from('prediction_rounds').select('*').eq('round_number', roundNumber).maybeSingle();
    if (existing) return existing;
    const price = await getBTCPrice();
    if (!price || price <= 0) return null;
    const now = Math.floor(Date.now() / 1000);
    const startedAt = roundNumber * PREDICTION_ROUND_DURATION;
    const closesAt = startedAt + PREDICTION_WINDOW;
    const { data: lastRound } = await supabase.from('prediction_rounds').select('accumulated_pool').eq('status', 'resolved').order('round_number', { ascending: false }).limit(1).maybeSingle();
    let accumulated = (lastRound && lastRound.accumulated_pool > 0) ? parseFloat(lastRound.accumulated_pool) : 0;
    const totalPool = PREDICTION_BASE_POOL + accumulated;
    const { data: newRound } = await supabase.from('prediction_rounds').insert({ round_number: roundNumber, start_price: price, base_pool: PREDICTION_BASE_POOL, accumulated_pool: accumulated, ads_pool: 0, total_pool: totalPool, status: 'open', started_at: startedAt, closes_at: closesAt, created_at: now }).select().maybeSingle();
    if (!newRound) { const { data: fallback } = await supabase.from('prediction_rounds').select('*').eq('round_number', roundNumber).maybeSingle(); return fallback; }
    return newRound;
  } catch (e) { return null; }
}

async function resolvePredictionRounds() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const { data: pending } = await supabase.from('prediction_rounds').select('*').eq('status', 'open').lt('closes_at', now - 5);
    if (!pending || pending.length === 0) return;
    for (const round of pending) {
      const lockKey = `resolve_round_${round.id}`;
      if (!acquireLock(lockKey)) continue;
      try {
        const endPrice = await getBTCPrice();
        if (!endPrice || endPrice <= 0) { releaseLock(lockKey); continue; }
        const result = endPrice > round.start_price ? 'up' : (endPrice < round.start_price ? 'down' : 'tie');
        const { data: preds } = await supabase.from('predictions').select('*').eq('round_id', round.id);
        const processedPreds = (preds || []).map(p => {
          const distance = Math.abs(endPrice - parseFloat(p.predicted_price));
          let percentPremium = distance <= PREDICTION_RANGE ? 100 - (distance / PREDICTION_RANGE) * 100 : 0;
          return { ...p, distance, percentPremium, isWinner: distance <= PREDICTION_RANGE };
        });
        const winners = processedPreds.filter(p => p.isWinner);
        let distributed = 0, burned = 0, accumulatedNext = 0;
        if (winners.length > 0) {
          const sumPercents = winners.reduce((s, w) => s + w.percentPremium, 0);
          for (const w of winners) {
            const payout = Math.floor(((w.percentPremium / sumPercents) * parseFloat(round.total_pool)) * 100) / 100;
            const user = await ensureUser(w.user_id);
            await supabase.from('users_balance').update({ balance: parseFloat(user.balance) + payout, total_prediction_won: parseFloat(user.total_prediction_won || 0) + payout }).eq('user_id', w.user_id);
            await supabase.from('predictions').update({ distance: w.distance, percent_premium: w.percentPremium, won: true, payout }).eq('id', w.id);
            await addHistory(w.user_id, 'prediction_win', payout, `🔮 Ganaste Ronda #${round.round_number}`, null, null);
            distributed += payout;
          }
          for (const l of processedPreds.filter(p => !p.isWinner)) await supabase.from('predictions').update({ distance: l.distance, percent_premium: 0, won: false, payout: 0 }).eq('id', l.id);
        } else {
          burned = Math.floor(parseFloat(round.total_pool) * 0.001 * 100) / 100;
          accumulatedNext = parseFloat(round.total_pool) - burned;
          if (burned > 0) await supabase.from('burn_wallet').insert({ amount: burned, source: 'prediction_loss', created_at: now });
          for (const p of processedPreds) await supabase.from('predictions').update({ distance: p.distance, percent_premium: 0, won: false, payout: 0 }).eq('id', p.id);
        }
        await supabase.from('prediction_rounds').update({ end_price: endPrice, result: result, distributed: distributed, burned: burned, accumulated_pool: accumulatedNext, winners_count: winners.length, status: 'resolved', resolved_at: now }).eq('id', round.id).eq('status', 'open');
      } catch (e) {} finally { releaseLock(lockKey); }
    }
  } catch (e) {}
}

async function predictionLoop() {
  if (predictionLoopRunning) return;
  predictionLoopRunning = true;
  try { await ensurePredictionRound(); await resolvePredictionRounds(); } catch (e) {}
  predictionLoopRunning = false;
}

// ==== ENVÍO DE QUEMA ====
let burnSendRunning = false;
async function sendPendingBurns() {
  if (burnSendRunning) return;
  burnSendRunning = true;
  try {
    const { data: pending } = await supabase.from('burn_wallet').select('*').is('sent_at', null).order('created_at', { ascending: true });
    if (!pending || pending.length === 0) { burnSendRunning = false; return; }
    const totalBurn = pending.reduce((s, b) => s + parseFloat(b.amount), 0);
    if (totalBurn <= 0) { burnSendRunning = false; return; }
    const tx = await txToken.transfer(BURN_WALLET, ethers.parseUnits(totalBurn.toFixed(18), 18));
    await tx.wait();
    const now = Math.floor(Date.now() / 1000);
    for (const b of pending) await supabase.from('burn_wallet').update({ sent_at: now, tx_hash: tx.hash }).eq('id', b.id);
    await addHistory('SYSTEM', 'burn', -totalBurn, `🔥 Quema enviada`, null, tx.hash);
  } catch (e) {}
  burnSendRunning = false;
}
function scheduleBurnAtMidnight() {
  const now = new Date();
  const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  setTimeout(async () => { await sendPendingBurns(); scheduleBurnAtMidnight(); }, nextMidnightUTC.getTime() - now.getTime());
}
// ==== HUERTO ====
const PLANT_LEVELS = {
  basic:   { name: 'Básica',  emoji: '🌱', price: 10000, waterCost: 70,  fruitValue: 125 },
  medium:  { name: 'Media',   emoji: '🌿', price: 20000, waterCost: 140,  fruitValue: 250 },
  premium: { name: 'Premium', emoji: '🌳', price: 30000, waterCost: 240, fruitValue: 375 },
  pro:     { name: 'Pro',     emoji: '🌴', price: 40000, waterCost: 320, fruitValue: 500 }
};
const MAX_PLANTS = 12;
const GROW_TIME_MIN = 25;
const PERFECT_WINDOW = 35;
const ROT_TIME = 60;
const PLANT_LIFETIME_DAYS = 30;
const PLANT_LIFETIME_SECONDS = PLANT_LIFETIME_DAYS * 24 * 60 * 60;

function getPlantStatus(plant) {
  const now = Math.floor(Date.now() / 1000);
  const level = PLANT_LEVELS[plant.level];
  const createdAt = plant.created_at || now;
  const lifetimeLeft = PLANT_LIFETIME_SECONDS - (now - createdAt);
  let daysLeft = 0, hoursLeft = 0, minutesLeftLifetime = 0, timeLeftText = '';
  if (lifetimeLeft > 0) {
    daysLeft = Math.floor(lifetimeLeft / 86400);
    hoursLeft = Math.floor((lifetimeLeft % 86400) / 3600);
    minutesLeftLifetime = Math.floor((lifetimeLeft % 3600) / 60);
    timeLeftText = daysLeft > 0 ? daysLeft + 'd ' + hoursLeft + 'h' : (hoursLeft > 0 ? hoursLeft + 'h ' + minutesLeftLifetime + 'm' : minutesLeftLifetime + 'm');
  } else timeLeftText = '0m';

  if (lifetimeLeft <= 0) return { status: 'expired', value: 0, minutesLeft: 0, progress: 0, canRefund: false, daysLeft: 0, hoursLeft: 0, timeLeftText: '0m', expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
  if (plant.status === 'dry' || !plant.last_watered) return { status: 'dry', value: 0, minutesLeft: 0, progress: 0, canRefund: false, daysLeft, hoursLeft, timeLeftText, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };

  const moonMult = parseFloat(plant.moon_multiplier || 1) || 1;
  const effectiveGrowTime = GROW_TIME_MIN / moonMult;
  const elapsed = (now - plant.last_watered) / 60;

  if (elapsed < effectiveGrowTime) return { status: 'growing', value: 0, minutesLeft: Math.ceil(effectiveGrowTime - elapsed), progress: Math.min(Math.floor((elapsed / effectiveGrowTime) * 100), 99), canRefund: false, moonBoost: moonMult > 1, daysLeft, hoursLeft, timeLeftText, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };

  const elapsedSinceReady = elapsed - effectiveGrowTime;
  const perfectDuration = PERFECT_WINDOW - GROW_TIME_MIN;
  if (elapsedSinceReady <= perfectDuration) return { status: 'ready', value: level.fruitValue, minutesLeft: Math.ceil(perfectDuration - elapsedSinceReady), progress: 100, canRefund: false, moonBoost: moonMult > 1, daysLeft, hoursLeft, timeLeftText, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };

  const witheringTotal = ROT_TIME - PERFECT_WINDOW;
  const witheringElapsed = elapsedSinceReady - perfectDuration;
  if (witheringElapsed <= witheringTotal) return { status: 'withering', value: Math.max(0, level.fruitValue * (1 - (witheringElapsed / witheringTotal) * 0.1)), minutesLeft: Math.ceil(witheringTotal - witheringElapsed), progress: 100, canRefund: false, moonBoost: moonMult > 1, daysLeft, hoursLeft, timeLeftText, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };

  return { status: 'rotten', value: 0, minutesLeft: 0, progress: 0, canRefund: true, moonBoost: moonMult > 1, daysLeft, hoursLeft, timeLeftText, expiresAt: createdAt + PLANT_LIFETIME_SECONDS };
}

// ==== ENDPOINTS ====
app.get('/moon-status', (req, res) => { const now = Math.floor(Date.now() / 1000); res.json({ success: true, active: moonState.active, startedAt: moonState.startedAt, endsAt: moonState.endsAt, secondsLeft: moonState.active ? Math.max(0, moonState.endsAt - now) : 0, multiplier: MOON_GROWTH_MULTIPLIER, durationMinutes: MOON_DURATION_MIN, eventsToday: moonState.eventsToday }); });
app.get('/blessing-status', (req, res) => { const now = Date.now(); res.json({ success: true, active: blessingState.active, startedAt: blessingState.startedAt, endsAt: blessingState.endsAt, secondsLeft: blessingState.active ? Math.max(0, Math.floor((blessingState.endsAt - now) / 1000)) : 0, multiplier: BLESSING_FRUIT_MULTIPLIER }); });

app.post('/register-referral', requireAuth, async (req, res) => {
  const userId = req.userId; const { referrerId } = req.body;
  if (!referrerId || String(referrerId) === String(userId)) return res.json({ success: true });
  try {
    const { data: yaPagado } = await supabase.from('referrals').select('id').eq('referred_id', userId).maybeSingle();
    if (yaPagado) return res.json({ success: true });
    const { data: yaPendiente } = await supabase.from('referrals_pending').select('id').eq('referred_id', userId).maybeSingle();
    if (yaPendiente) return res.json({ success: true });
    await supabase.from('referrals_pending').insert({ referrer_id: String(referrerId), referred_id: String(userId), created_at: Math.floor(Date.now() / 1000) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/my-referrals/:userId', requireAuth, async (req, res) => {
  try {
    const { data: referidos } = await supabase.from('referrals').select('referred_id, reward, created_at').eq('referrer_id', req.userId).order('created_at', { ascending: false });
    const total = (referidos || []).reduce((s, r) => s + parseFloat(r.reward || 0), 0);
    res.json({ success: true, link: 'https://t.me/' + REFERRAL_BOT_USERNAME + '?start=ref_' + req.userId, count: (referidos || []).length, totalEarned: total, rewardPerReferral: REFERRAL_REWARD, referrals: referidos || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/register-user', requireAuth, async (req, res) => {
  if (!req.body.chatId) return res.json({ success: true });
  try { await ensureUser(req.userId); await supabase.from('users_balance').update({ chat_id: req.body.chatId }).eq('user_id', req.userId); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/my-deposit-wallet', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.userId);
    if (user.deposit_address) return res.json({ success: true, address: user.deposit_address, walletBalance: parseFloat(user.wallet_balance || 0) });
    const newWallet = ethers.Wallet.createRandom();
    await supabase.from('users_balance').update({ deposit_address: newWallet.address, deposit_private_key: encryptPrivateKey(newWallet.privateKey), wallet_balance: 0 }).eq('user_id', req.userId);
    res.json({ success: true, address: newWallet.address, walletBalance: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/verify-deposit', requireAuth, async (req, res) => {
  const { txHash } = req.body;
  if (!txHash || !txHash.startsWith('0x') || txHash.length !== 66) return res.status(400).json({ error: 'Hash inválido' });
  const lockKey = `verify_${req.userId}_${txHash}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Verificación en proceso. Esperá.' });
  try {
    const user = await ensureUser(req.userId);
    if (!user.deposit_address) { releaseLock(lockKey); return res.status(400).json({ error: 'No tienes wallet' }); }
    const { data: existing } = await supabase.from('deposits').select('tx_hash').eq('tx_hash', txHash).maybeSingle();
    if (existing) { releaseLock(lockKey); return res.status(400).json({ error: '❌ Transacción ya acreditada' }); }

    const p = await getProvider();
    const tx = await p.getTransaction(txHash); const receipt = await p.getTransactionReceipt(txHash);
    if (!tx || !receipt || receipt.status !== 1) { releaseLock(lockKey); return res.status(400).json({ error: '❌ TX no encontrada o fallida' }); }
    if (!tx.to || tx.to.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()) { releaseLock(lockKey); return res.status(400).json({ error: '❌ No es del token JHOAL' }); }
    
    const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
    let decoded; try { decoded = iface.parseTransaction({ data: tx.data }); } catch (e) { releaseLock(lockKey); return res.status(400).json({ error: '❌ Error decodificando' }); }
    
    if (decoded.args.to.toLowerCase() !== user.deposit_address.toLowerCase()) { releaseLock(lockKey); return res.status(400).json({ error: '❌ Destino incorrecto' }); }
    const amount = parseFloat(ethers.formatUnits(decoded.args.amount, 18));
    if (amount <= 0) { releaseLock(lockKey); return res.status(400).json({ error: '❌ Monto inválido' }); }

    await supabase.from('deposits').insert({ user_id: req.userId, wallet: tx.from, amount: amount, tx_hash: txHash, created_at: Math.floor(Date.now() / 1000), verified_by: 'MANUAL' });
    const newWalletBalance = parseFloat(user.wallet_balance || 0) + amount;
    await supabase.from('users_balance').update({ wallet_balance: newWalletBalance }).eq('user_id', req.userId);
    await addHistory(req.userId, 'deposit', amount, '💵 Depósito verificado', null, txHash);
    releaseLock(lockKey);
    res.json({ success: true, amount, newWalletBalance, txHash, explorer: `https://bscscan.com/tx/${txHash}` });
  } catch (e) { releaseLock(lockKey); res.status(500).json({ error: e.message }); }
});

app.post('/move-to-game', requireAuth, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
  const lockKey = `move_${req.userId}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Movimiento en proceso' });
  try {
    const user = await ensureUser(req.userId);
    if (parseFloat(user.wallet_balance || 0) < amount) { releaseLock(lockKey); return res.status(400).json({ error: 'Saldo insuficiente en wallet' }); }
    const realBalance = parseFloat(ethers.formatUnits(await token.balanceOf(user.deposit_address), 18));
    if (realBalance < amount) { releaseLock(lockKey); return res.status(400).json({ error: 'La wallet no tiene fondos' }); }
    if (await txProvider.getBalance(user.deposit_address) < ethers.parseEther('0.000002')) { const bnbTx = await txWallet.sendTransaction({ to: user.deposit_address, value: ethers.parseEther('0.000002') }); await bnbTx.wait(); }
    const userSigner = new ethers.Wallet(decryptPrivateKey(user.deposit_private_key), txProvider);
    const tx = await new ethers.Contract(TOKEN_ADDRESS, ABI, userSigner).transfer(wallet.address, ethers.parseUnits(amount.toString(), 18));
    await tx.wait();
    await supabase.from('users_balance').update({ wallet_balance: parseFloat(user.wallet_balance) - amount, balance: parseFloat(user.balance) + amount }).eq('user_id', req.userId);
    await addHistory(req.userId, 'deposit_game', amount, '🎮 Movido al juego', null, tx.hash);
    releaseLock(lockKey);
    res.json({ success: true, txHash: tx.hash, newWalletBalance: parseFloat(user.wallet_balance) - amount, newGameBalance: parseFloat(user.balance) + amount, explorer: 'https://bscscan.com/tx/' + tx.hash });
  } catch (e) { releaseLock(lockKey); res.status(500).json({ error: e.message }); }
});

app.post('/claim', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.userId); const now = Math.floor(Date.now() / 1000);
    if (user.last_claim && now - user.last_claim < COOLDOWN) return res.status(429).json({ error: 'Espera ' + Math.floor((COOLDOWN - (now - user.last_claim)) / 60) + 'm' });
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) + 1, total_claimed: parseFloat(user.total_claimed || 0) + 1, last_claim: now }).eq('user_id', req.userId);
    await addHistory(req.userId, 'faucet', 1, 'Reclamo del faucet', null, null);
    intentarPagarReferido(req.userId);
    res.json({ success: true, amount: 1 });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/claim-ad-reward-manual', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.userId); const now = Math.floor(Date.now() / 1000);
    if (now - (user.last_ad_reward || 0) < AD_COOLDOWN) return res.status(429).json({ error: 'Espera ' + Math.ceil((AD_COOLDOWN - (now - user.last_ad_reward)) / 60) + ' min' });
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) + AD_REWARD_AMOUNT, last_ad_reward: now }).eq('user_id', req.userId);
    await addHistory(req.userId, 'ad_reward', AD_REWARD_AMOUNT, '📺 Recompensa por ver anuncio', null, null);
    res.json({ success: true, amount: AD_REWARD_AMOUNT, newBalance: parseFloat(user.balance) + AD_REWARD_AMOUNT });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/balance-game/:userId', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.userId);
    if (!user) return res.json({ success: true, balance: 0 });
    res.json({ success: true, balance: parseFloat(user.balance), wallet_balance: parseFloat(user.wallet_balance || 0), total_claimed: parseFloat(user.total_claimed || 0), total_won: parseFloat(user.total_won || 0), total_lost: parseFloat(user.total_lost || 0), last_claim: user.last_claim || 0, last_ad_reward: user.last_ad_reward || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/bet', requireAuth, async (req, res) => {
  const { amount, hcaptchaToken } = req.body;
  if (!amount || amount < MIN_BET || amount > MAX_BET) return res.status(400).json({ error: 'Apuesta inválida' });
  const lockKey = `bet_${req.userId}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Apuesta en proceso' });
  const currentCount = userDiceBetCounters.get(req.userId) || 0;
  const verifiedAt = userVerifiedCaptcha.get(req.userId);
  const isVerified = verifiedAt && (Date.now() - verifiedAt) < CAPTCHA_VERIFICATION_TTL;
  if (currentCount >= getDiceCaptchaThreshold(req.userId) && !isVerified) {
    if (!hcaptchaToken) { releaseLock(lockKey); return res.status(403).json({ error: 'HCAPTCHA_REQUIRED' }); }
    const verifyResult = await verificarHCaptcha(hcaptchaToken, req.ip);
    if (!verifyResult.success) { releaseLock(lockKey); return res.status(403).json({ error: 'HCAPTCHA_FAILED' }); }
    userVerifiedCaptcha.set(req.userId, Date.now()); userDiceBetCounters.set(req.userId, 0); userDiceCaptchaThresholds.delete(req.userId);
  } else userDiceBetCounters.set(req.userId, currentCount + 1);
  
  try {
    const user = await ensureUser(req.userId);
    if (parseFloat(user.balance) < amount) { releaseLock(lockKey); return res.status(400).json({ error: 'Saldo insuficiente' }); }
    const multiplier = spinRoulette(); const payout = amount * multiplier; const profit = payout - amount; const now = Math.floor(Date.now() / 1000);
    let newBalance, newWon, newLost;
    if (multiplier === 0) { newBalance = parseFloat(user.balance) - amount; newWon = parseFloat(user.total_won || 0); newLost = parseFloat(user.total_lost || 0) + amount; }
    else { newBalance = parseFloat(user.balance) - amount + payout; newWon = parseFloat(user.total_won || 0) + profit; newLost = parseFloat(user.total_lost || 0); }
    await supabase.from('users_balance').update({ balance: newBalance, total_won: newWon, total_lost: newLost }).eq('user_id', req.userId);
    await supabase.from('bets').insert({ user_id: req.userId, amount, multiplier, payout, result: multiplier === 0 ? 'lose' : 'win', created_at: now });
    if (multiplier === 0) await addHistory(req.userId, 'dice_lose', -amount, 'Perdiste en los dados (x0)', null, null);
    else await addHistory(req.userId, 'dice_win', profit, 'Ganaste x' + multiplier, null, null);
    releaseLock(lockKey);
    res.json({ success: true, multiplier, payout, profit, newBalance });
  } catch (error) { releaseLock(lockKey); res.status(500).json({ error: error.message }); }
});

app.get('/bet-history/:userId', requireAuth, async (req, res) => {
  try { const { data } = await supabase.from('bets').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(10); res.json({ success: true, bets: data || [] }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/withdraw', requireAuth, async (req, res) => {
  const { wallet: userWallet, amount } = req.body;
  if (!userWallet || !amount || amount <= 0 || !ethers.isAddress(userWallet)) return res.status(400).json({ error: 'Datos inválidos' });
  const lockKey = `withdraw_${req.userId}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Retiro en proceso' });
  try {
    const { data: recent } = await supabase.from('withdrawals').select('created_at').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (recent && Math.floor(Date.now() / 1000) - recent.created_at < WITHDRAW_COOLDOWN) { releaseLock(lockKey); return res.status(429).json({ error: '⏳ Espera entre retiros' }); }
    const user = await ensureUser(req.userId);
    if (parseFloat(user.balance) < amount) { releaseLock(lockKey); return res.status(400).json({ error: 'Saldo insuficiente' }); }
    
    const { error: updErr } = await supabase.from('users_balance').update({ balance: parseFloat(user.balance) - amount, total_withdrawn: parseFloat(user.total_withdrawn || 0) + amount }).eq('user_id', req.userId).gte('balance', amount);
    if (updErr) { releaseLock(lockKey); return res.status(400).json({ error: 'Error de saldo o retiro duplicado' }); }
    
    let tx;
    try { tx = await txToken.transfer(userWallet, ethers.parseUnits(amount.toString(), 18)); await tx.wait(); }
    catch (txErr) { await supabase.from('users_balance').update({ balance: parseFloat(user.balance), total_withdrawn: parseFloat(user.total_withdrawn || 0) }).eq('user_id', req.userId); releaseLock(lockKey); return res.status(500).json({ error: 'Error TX: ' + txErr.message }); }
    
    await supabase.from('withdrawals').insert({ user_id: req.userId, wallet: userWallet, amount, tx_hash: tx.hash, created_at: Math.floor(Date.now() / 1000) });
    await addHistory(req.userId, 'withdraw', -amount, 'Retiro a wallet', null, tx.hash);
    releaseLock(lockKey);
    res.json({ success: true, txHash: tx.hash, explorer: 'https://bscscan.com/tx/' + tx.hash, amount });
  } catch (error) { releaseLock(lockKey); res.status(500).json({ error: error.message }); }
});

app.get('/deposit-info', (req, res) => res.json({ success: true, depositWallet: wallet.address, tokenAddress: TOKEN_ADDRESS, minDeposit: 1 }));
// ==== SKILLS ====
const SKILL_PRICES = { 1: 20000, 2: 40000, 3: 60000 };
const SKILL_NAMES = { ataque: { 1: 'Ataque Básico', 2: 'Ataque Media', 3: 'Ataque Pro' }, defensa: { 1: 'Defensa Básica', 2: 'Defensa Media', 3: 'Defensa Pro' }, iman: { 1: 'Imán Básico', 2: 'Imán Media', 3: 'Imán Pro' } };

app.get('/my-skills/:userId', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('user_skills').select('*').eq('user_id', req.userId).maybeSingle();
    res.json({ success: true, skills: data || { ataque_level: 0, defensa_level: 0, iman_level: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/buy-skill', requireAuth, async (req, res) => {
  const { skillType, level } = req.body;
  if (!['ataque', 'defensa', 'iman'].includes(skillType) || ![1, 2, 3].includes(level)) return res.status(400).json({ error: 'Datos inválidos' });
  const price = SKILL_PRICES[level]; const lockKey = `buy_skill_${req.userId}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Compra en proceso' });
  try {
    const user = await ensureUser(req.userId);
    if (parseFloat(user.balance || 0) < price) { releaseLock(lockKey); return res.status(400).json({ error: `Saldo insuficiente (${price} JHOAL)` }); }
    const { data: existing } = await supabase.from('user_skills').select('*').eq('user_id', req.userId).maybeSingle();
    if (level <= (existing ? (existing[`${skillType}_level`] || 0) : 0)) { releaseLock(lockKey); return res.status(400).json({ error: 'Ya tienes esta skill' }); }
    
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) - price }).eq('user_id', req.userId);
    
    if (existing) await supabase.from('user_skills').update({ [`${skillType}_level`]: level, updated_at: Math.floor(Date.now() / 1000) }).eq('user_id', req.userId);
    else await supabase.from('user_skills').insert({ user_id: req.userId, ataque_level: skillType === 'ataque' ? level : 0, defensa_level: skillType === 'defensa' ? level : 0, iman_level: skillType === 'iman' ? level : 0, updated_at: Math.floor(Date.now() / 1000) });
    
    await addHistory(req.userId, 'skill_purchase', -price, `🛒 Compra: ${SKILL_NAMES[skillType][level]}`, null, null);
    releaseLock(lockKey);
    res.json({ success: true, message: `✅ ¡${SKILL_NAMES[skillType][level]} comprada!`, newBalance: parseFloat(user.balance) - price });
  } catch (e) { releaseLock(lockKey); res.status(500).json({ error: e.message }); }
});

// ==== PLANTAS ====
app.post('/buy-plant', requireAuth, async (req, res) => {
  const { level } = req.body; if (!PLANT_LEVELS[level]) return res.status(400).json({ error: 'Nivel inválido' });
  const lockKey = `buy_${req.userId}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Compra en proceso' });
  try {
    const user = await ensureUser(req.userId); const nowSec = Math.floor(Date.now() / 1000);
    if (user.plant_buy_cooldown_until && user.plant_buy_cooldown_until > nowSec) { releaseLock(lockKey); return res.status(429).json({ error: '⏳ Esperá para comprar', cooldownRemaining: user.plant_buy_cooldown_until - nowSec }); }
    const { count } = await supabase.from('plants').select('*', { count: 'exact', head: true }).eq('user_id', req.userId);
    if (count >= MAX_PLANTS) { releaseLock(lockKey); return res.status(400).json({ error: 'Máximo ' + MAX_PLANTS + ' plantas' }); }
    if (parseFloat(user.balance) < PLANT_LEVELS[level].price) { releaseLock(lockKey); return res.status(400).json({ error: 'Saldo insuficiente' }); }
    
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) - PLANT_LEVELS[level].price, plant_buy_cooldown_until: nowSec + BUY_COOLDOWN }).eq('user_id', req.userId);
    await supabase.from('plants').insert({ user_id: req.userId, level, status: 'dry', created_at: nowSec, moon_multiplier: 1 });
    await addHistory(req.userId, 'plant_buy', -PLANT_LEVELS[level].price, 'Compraste planta ' + PLANT_LEVELS[level].name, null, null);
    releaseLock(lockKey);
    res.json({ success: true, message: '¡Compraste una planta!', cooldownSeconds: BUY_COOLDOWN });
  } catch (error) { releaseLock(lockKey); res.status(500).json({ error: error.message }); }
});

app.post('/water-plant', requireAuth, async (req, res) => {
  const { plantId } = req.body; if (!plantId) return res.status(400).json({ error: 'Faltan datos' });
  const lockKey = `water_${plantId}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Regando...' });
  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', req.userId).maybeSingle();
    if (!plant) { releaseLock(lockKey); return res.status(400).json({ error: 'No encontrada' }); }
    const status = getPlantStatus(plant);
    if (status.status !== 'dry' && status.status !== 'rotten') { releaseLock(lockKey); return res.status(400).json({ error: 'No necesita agua' }); }
    const user = await ensureUser(req.userId); const level = PLANT_LEVELS[plant.level];
    if (parseFloat(user.balance) < level.waterCost) { releaseLock(lockKey); return res.status(400).json({ error: 'Saldo insuficiente' }); }
    
    const now = Math.floor(Date.now() / 1000); const moonMult = moonState.active ? MOON_GROWTH_MULTIPLIER : 1;
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) - level.waterCost }).eq('user_id', req.userId);
    await supabase.from('plants').update({ last_watered: now, status: 'growing', moon_multiplier: moonMult }).eq('id', plantId);
    await addHistory(req.userId, 'plant_water', -level.waterCost, 'Regaste ' + level.name, null, null);
    releaseLock(lockKey);
    res.json({ success: true, message: '¡Regaste tu planta! Lista en ' + (GROW_TIME_MIN / moonMult) + ' min.', growTimeMinutes: GROW_TIME_MIN / moonMult });
  } catch (error) { releaseLock(lockKey); res.status(500).json({ error: error.message }); }
});

app.post('/harvest', requireAuth, async (req, res) => {
  const { plantId } = req.body; if (!plantId) return res.status(400).json({ error: 'Faltan datos' });
  const lockKey = `harvest_${plantId}`;
  if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Cosechando...' });
  try {
    const { data: plant } = await supabase.from('plants').select('*').eq('id', plantId).eq('user_id', req.userId).maybeSingle();
    if (!plant) { releaseLock(lockKey); return res.status(400).json({ error: 'No encontrada' }); }
    const status = getPlantStatus(plant);
    if (status.status !== 'ready' && status.status !== 'withering') { releaseLock(lockKey); return res.status(400).json({ error: 'No lista o ya podrida' }); }
    let value = status.value; if (blessingState.active) value *= BLESSING_FRUIT_MULTIPLIER;
    const user = await ensureUser(req.userId);
    
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) + value, total_won: parseFloat(user.total_won || 0) + value }).eq('user_id', req.userId);
    await supabase.from('plants').update({ status: 'dry', last_watered: null, moon_multiplier: 1 }).eq('id', plantId);
    await addHistory(req.userId, 'plant_harvest', value, 'Cosechaste ' + PLANT_LEVELS[plant.level].name, null, null);
    releaseLock(lockKey);
    res.json({ success: true, value, message: '¡Cosechaste ' + value.toFixed(2) + ' JHOAL!' });
  } catch (error) { releaseLock(lockKey); res.status(500).json({ error: error.message }); }
});

app.post('/refund-plant', requireAuth, async (req, res) => {
  const { plantId } = req.body; if (!plantId) return res.status(400).json({ error: 'Faltan datos' });
  const lockKey = `refund_${plantId}`; if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Esperá' });
  const result = await refundPlant(req.userId, plantId); releaseLock(lockKey);
  if (result.success) res.json({ success: true, amount: result.amount, message: result.message }); else res.status(400).json({ error: result.error });
});

app.get('/my-plants/:userId', requireAuth, async (req, res) => {
  try {
    const user = await ensureUser(req.userId);
    const { data: plants } = await supabase.from('plants').select('*').eq('user_id', req.userId).order('created_at', { ascending: true });
    res.json({
      success: true,
      plants: (plants || []).map(p => {
        const status = getPlantStatus(p); const level = PLANT_LEVELS[p.level];
        return { id: p.id, level: p.level, levelName: level.name, emoji: level.emoji, status: status.status, value: status.value, minutesLeft: status.minutesLeft || 0, progress: status.progress || 0, waterCost: level.waterCost, fruitValue: level.fruitValue, canRefund: status.canRefund, refundAmount: status.canRefund ? (level.waterCost * 0.9) : 0, moonBoost: status.moonBoost, daysLeft: status.daysLeft, hoursLeft: status.hoursLeft, timeLeftText: status.timeLeftText, expiresAt: status.expiresAt };
      }),
      count: (plants || []).length, maxPlants: MAX_PLANTS,
      moon: { active: moonState.active, endsAt: moonState.endsAt, multiplier: MOON_GROWTH_MULTIPLIER },
      blessing: { active: blessingState.active, endsAt: blessingState.endsAt, multiplier: BLESSING_FRUIT_MULTIPLIER },
      plantBuyCooldownRemaining: (user.plant_buy_cooldown_until && user.plant_buy_cooldown_until > Math.floor(Date.now() / 1000)) ? user.plant_buy_cooldown_until - Math.floor(Date.now() / 1000) : 0
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/history/:userId', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50; const type = req.query.type;
    let query = supabase.from('history').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(limit);
    if (type && type !== 'all') query = query.eq('type', type);
    const { data: history } = await query;
    const { data: allHistory } = await supabase.from('history').select('type, amount').eq('user_id', req.userId);
    let summary = { faucet: 0, dice: 0, deposit: 0, withdraw: 0, garden: 0, referral: 0, prediction: 0, total: 0 };
    (allHistory || []).forEach(h => {
      const amount = parseFloat(h.amount) || 0;
      if (h.type === 'faucet') summary.faucet += amount;
      else if (h.type.startsWith('dice_')) summary.dice += amount;
      else if (h.type.startsWith('deposit')) summary.deposit += amount;
      else if (h.type === 'withdraw') summary.withdraw += amount;
      else if (h.type === 'referral_reward') summary.referral += amount;
      else if (h.type.startsWith('prediction_')) summary.prediction += amount;
      else if (h.type.startsWith('plant_')) summary.garden += amount;
      summary.total += amount;
    });
    res.json({ success: true, history: history || [], summary });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/price', async (req, res) => { const p = await getJhoalPrice(); res.json({ success: p > 0, priceUsd: p }); });
app.get('/btc-price', async (req, res) => { const p = await getBTCPrice(); res.json({ success: p > 0, price: p }); });

// ==== PREDICCIONES ====
app.get('/prediction/current', requireAuth, async (req, res) => {
  try {
    const round = await ensurePredictionRound(); const now = Math.floor(Date.now() / 1000);
    if (!round || (round.status === 'open' && now >= round.closes_at)) {
      return res.json({ success: true, waitingNextRound: true, secondsUntilNextRound: getSecondsUntilNextRound(), round: round ? { id: round.id, number: round.round_number, startPrice: parseFloat(round.start_price), currentPrice: await getBTCPrice(), totalPool: parseFloat(round.total_pool), range: PREDICTION_RANGE, canPredict: false } : null });
    }
    const { data: userPred } = await supabase.from('predictions').select('*').eq('round_id', round.id).eq('user_id', req.userId).maybeSingle();
    const user = await ensureUser(req.userId);
    const adValid = (user.last_prediction_ad >= round.started_at) || ((now - (user.last_prediction_ad || 0)) <= (PREDICTION_ROUND_DURATION / 2));
    const { count: totalPreds } = await supabase.from('predictions').select('*', { count: 'exact', head: true }).eq('round_id', round.id);
    const { data: burnedData } = await supabase.from('burn_wallet').select('amount');
    const totalBurned = (burnedData || []).reduce((s, b) => s + parseFloat(b.amount), 0);

    res.json({
      success: true, waitingNextRound: false,
      round: { id: round.id, number: round.round_number, startPrice: parseFloat(round.start_price), currentPrice: await getBTCPrice(), secondsLeft: Math.max(0, round.closes_at - now), totalPool: parseFloat(round.total_pool), accumulatedPool: parseFloat(round.accumulated_pool), range: PREDICTION_RANGE, status: round.status, canPredict: now < (round.closes_at - PREDICTION_BLOCK_LAST_SECONDS) },
      userPrediction: userPred ? { predictedPrice: parseFloat(userPred.predicted_price), won: userPred.won, payout: parseFloat(userPred.payout || 0) } : null,
      adValid, totalBurned: Math.floor(totalBurned)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/prediction/watch-ad', requireAuth, async (req, res) => {
  const lockKey = `pred_ad_${req.userId}`; if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Esperá' });
  try {
    const now = Math.floor(Date.now() / 1000); const round = await ensurePredictionRound();
    if (!round || round.status !== 'open') { releaseLock(lockKey); return res.status(400).json({ error: 'No hay ronda activa' }); }
    
    await supabase.from('prediction_rounds').update({ ads_pool: parseFloat(round.ads_pool || 0) + PREDICTION_AD_REWARD, total_pool: parseFloat(round.total_pool || 0) + PREDICTION_AD_REWARD }).eq('id', round.id);
    await supabase.from('users_balance').update({ last_prediction_ad: now }).eq('user_id', req.userId);
    await addHistory(req.userId, 'prediction_ad', 0, '📺 Anuncio visto (+5 pool)', null, null);
    releaseLock(lockKey);
    res.json({ success: true, message: '✅ +5 a la pool' });
  } catch (e) { releaseLock(lockKey); res.status(500).json({ error: e.message }); }
});

app.post('/prediction/bet', requireAuth, async (req, res) => {
  const { predictedPrice } = req.body; if (!predictedPrice || predictedPrice <= 0) return res.status(400).json({ error: 'Precio inválido' });
  const lockKey = `pred_${req.userId}`; if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Esperá' });
  try {
    const user = await ensureUser(req.userId); const now = Math.floor(Date.now() / 1000);
    const { data: round } = await supabase.from('prediction_rounds').select('*').eq('round_number', Math.floor(now / PREDICTION_ROUND_DURATION)).maybeSingle();
    if (!round || round.status !== 'open' || now >= round.closes_at - PREDICTION_BLOCK_LAST_SECONDS) { releaseLock(lockKey); return res.status(400).json({ error: 'Ronda cerrada' }); }
    if (!(user.last_prediction_ad >= round.started_at) && !((now - (user.last_prediction_ad || 0)) <= (PREDICTION_ROUND_DURATION / 2))) { releaseLock(lockKey); return res.status(403).json({ error: 'AD_REQUIRED' }); }
    
    const { data: existing } = await supabase.from('predictions').select('id').eq('round_id', round.id).eq('user_id', req.userId).maybeSingle();
    if (existing) { releaseLock(lockKey); return res.status(400).json({ error: 'Ya predijiste' }); }
    
    await supabase.from('predictions').insert({ round_id: round.id, user_id: req.userId, predicted_price: predictedPrice, created_at: now });
    await addHistory(req.userId, 'prediction_bet', 0, `🔮 Predijiste $${predictedPrice} Ronda #${round.round_number}`, null, null);
    releaseLock(lockKey);
    res.json({ success: true, message: `Predicción registrada: $${predictedPrice}` });
  } catch (e) { releaseLock(lockKey); res.status(500).json({ error: e.message }); }
});

app.get('/prediction/history/:userId', requireAuth, async (req, res) => {
  try {
    const { data: preds } = await supabase.from('predictions').select('*').eq('user_id', req.userId).order('created_at', { ascending: false }).limit(20);
    if (!preds || preds.length === 0) return res.json({ success: true, predictions: [] });
    const { data: rounds } = await supabase.from('prediction_rounds').select('*').in('round_number', [...new Set(preds.map(p => p.round_id))]);
    const roundsMap = {}; (rounds || []).forEach(r => { roundsMap[r.round_number] = r; });
    res.json({ success: true, predictions: preds.map(p => ({ ...p, prediction_rounds: roundsMap[p.round_id] || null })) });
  } catch (e) { res.json({ success: true, predictions: [] }); }
});

app.get('/prediction/last-winners', async (req, res) => {
  try {
    const { data: lastRound } = await supabase.from('prediction_rounds').select('*').eq('status', 'resolved').order('round_number', { ascending: false }).limit(1).maybeSingle();
    if (!lastRound) return res.json({ success: true, winners: [], round: null });
    const { data: preds } = await supabase.from('predictions').select('user_id, predicted_price, distance, percent_premium, payout').eq('round_id', lastRound.id).eq('won', true).order('payout', { ascending: false }).limit(10);
    res.json({ success: true, round: { number: lastRound.round_number, startPrice: parseFloat(lastRound.start_price), endPrice: parseFloat(lastRound.end_price), result: lastRound.result, totalPool: parseFloat(lastRound.total_pool) }, winners: preds || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==== MINAS ====
app.post('/mines/start', requireAuth, async (req, res) => { res.json({ success: true }); });
app.post('/mines/cashout', requireAuth, async (req, res) => {
  const { amount, type } = req.body; if (!amount || amount <= 0 || amount > 400) return res.status(400).json({ error: 'Monto inválido' });
  const lockKey = `mines_${req.userId}`; if (!acquireLock(lockKey)) return res.status(429).json({ error: '⏳ Esperá' });
  try {
    const user = await ensureUser(req.userId);
    await supabase.from('users_balance').update({ balance: parseFloat(user.balance) + amount }).eq('user_id', req.userId);
    await addHistory(req.userId, 'mines_game', amount, `⛏ Minas (${type})`, null, null);
    releaseLock(lockKey);
    res.json({ success: true, newBalance: parseFloat(user.balance) + amount, amount });
  } catch (e) { releaseLock(lockKey); res.status(500).json({ error: e.message }); }
});

// ==== BOTS TELEGRAM ====
let bot = null;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  bot.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Abrir Faucet', web_app: { url: MINI_APP_URL } } });
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id; const userId = String(msg.from.id); const payload = (match[1] || '').trim();
    if (payload.startsWith('ref_')) {
      const referrerId = payload.replace('ref_', '').trim();
      if (referrerId && referrerId !== userId) {
        const { data: yaPagado } = await supabase.from('referrals').select('id').eq('referred_id', userId).maybeSingle();
        const { data: yaPendiente } = await supabase.from('referrals_pending').select('id').eq('referred_id', userId).maybeSingle();
        if (!yaPagado && !yaPendiente) await supabase.from('referrals_pending').insert({ referrer_id: String(referrerId), referred_id: userId, created_at: Math.floor(Date.now() / 1000) });
      }
    }
    bot.sendMessage(chatId, '⚱ *HORUS FAUCET*\n\n¡Bienvenido, ' + (msg.from.first_name || 'guerrero') + '!\n\n👉 Toca abajo para empezar.', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏛 Abrir Horus Faucet', web_app: { url: MINI_APP_URL } }]] } });
  });
}

// ==== SERVIDOR ====
app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor corriendo en puerto', process.env.PORT || 3000);
  cleanupOldPlants(); cleanupExpiredPlants();
  setInterval(cleanupExpiredPlants, 5 * 60 * 1000);
  predictionLoop(); setInterval(predictionLoop, 15 * 1000);
  scheduleBurnAtMidnight();
});
