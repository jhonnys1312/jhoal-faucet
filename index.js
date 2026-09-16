import express from 'express';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

// ==== CONFIG ====
const RPC = 'https://bsc-dataseed.binance.org/';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const AMOUNT = ethers.parseUnits('1', 18);
const REFERRAL_BONUS = ethers.parseUnits('0.25', 18);
const COOLDOWN = 30 * 60;
// ================

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FALTA SUPABASE_URL o SUPABASE_SECRET_KEY en Environment!');
}

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
const token = new ethers.Contract(TOKEN_ADDRESS, ABI, wallet);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'hace ' + seconds + 's';
  if (seconds < 3600) return 'hace ' + Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return 'hace ' + Math.floor(seconds / 3600) + 'h';
  return 'hace ' + Math.floor(seconds / 86400) + 'd';
}

// ==== ENDPOINT: RECLAMAR ====
app.post('/claim', async (req, res) => {
  const { userId, wallet: userWallet, referrerId } = req.body;

  if (!userId || !userWallet) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (!ethers.isAddress(userWallet)) {
    return res.status(400).json({ error: 'Wallet invalida' });
  }

  try {
    const { data: existing, error: selError } = await supabase
      .from('claims')
      .select('last_claim')
      .eq('user_id', userId)
      .maybeSingle();

    if (selError) throw selError;

    const now = Math.floor(Date.now() / 1000);

    if (existing && now - existing.last_claim < COOLDOWN) {
      const restante = COOLDOWN - (now - existing.last_claim);
      return res.status(429).json({
        error: 'Espera ' + Math.floor(restante / 60) + 'm ' + (restante % 60) + 's antes de reclamar otra vez'
      });
    }

    // Registrar referido si es primera vez
    if (referrerId && !existing) {
      const { data: alreadyRef } = await supabase
        .from('referrals')
        .select('referred_id')
        .eq('referred_id', userId)
        .maybeSingle();

      if (!alreadyRef && Number(referrerId) !== Number(userId)) {
        await supabase.from('referrals').insert({
          referred_id: userId,
          referrer_id: Number(referrerId),
          created_at: now
        });
      }
    }

    // Enviar 1 JHOAL al usuario
    const tx = await token.transfer(userWallet, AMOUNT);
    console.log('TX reclamar:', tx.hash);

    // Enviar 0.25 JHOAL al referidor (si aplica)
    let bonusTxHash = null;
    const { data: refData } = await supabase
      .from('referrals')
      .select('referrer_id')
      .eq('referred_id', userId)
      .maybeSingle();

    if (refData) {
      const { data: referrerClaim } = await supabase
        .from('claims')
        .select('wallet')
        .eq('user_id', refData.referrer_id)
        .maybeSingle();

      if (referrerClaim && referrerClaim.wallet) {
        try {
          const bonusTx = await token.transfer(referrerClaim.wallet, REFERRAL_BONUS);
          bonusTxHash = bonusTx.hash;
          console.log('Bonus referido:', bonusTx.hash);
        } catch (e) {
          console.log('Error bonus:', e.message);
        }
      }
    }

    // Guardar/actualizar en DB
    await supabase.from('claims').upsert({
      user_id: userId,
      wallet: userWallet,
      last_claim: now
    });

    await tx.wait();

    res.json({
      success: true,
      txHash: tx.hash,
      bonusTxHash: bonusTxHash,
      explorer: 'https://bscscan.com/tx/' + tx.hash,
      amount: '1 JHOAL'
    });
  } catch (error) {
    console.error('Error claim:', error);
    res.status(500).json({ error: 'Error al enviar tokens: ' + error.message });
  }
});

// ==== ENDPOINT: BALANCE ====
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

// ==== ENDPOINT: ÚLTIMOS RECLAMOS ====
app.get('/recent', async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('claims')
      .select('user_id, wallet, last_claim')
      .order('last_claim', { ascending: false })
      .limit(10);

    if (error) throw error;

    const recent = (rows || []).map(row => ({
      userId: row.user_id,
      wallet: row.wallet.slice(0, 6) + '...' + row.wallet.slice(-4),
      fullWallet: row.wallet,
      time: row.last_claim,
      ago: timeAgo(row.last_claim)
    }));

    res.json({ success: true, recent: recent });
  } catch (e) {
    console.error('Error recent:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: MIS REFERIDOS ====
app.get('/my-referrals/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const { data: refs, error } = await supabase
      .from('referrals')
      .select('referred_id, created_at')
      .eq('referrer_id', userId);

    if (error) throw error;

    const total = (refs || []).length;
    const ganado = total * 0.25;

    res.json({
      success: true,
      totalReferidos: total,
      jhoalGanado: ganado,
      referidos: refs || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==== ENDPOINT: ROOT ====
app.get('/', (req, res) => {
  res.json({ status: 'Faucet JHOAL funcionando' });
});

// ==== INICIAR SERVIDOR ====
app.listen(process.env.PORT || 3000, () => {
  console.log('Faucet JHOAL corriendo en puerto', process.env.PORT || 3000);
  console.log('Wallet de la faucet:', wallet.address);
  console.log('Supabase conectado:', SUPABASE_URL);
});
