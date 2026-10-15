app.get('/prediction/last-winners', async (req, res) => {
  try {
    const { data: lastRound } = await supabase.from('prediction_rounds').select('*').eq('status', 'resolved').order('round_number', { ascending: false }).limit(1).maybeSingle();
    if (!lastRound) return res.json({ success: true, winners: [], round: null });
    const { data: preds } = await supabase.from('predictions').select('user_id, predicted_price, distance, percent_premium, payout').eq('round_id', lastRound.id).eq('won', true).order('payout', { ascending: false }).limit(10);
    res.json({
      success: true,
      round: {
        number: lastRound.round_number, startPrice: parseFloat(lastRound.start_price),
        endPrice: parseFloat(lastRound.end_price), result: lastRound.result,
        totalPool: parseFloat(lastRound.total_pool), distributed: parseFloat(lastRound.distributed || 0)
      },
      winners: (preds || []).map(p => ({
        userId: p.user_id, predictedPrice: parseFloat(p.predicted_price),
        distance: parseFloat(p.distance || 0), percentPremium: parseFloat(p.percent_premium || 0),
        payout: parseFloat(p.payout || 0)
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ==== MINAS DE HORUS ====

const MINES_MAX_CASHOUT = 400; // máximo por partida (antifraude)

// Endpoint: Iniciar partida
app.post('/mines/start', requireAuth, async (req, res) => {
  const userId = req.userId;
  try {
    await ensureUser(userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Acreditar premio de partida
app.post('/mines/cashout', requireAuth, async (req, res) => {
  const userId = req.userId;
  const { amount, type } = req.body;

  // Validaciones
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Monto inválido' });
  }
  if (amount > MINES_MAX_CASHOUT) {
    return res.status(400).json({ error: 'Monto excede el máximo permitido' });
  }

  const lockKey = `mines_cashout_${userId}`;
  if (!acquireLock(lockKey)) {
    return res.status(429).json({ error: '⏳ Ya hay un cobro en proceso' });
  }

  try {
    const user = await ensureUser(userId);
    const previousBalance = parseFloat(user.balance || 0);
    const newBalance = previousBalance + amount;

    await supabase
      .from('users_balance')
      .update({ balance: newBalance })
      .eq('user_id', userId);

    const tipoTexto = type === 'perfecto' ? '¡PERFECTO! 25 fragmentos' : 'Seguro alcanzado';
    await addHistory(
      userId,
      'mines_game',
      amount,
      `⛏ Minas de Horus (${tipoTexto})`,
      null,
      null
    );

    console.log(`⛏ Minas: ${userId} +${amount.toFixed(2)} JHOAL (${type}) | Nuevo saldo: ${newBalance.toFixed(2)}`);

    releaseLock(lockKey);
    res.json({ success: true, newBalance, amount });

  } catch (e) {
    releaseLock(lockKey);
    console.error('❌ Error en /mines/cashout:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ==== BOT PRINCIPAL ====
let bot = null;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Bot principal iniciado');
  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409')) console.log('⚠️ Conflicto de polling');
    else console.log('⚠️ Polling error:', error.code);
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
          const { data: yaPagado } = await supabase.from('referrals').select('id').eq('referred_id', userId).maybeSingle();
          if (!yaPagado) {
            const { data: yaPendiente } = await supabase.from('referrals_pending').select('id').eq('referred_id', userId).maybeSingle();
            if (!yaPendiente) {
              await supabase.from('referrals_pending').insert({ referrer_id: String(referrerId), referred_id: userId, created_at: Math.floor(Date.now() / 1000) });
              console.log(`🔗 Referido pendiente: ${referrerId} ← ${userId}`);
            }
          }
        } catch (e) { console.error('Error registrando referido en /start:', e); }
      }
    }
    bot.sendMessage(chatId,
      '⚱ *HORUS FAUCET - La ofrenda del Dios Horus* 🦅\n\n' +
      '¡Bienvenido, ' + name + '!\n\n' +
      '💰 Reclama *1 JHOAL GRATIS* cada 30 minutos\n' +
      '📺 Mirá anuncios y ganá *5 JHOAL extra*\n' +
      '🎲 Juega en *Los Dados de Horus*\n' +
      '🌱 Planta en el *Huerto de Horus*\n' +
      '🔮 Predice el precio de BTC en *Predicciones de los Dioses*\n' +
      '🌕 Atento a la *Luna Llena*\n' +
      '👑 Atento a la *Bendición del Faraón*\n' +
      '🎁 Gana *1000 JHOAL* por cada amigo que invites\n' +
      '📜 Mirá tu *Historial*\n\n' +
      '👉 Toca "Abrir Horus Faucet" para empezar.',
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '🏛 Abrir Horus Faucet', web_app: { url: MINI_APP_URL } }],
        [{ text: '💬 Únete al Grupo', url: 'https://t.me/horusfaucet' }]
      ] } }
    );
  });
