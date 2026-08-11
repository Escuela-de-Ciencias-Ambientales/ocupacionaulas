(() => {
  'use strict';

  const config = window.RESERVAS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const iconos = { aula: '🏫', oficina: '🗄️', bano: '🚻', otro: '📍' };
  const apiUrl = window.CONSERJERIA_API_URL
    || (config.supabaseUrl ? `${config.supabaseUrl}/functions/v1/limpieza-conserje-api` : '');
  const sessionStorageKey = 'edeca_conserjeria_session_v1';

  const state = {
    sessionToken: null,
    conserjeNombre: null,
    aposentoActual: null,
    labores: [],
    resumen: [],
    reportes: [],
    foto: null,
    fotoUrl: null,
    qrScanner: null,
    autoTimer: null,
    activeTab: 'scan'
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
    const match = String(hora).match(/(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : '';
  }

  function formatFechaReporte(fecha) {
    return new Intl.DateTimeFormat('es-CR', {
      timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit'
    }).format(new Date(fecha));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function guardarSesion() {
    try {
      localStorage.setItem(sessionStorageKey, JSON.stringify({
        token: state.sessionToken,
        nombre: state.conserjeNombre
      }));
    } catch (_error) { /* la sesión seguirá activa mientras la página permanezca abierta */ }
  }

  function restaurarSesion() {
    try {
      const saved = JSON.parse(localStorage.getItem(sessionStorageKey) || 'null');
      if (saved?.token && saved?.nombre) {
        state.sessionToken = saved.token;
        state.conserjeNombre = saved.nombre;
      }
    } catch (_error) { /* almacenamiento vacío o no disponible */ }
  }

  function eliminarSesionLocal() {
    state.sessionToken = null;
    state.conserjeNombre = null;
    try { localStorage.removeItem(sessionStorageKey); } catch (_error) { /* no disponible */ }
  }

  async function callApi(action, payload = {}) {
    if (!apiUrl || !config.supabaseAnonKey) throw new Error('La conexión todavía no está lista.');
    const authPayload = action === 'login' ? {} : { sessionToken: state.sessionToken };
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, ...authPayload, ...payload })
    });
    let data = null;
    try { data = await response.json(); } catch (_error) { /* respuesta no JSON */ }
    if (!response.ok || !data?.ok) {
      if (data?.sessionExpired) {
        eliminarSesionLocal();
        detenerScanner();
        showStep('login');
      }
      throw new Error(data?.error || 'No fue posible completar la solicitud.');
    }
    return data;
  }

  function activarTab(tab, options = {}) {
    state.activeTab = tab;
    document.querySelectorAll('[data-conserjeria-tab]').forEach((button) => {
      const active = button.dataset.conserjeriaTab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-conserjeria-panel]').forEach((panel) => {
      const active = panel.dataset.conserjeriaPanel === tab;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    if (tab !== 'scan') detenerScanner();
    if (tab === 'agenda' && !state.resumen.length) cargarResumen();
    if (tab === 'reports') cargarReportes();
    if (tab === 'scan' && options.autoScan) window.setTimeout(iniciarScanner, 80);
  }

  function mostrarSesion(options = {}) {
    $('conserjeriaSessionName').textContent = state.conserjeNombre;
    showStep('scan');
    activarTab('scan', { autoScan: options.autoScan });
    cargarResumen({ silent: true });
  }

  function abrirDialogo() {
    $('conserjeriaDialog').showModal();
    if (state.sessionToken) mostrarSesion({ autoScan: true });
    else {
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

  async function cerrarSesionConserjeria() {
    const token = state.sessionToken;
    detenerScanner();
    clearInterval(state.autoTimer);
    limpiarFoto();
    if (token) await callApi('logout').catch(() => {});
    eliminarSesionLocal();
    state.aposentoActual = null;
    state.labores = [];
    state.resumen = [];
    state.reportes = [];
    showStep('login');
    $('conserjeriaPassword').value = '';
    window.setTimeout(() => $('conserjeriaPassword')?.focus(), 60);
  }

  async function login(event) {
    event.preventDefault();
    const password = $('conserjeriaPassword').value.trim();
    const msg = $('conserjeriaLoginMsg');
    setMsg(msg, '');
    if (!password) return;
    const btn = $('conserjeriaLoginBtn');
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    try {
      const data = await callApi('login', { password });
      state.sessionToken = data.sessionToken;
      state.conserjeNombre = data.conserje.nombre;
      guardarSesion();
      $('conserjeriaPassword').value = '';
      $('conserjeriaSummaryDate').value = fechaCR();
      $('conserjeriaReportsDate').value = fechaCR();
      mostrarSesion({ autoScan: true });
    } catch (error) {
      setMsg(msg, error.message || 'Contraseña incorrecta.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  }

  function estadoResumen(item) {
    if (!item.reportado) return { key: 'pending', label: 'Pendiente', icon: '○' };
    if ((item.labores_pendientes || []).length || item.foto_requerida) {
      return { key: 'incomplete', label: 'Incompleto', icon: '!' };
    }
    return { key: 'complete', label: 'Completado', icon: '✓' };
  }

  function laboresFaltantes(item) {
    if (!item.reportado) return (item.labores || []).map((labor) => labor.nombre);
    const pendientes = (item.labores_pendientes || []).map((labor) => labor.nombre);
    if (item.foto_requerida) pendientes.push('Fotografía del turno');
    return pendientes;
  }

  function renderResumen() {
    const room = $('conserjeriaSummaryRoom').value;
    const items = state.resumen.filter((item) => !room || item.aposento_id === room);
    const estados = items.map(estadoResumen);
    const completos = estados.filter((e) => e.key === 'complete').length;
    const pendientes = estados.filter((e) => e.key === 'pending').length;
    const incompletos = estados.filter((e) => e.key === 'incomplete').length;
    $('conserjeriaSummaryCounts').innerHTML = `
      <span><b>${completos}</b> completos</span>
      <span><b>${pendientes}</b> pendientes</span>
      <span><b>${incompletos}</b> incompletos</span>`;

    if (!items.length) {
      $('conserjeriaSummaryList').innerHTML = '<p class="conserjeria-empty">No hay aposentos programados ni reportados para este día.</p>';
      return;
    }
    $('conserjeriaSummaryList').innerHTML = items.map((item) => {
      const estado = estadoResumen(item);
      const faltan = laboresFaltantes(item);
      const detalle = faltan.length
        ? `${item.reportado ? 'Falta' : 'Pendiente'}: ${escapeHtml(faltan.join(', '))}`
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

  async function cargarResumen(options = {}) {
    if (!state.sessionToken) return;
    const list = $('conserjeriaSummaryList');
    if (!options.silent) list.innerHTML = '<p class="conserjeria-tip">Cargando la agenda…</p>';
    const date = $('conserjeriaSummaryDate').value || fechaCR();
    $('conserjeriaSummaryDate').value = date;
    try {
      const data = await callApi('summary', { date });
      state.resumen = data.items || [];
      actualizarFiltroRecintos();
      renderResumen();
    } catch (error) {
      if (state.sessionToken) list.innerHTML = `<p class="conserjeria-empty is-error">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderReportes() {
    const container = $('conserjeriaReportsList');
    if (!state.reportes.length) {
      container.innerHTML = '<p class="conserjeria-empty">No has enviado reportes en este día.</p>';
      return;
    }
    container.innerHTML = state.reportes.map((reporte) => {
      const checklist = Array.isArray(reporte.checklist) ? reporte.checklist : [];
      const realizadas = checklist.filter((labor) => labor.completada).map((labor) => labor.nombre);
      const faltantes = checklist.filter((labor) => !labor.completada).map((labor) => labor.nombre);
      return `<article class="conserjeria-report-item">
        <div class="conserjeria-report-item-head"><strong>${escapeHtml(reporte.aposento)}</strong><time>${escapeHtml(formatFechaReporte(reporte.fecha))}</time></div>
        <div class="conserjeria-report-badges">
          <span>${realizadas.length} labores realizadas</span>
          ${reporte.foto_adjunta ? '<span>📷 Con fotografía</span>' : ''}
          ${faltantes.length ? `<span class="is-missing">Faltan ${faltantes.length}</span>` : ''}
        </div>
        ${faltantes.length ? `<p><b>Labores faltantes:</b> ${escapeHtml(faltantes.join(', '))}</p>` : ''}
        ${reporte.observaciones ? `<p><b>Observaciones:</b> ${escapeHtml(reporte.observaciones)}</p>` : ''}
      </article>`;
    }).join('');
  }

  async function cargarReportes(options = {}) {
    if (!state.sessionToken) return;
    const container = $('conserjeriaReportsList');
    if (!options.silent) container.innerHTML = '<p class="conserjeria-tip">Cargando reportes…</p>';
    const date = $('conserjeriaReportsDate').value || fechaCR();
    $('conserjeriaReportsDate').value = date;
    try {
      const data = await callApi('reports', { date });
      state.reportes = data.reports || [];
      renderReportes();
    } catch (error) {
      if (state.sessionToken) container.innerHTML = `<p class="conserjeria-empty is-error">${escapeHtml(error.message)}</p>`;
    }
  }

  function iniciarScanner() {
    setMsg($('conserjeriaScanMsg'), '');
    if (state.qrScanner) return;
    if (!window.Html5Qrcode) {
      setMsg($('conserjeriaScanMsg'), 'El lector QR no está disponible. Recarga la página e intenta de nuevo.', 'error');
      return;
    }
    $('conserjeriaScanIdle').hidden = true;
    $('conserjeriaScanActivo').hidden = false;
    state.qrScanner = new Html5Qrcode('conserjeriaQrReader');
    state.qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
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

  function abrirFormulario(context, slug) {
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
    setMsg($('conserjeriaScanMsg'), '');
    showStep('form');
  }

  async function cargarAposentoEscaneado(slug) {
    const msg = $('conserjeriaScanMsg');
    const cached = $('conserjeriaSummaryDate').value === fechaCR()
      ? state.resumen.find((item) => item.aposento_slug === slug && Array.isArray(item.labores))
      : null;
    if (cached) {
      abrirFormulario({
        aposento_nombre: cached.aposento,
        aposento_tipo: cached.aposento_tipo,
        foto_requerida: cached.foto_requerida,
        labores: cached.labores
      }, slug);
      return;
    }
    setMsg(msg, 'Abriendo formulario…', 'success');
    try {
      const data = await callApi('context', { slug });
      abrirFormulario(data.context, slug);
    } catch (error) {
      setMsg(msg, error.message || 'No fue posible abrir el formulario.', 'error');
    }
  }

  function cargarImagen(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).then((bitmap) => ({
        source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close()
      }));
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No fue posible leer la fotografía.')); };
      img.src = url;
    });
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  async function comprimirFoto(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('Selecciona una imagen válida.');
    const imagen = await cargarImagen(file);
    try {
      const maxDimension = 1280;
      const scale = Math.min(1, maxDimension / Math.max(imagen.width, imagen.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(imagen.width * scale));
      canvas.height = Math.max(1, Math.round(imagen.height * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imagen.source, 0, 0, canvas.width, canvas.height);
      let blob = null;
      for (const quality of [0.78, 0.68, 0.58, 0.48]) {
        blob = await canvasBlob(canvas, quality);
        if (blob && blob.size <= 450 * 1024) break;
      }
      if (!blob || blob.size > 1024 * 1024) throw new Error('La fotografía no pudo comprimirse lo suficiente. Toma otra con menor resolución.');
      return blob;
    } finally {
      imagen.close();
    }
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
      showStep('exito');
      Promise.allSettled([cargarResumen({ silent: true }), cargarReportes({ silent: true })]);
      let seg = 3;
      $('conserjeriaCountdown').textContent = `Volviendo al escáner en ${seg}s…`;
      clearInterval(state.autoTimer);
      state.autoTimer = setInterval(() => {
        seg -= 1;
        if (seg <= 0) {
          clearInterval(state.autoTimer);
          showStep('scan');
          activarTab('scan');
        } else $('conserjeriaCountdown').textContent = `Volviendo al escáner en ${seg}s…`;
      }, 1000);
    } catch (error) {
      setMsg(msg, error.message || 'No se pudo enviar el reporte.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
  }

  restaurarSesion();
  $('conserjeriaSummaryDate').value = fechaCR();
  $('conserjeriaReportsDate').value = fechaCR();
  $('conserjeriaOpenBtn')?.addEventListener('click', abrirDialogo);
  $('conserjeriaCloseBtn')?.addEventListener('click', () => { detenerScanner(); $('conserjeriaDialog').close(); });
  $('conserjeriaDialog')?.addEventListener('cancel', () => detenerScanner());
  $('conserjeriaLoginForm')?.addEventListener('submit', login);
  $('conserjeriaLogoutBtn')?.addEventListener('click', cerrarSesionConserjeria);
  document.querySelectorAll('[data-conserjeria-tab]').forEach((button) => {
    button.addEventListener('click', () => activarTab(button.dataset.conserjeriaTab));
  });
  $('conserjeriaScanBtn')?.addEventListener('click', iniciarScanner);
  $('conserjeriaCancelScanBtn')?.addEventListener('click', () => {
    detenerScanner();
    $('conserjeriaScanActivo').hidden = true;
    $('conserjeriaScanIdle').hidden = false;
  });
  $('conserjeriaRefreshSummary')?.addEventListener('click', () => cargarResumen());
  $('conserjeriaSummaryDate')?.addEventListener('change', () => cargarResumen());
  $('conserjeriaSummaryRoom')?.addEventListener('change', renderResumen);
  $('conserjeriaRefreshReports')?.addEventListener('click', () => cargarReportes());
  $('conserjeriaReportsDate')?.addEventListener('change', () => cargarReportes());
  $('conserjeriaFoto')?.addEventListener('change', seleccionarFoto);
  $('conserjeriaFotoRemove')?.addEventListener('click', limpiarFoto);
  $('conserjeriaReporteForm')?.addEventListener('submit', enviarReporte);
  $('conserjeriaVolverScanBtn')?.addEventListener('click', () => { limpiarFoto(); showStep('scan'); activarTab('scan'); });
  $('conserjeriaSiguienteBtn')?.addEventListener('click', () => { clearInterval(state.autoTimer); showStep('scan'); activarTab('scan'); });

  if (window.CONSERJERIA_TEST_MODE) {
    window.__CONSERJERIA_TEST__ = { onScanSuccess, activarTab, cargarResumen, cargarReportes, state };
  }
})();
