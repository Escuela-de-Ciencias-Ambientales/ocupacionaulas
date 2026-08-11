(() => {
  'use strict';

  const config = window.RESERVAS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const iconos = { aula: '🏫', oficina: '🗄️', bano: '🚻', otro: '📍' };
  const apiUrl = config.supabaseUrl ? `${config.supabaseUrl}/functions/v1/limpieza-conserje-api` : '';

  const state = {
    conserjePassword: null,
    conserjeNombre: null,
    aposentoActual: null,
    labores: [],
    resumen: [],
    foto: null,
    fotoUrl: null,
    qrScanner: null,
    autoTimer: null
  };

  function showStep(step) {
    document.querySelectorAll('#conserjeriaDialog .conserjeria-step').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.step === step);
    });
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.className = 'conserjeria-msg' + (kind ? ` is-${kind}` : '');
    el.textContent = text || '';
  }

  function fechaCR(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function fechaHoraActual() {
    return new Intl.DateTimeFormat('es-CR', {
      timeZone: 'America/Costa_Rica', dateStyle: 'full', timeStyle: 'short'
    }).format(new Date());
  }

  function formatHora(hora) {
    if (!hora) return '';
    const partes = String(hora).split(':');
    return `${partes[0]}:${partes[1]}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  async function callApi(action, payload = {}) {
    if (!apiUrl || !config.supabaseAnonKey) throw new Error('La conexión todavía no está lista.');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, password: state.conserjePassword, ...payload })
    });
    let data = null;
    try { data = await response.json(); } catch (_error) { /* respuesta no JSON */ }
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'No fue posible completar la solicitud.');
    return data;
  }

  function abrirDialogo() {
    $('conserjeriaDialog').showModal();
    if (state.conserjePassword) {
      $('conserjeriaSessionName').textContent = state.conserjeNombre;
      showStep('scan');
      cargarResumen();
    } else {
      showStep('login');
      window.setTimeout(() => $('conserjeriaPassword')?.focus(), 60);
    }
  }

  function limpiarFoto() {
    if (state.fotoUrl) URL.revokeObjectURL(state.fotoUrl);
    state.foto = null;
    state.fotoUrl = null;
    $('conserjeriaFoto').value = '';
    $('conserjeriaFotoPreview').hidden = true;
    $('conserjeriaFotoImage').removeAttribute('src');
    $('conserjeriaFotoSize').textContent = '';
  }

  function cerrarSesionConserjeria() {
    detenerScanner();
    clearInterval(state.autoTimer);
    limpiarFoto();
    state.conserjePassword = null;
    state.conserjeNombre = null;
    state.aposentoActual = null;
    state.labores = [];
    state.resumen = [];
    showStep('login');
    $('conserjeriaPassword').value = '';
    window.setTimeout(() => $('conserjeriaPassword')?.focus(), 60);
  }

  async function login(event) {
    event.preventDefault();
    const pw = $('conserjeriaPassword').value.trim();
    const msg = $('conserjeriaLoginMsg');
    setMsg(msg, '');
    if (!pw) return;
    const btn = $('conserjeriaLoginBtn');
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    state.conserjePassword = pw;
    try {
      const data = await callApi('login');
      state.conserjeNombre = data.conserje.nombre;
      $('conserjeriaPassword').value = '';
      $('conserjeriaSessionName').textContent = state.conserjeNombre;
      $('conserjeriaSummaryDate').value = fechaCR();
      showStep('scan');
      await cargarResumen();
    } catch (error) {
      state.conserjePassword = null;
      setMsg(msg, error.message || 'Contraseña incorrecta.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  }

  function estadoResumen(item) {
    if (!item.reportado) return { key: 'pending', label: 'Pendiente', icon: '○' };
    if ((item.labores_pendientes || []).length || (item.foto_requerida && !item.foto_adjunta)) {
      return { key: 'incomplete', label: 'Incompleto', icon: '!' };
    }
    return { key: 'complete', label: 'Completado', icon: '✓' };
  }

  function renderResumen() {
    const room = $('conserjeriaSummaryRoom').value;
    const items = state.resumen.filter((item) => !room || item.aposento_id === room);
    const estados = items.map(estadoResumen);
    const total = items.length;
    const completos = estados.filter((e) => e.key === 'complete').length;
    const pendientes = estados.filter((e) => e.key === 'pending').length;
    const incompletos = estados.filter((e) => e.key === 'incomplete').length;
    $('conserjeriaSummaryCounts').innerHTML = `
      <span><b>${completos}</b> completos</span>
      <span><b>${pendientes}</b> pendientes</span>
      <span><b>${incompletos}</b> incompletos</span>`;

    if (!total) {
      $('conserjeriaSummaryList').innerHTML = '<p class="conserjeria-empty">No hay aposentos programados ni reportados para este día.</p>';
      return;
    }
    $('conserjeriaSummaryList').innerHTML = items.map((item) => {
      const estado = estadoResumen(item);
      const faltan = (item.labores_pendientes || []).map((labor) => labor.nombre);
      if (item.foto_requerida && !item.foto_adjunta) faltan.push('Fotografía');
      const detalle = !item.reportado
        ? 'Aún no se ha enviado el reporte'
        : faltan.length
          ? `Falta: ${escapeHtml(faltan.join(', '))}`
          : `Último reporte ${formatHora(item.ultima_hora)}${Number(item.cantidad_reportes) > 1 ? ` · ${item.cantidad_reportes} reportes` : ''}`;
      return `<article class="conserjeria-summary-item is-${estado.key}">
        <span class="conserjeria-summary-status" aria-hidden="true">${estado.icon}</span>
        <div><strong>${escapeHtml(item.aposento)}</strong><p>${detalle}</p></div>
        <small>${estado.label}</small>
      </article>`;
    }).join('');
  }

  function actualizarFiltroRecintos() {
    const select = $('conserjeriaSummaryRoom');
    const previo = select.value;
    select.innerHTML = '<option value="">Todos</option>' + state.resumen.map((item) =>
      `<option value="${escapeHtml(item.aposento_id)}">${escapeHtml(item.aposento)}</option>`
    ).join('');
    if ([...select.options].some((option) => option.value === previo)) select.value = previo;
  }

  async function cargarResumen() {
    if (!state.conserjePassword) return;
    const list = $('conserjeriaSummaryList');
    list.innerHTML = '<p class="conserjeria-tip">Cargando la jornada…</p>';
    const date = $('conserjeriaSummaryDate').value || fechaCR();
    $('conserjeriaSummaryDate').value = date;
    try {
      const data = await callApi('summary', { date });
      state.resumen = data.items || [];
      actualizarFiltroRecintos();
      renderResumen();
    } catch (error) {
      list.innerHTML = `<p class="conserjeria-empty is-error">${escapeHtml(error.message)}</p>`;
    }
  }

  function iniciarScanner() {
    setMsg($('conserjeriaScanMsg'), '');
    if (!window.Html5Qrcode) {
      setMsg($('conserjeriaScanMsg'), 'El lector QR no está disponible. Recarga la página e intenta de nuevo.', 'error');
      return;
    }
    $('conserjeriaScanIdle').hidden = true;
    $('conserjeriaScanActivo').hidden = false;
    state.qrScanner = new Html5Qrcode('conserjeriaQrReader');
    state.qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 230 },
      onScanSuccess,
      () => {}
    ).catch(() => {
      state.qrScanner = null;
      $('conserjeriaScanActivo').hidden = true;
      $('conserjeriaScanIdle').hidden = false;
      setMsg($('conserjeriaScanMsg'), 'No se pudo acceder a la cámara. Verifica el permiso de cámara e intenta de nuevo.', 'error');
    });
  }

  async function detenerScanner() {
    if (!state.qrScanner) return;
    const scanner = state.qrScanner;
    state.qrScanner = null;
    try { await scanner.stop(); } catch (_error) { /* ya estaba detenido */ }
    try { scanner.clear(); } catch (_error) { /* contenedor ya limpio */ }
  }

  function extraerSlugQr(decodedText) {
    let slug = String(decodedText || '').trim();
    try {
      const url = new URL(slug);
      slug = url.searchParams.get('aposento') || '';
    } catch (_error) { /* algunos QR contienen únicamente el slug */ }
    return /^[a-z0-9-]{2,80}$/.test(slug) ? slug : '';
  }

  async function onScanSuccess(decodedText) {
    await detenerScanner();
    $('conserjeriaScanActivo').hidden = true;
    $('conserjeriaScanIdle').hidden = false;
    const slug = extraerSlugQr(decodedText);
    if (!slug) {
      setMsg($('conserjeriaScanMsg'), 'Este QR no corresponde a un aposento registrado.', 'error');
      return;
    }
    await cargarAposentoEscaneado(slug);
  }

  function renderChecklist() {
    const container = $('conserjeriaChecklist');
    if (!state.labores.length) {
      container.innerHTML = '<p class="conserjeria-empty">Este recinto todavía no tiene labores configuradas.</p>';
      return;
    }
    container.innerHTML = state.labores.map((labor, index) => `
      <label class="conserjeria-check-item" for="conserjeriaLabor${index}">
        <input type="checkbox" id="conserjeriaLabor${index}" data-labor-id="${escapeHtml(labor.id)}" />
        <span>${escapeHtml(labor.nombre)}${labor.obligatoria ? '<small>Labor programada</small>' : ''}</span>
      </label>`).join('');
  }

  async function cargarAposentoEscaneado(slug) {
    const msg = $('conserjeriaScanMsg');
    setMsg(msg, 'Abriendo formulario…', 'success');
    try {
      const data = await callApi('context', { slug });
      const context = data.context;
      state.aposentoActual = {
        slug,
        nombre: context.aposento_nombre,
        tipo: context.aposento_tipo,
        fotoRequerida: Boolean(context.foto_requerida)
      };
      state.labores = Array.isArray(context.labores) ? context.labores : [];
      limpiarFoto();
      $('conserjeriaAposentoLabel').textContent = state.aposentoActual.nombre;
      $('conserjeriaFechaHora').value = fechaHoraActual();
      $('conserjeriaFuncionario').value = state.conserjeNombre;
      $('conserjeriaAposento').value = state.aposentoActual.nombre;
      $('conserjeriaAposentoIcono').textContent = iconos[state.aposentoActual.tipo] || iconos.otro;
      $('conserjeriaObservaciones').value = '';
      $('conserjeriaFotoRequired').textContent = state.aposentoActual.fotoRequerida ? '(requerida en este turno)' : '(opcional)';
      renderChecklist();
      setMsg(msg, '');
      showStep('form');
    } catch (error) {
      setMsg(msg, error.message || 'No fue posible abrir el formulario.', 'error');
    }
  }

  function cargarImagen(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No fue posible leer la fotografía.')); };
      img.src = url;
    });
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  async function comprimirFoto(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('Selecciona una imagen válida.');
    const img = await cargarImagen(file);
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = null;
    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      blob = await canvasBlob(canvas, quality);
      if (blob && blob.size <= 750 * 1024) break;
    }
    if (!blob || blob.size > 1024 * 1024) throw new Error('La fotografía no pudo comprimirse lo suficiente. Toma otra con menor resolución.');
    return blob;
  }

  function blobBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('No fue posible preparar la fotografía.'));
      reader.readAsDataURL(blob);
    });
  }

  async function seleccionarFoto(event) {
    const msg = $('conserjeriaFormMsg');
    setMsg(msg, '');
    const file = event.target.files?.[0];
    if (!file) return limpiarFoto();
    try {
      setMsg(msg, 'Comprimiendo fotografía…', 'success');
      const blob = await comprimirFoto(file);
      limpiarFoto();
      state.foto = blob;
      state.fotoUrl = URL.createObjectURL(blob);
      $('conserjeriaFotoImage').src = state.fotoUrl;
      $('conserjeriaFotoSize').textContent = `${Math.round(blob.size / 1024)} KB · JPEG comprimido`;
      $('conserjeriaFotoPreview').hidden = false;
      setMsg(msg, 'Fotografía lista para enviar.', 'success');
    } catch (error) {
      limpiarFoto();
      setMsg(msg, error.message, 'error');
    }
  }

  async function enviarReporte(event) {
    event.preventDefault();
    const btn = $('conserjeriaEnviarBtn');
    const msg = $('conserjeriaFormMsg');
    setMsg(msg, '');
    if (!state.aposentoActual) return;
    if (state.aposentoActual.fotoRequerida && !state.foto) {
      setMsg(msg, 'Este turno requiere una fotografía antes de enviar.', 'error');
      return;
    }
    const checklist = [...$('conserjeriaChecklist').querySelectorAll('input[data-labor-id]')].map((input) => ({
      labor_id: input.dataset.laborId,
      completada: input.checked
    }));
    btn.disabled = true;
    btn.textContent = state.foto ? 'Enviando foto y reporte…' : 'Enviando…';
    try {
      const photoBase64 = state.foto ? await blobBase64(state.foto) : null;
      const data = await callApi('report', {
        slug: state.aposentoActual.slug,
        checklist,
        observations: $('conserjeriaObservaciones').value.trim(),
        photoBase64
      });
      $('conserjeriaExitoTexto').textContent = `${state.aposentoActual.nombre} — gracias ${data.result.conserje_nombre}.`;
      limpiarFoto();
      await cargarResumen();
      showStep('exito');
      let seg = 4;
      $('conserjeriaCountdown').textContent = `Volviendo al escáner en ${seg}s…`;
      clearInterval(state.autoTimer);
      state.autoTimer = setInterval(() => {
        seg -= 1;
        if (seg <= 0) { clearInterval(state.autoTimer); showStep('scan'); }
        else $('conserjeriaCountdown').textContent = `Volviendo al escáner en ${seg}s…`;
      }, 1000);
    } catch (error) {
      setMsg(msg, error.message || 'No se pudo enviar el reporte.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
  }

  $('conserjeriaOpenBtn')?.addEventListener('click', abrirDialogo);
  $('conserjeriaCloseBtn')?.addEventListener('click', () => { detenerScanner(); $('conserjeriaDialog').close(); });
  $('conserjeriaDialog')?.addEventListener('cancel', () => detenerScanner());
  $('conserjeriaLoginForm')?.addEventListener('submit', login);
  $('conserjeriaLogoutBtn')?.addEventListener('click', cerrarSesionConserjeria);
  $('conserjeriaScanBtn')?.addEventListener('click', iniciarScanner);
  $('conserjeriaCancelScanBtn')?.addEventListener('click', () => {
    detenerScanner();
    $('conserjeriaScanActivo').hidden = true;
    $('conserjeriaScanIdle').hidden = false;
  });
  $('conserjeriaRefreshSummary')?.addEventListener('click', cargarResumen);
  $('conserjeriaSummaryDate')?.addEventListener('change', cargarResumen);
  $('conserjeriaSummaryRoom')?.addEventListener('change', renderResumen);
  $('conserjeriaFoto')?.addEventListener('change', seleccionarFoto);
  $('conserjeriaFotoRemove')?.addEventListener('click', limpiarFoto);
  $('conserjeriaReporteForm')?.addEventListener('submit', enviarReporte);
  $('conserjeriaVolverScanBtn')?.addEventListener('click', () => { limpiarFoto(); showStep('scan'); });
  $('conserjeriaSiguienteBtn')?.addEventListener('click', () => { clearInterval(state.autoTimer); showStep('scan'); });
  $('conserjeriaSummaryDate').value = fechaCR();
})();
