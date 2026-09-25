// ==== ANUNCIO PREDICCIÓN (sin cooldown, con captcha) ====
async function verAnuncioPrediccion() {
  if (!user) return;
  // Abrimos captcha ANTES del anuncio
  abrirCaptcha({ type: 'pred_ad' });
}

async function ejecutarVerAnuncioPrediccion(hcaptchaToken) {
  const btn = document.getElementById('watchPredAdBtn');
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Cargando anuncio...';
  try {
    let adWatched = false;
    if (typeof show_11861553 === 'function') { await show_11861553(); adWatched = true; }
    else if (adController) { await adController.show(); adWatched = true; }
    if (!adWatched) {
      showToast('❌ No hay anuncios disponibles');
      btn.disabled = false; btn.textContent = originalText;
      return;
    }
    const res = await apiFetch('/prediction/watch-ad', {
      method: 'POST',
      body: JSON.stringify({ userId: user.id, hcaptchaToken: hcaptchaToken })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ ' + data.message);
      playWinSound();
      await cargarPrediccion();
    } else {
      if (data.error === 'HCAPTCHA_REQUIRED' || data.error === 'HCAPTCHA_FAILED') {
        abrirCaptcha({ type: 'pred_ad' });
        return;
      }
      showToast('❌ ' + data.error);
      btn.disabled = false; btn.textContent = originalText;
    }
  } catch (e) {
    showToast('❌ No completaste el anuncio');
    btn.disabled = false; btn.textContent = originalText;
  }
}
