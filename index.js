async function verAnuncioRecompensa() {
  if (!user) return;
  const lastAdLocal = parseInt(localStorage.getItem('lastAdReward_' + user.id) || '0');
  const elapsedLocal = Date.now() - lastAdLocal;
  if (lastAdLocal > 0 && elapsedLocal < AD_COOLDOWN_MS) {
    const remaining = AD_COOLDOWN_MS - elapsedLocal;
    const min = Math.floor(remaining / 60000);
    const seg = Math.floor((remaining % 60000) / 1000);
    showToast('⏳ Espera ' + min + 'm ' + seg + 's para ver otro anuncio');
    return;
  }

  const captcha = await pedirCaptchaYEsperar('Resolvé para ver el anuncio');
  if (!captcha) return;

  const btn = document.getElementById('watchAdBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Cargando anuncio...';
  try {
    let adWatched = false;
    if (typeof show_11861553 === 'function') { await show_11861553(); adWatched = true; }
    else if (adController) { await adController.show(); adWatched = true; }
    if (!adWatched) { showToast('❌ No hay anuncios disponibles'); btn.disabled = false; btn.textContent = originalText; return; }
    const res = await fetch(BACKEND_URL + '/claim-ad-reward-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-init-data': tg.initData || '' },
      body: JSON.stringify({ userId: user.id, initData: tg.initData, captchaAnswer: captcha })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ ¡Ganaste ' + data.amount + ' JHOAL!');
      localStorage.setItem('lastAdReward_' + user.id, Date.now().toString());
      startAdCooldown(AD_COOLDOWN_MS);
      await cargarSaldo();
    } else {
      showToast('❌ ' + data.error);
      if (data.error && data.error.includes('Espera')) { localStorage.setItem('lastAdReward_' + user.id, Date.now().toString()); startAdCooldown(AD_COOLDOWN_MS); }
    }
  } catch (e) { showToast('❌ No completaste el anuncio'); }
  btn.disabled = false; btn.textContent = originalText;
}
