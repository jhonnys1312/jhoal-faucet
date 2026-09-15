import express from 'express';
import { ethers } from 'ethers';
import Database from 'better-sqlite3';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

// ==== CONFIG ====
const RPC = 'https://bsc-dataseed.binance.org/';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const AMOUNT = ethers.parseUnits('1', 18); // 1 JHOAL por reclamo
const COOLDOWN = 30 * 60; // 30 minutos
// ================

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const ABI = ['function transfer(address to, uint256 amount) returns (bool)'];
const token = new ethers.Contract(TOKEN_ADDRESS, ABI, wallet);

const db = new Database('faucet.db');
db.exec(`CREATE TABLE IF NOT EXISTS claims (
  user_id INTEGER PRIMARY KEY,
  wallet TEXT,
  last_claim INTEGER
)`);

// ==== ENDPOINT PRINCIPAL ====
app.post('/claim', async (req, res) => {
  const { userId, wallet: userWallet } = req.body;

  if (!userId || !userWallet) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  if (!ethers.isAddress(userWallet)) {
    return res.status(400).json({ error: 'Wallet inválida' });
  }

  const row = db.prepare('SELECT last_claim FROM claims WHERE user_id = ?').get(userId);
  const now = Math.floor(Date.now() / 1000);

  if (row && now - row.last_claim < COOLDOWN) {
    const restante = COOLDOWN - (now - row.last_claim);
    const minutos = Math.floor(restante / 60);
    const segundos = restante % 60;
    return res.status(429).json({
      error: Espera ${minutos}m ${segundos}s antes de reclamar otra vez
    });
  }

  try {
    const tx = await token.transfer(userWallet, AMOUNT);
    console.log('TX enviada:', tx.hash);

    db.prepare('INSERT OR REPLACE INTO claims VALUES (?, ?, ?)').run(userId, userWallet, now);

    await tx.wait();

    res.json({
      success: true,
      txHash: tx.hash,
      explorer: https://bscscan.com/tx/${tx.hash},
      amount: '1 JHOAL'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al enviar tokens: ' + error.message });
  }
});

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

app.get('/', (req, res) => {
  res.json({ status: 'Faucet JHOAL funcionando 🚰' });
});

app.listen(process.env.PORT || 3000, () => {
  console.log('🚰 Faucet JHOAL corriendo en puerto', process.env.PORT || 3000);
  console.log('Wallet de la faucet:', wallet.address);
});