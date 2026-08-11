(() => {
  'use strict';

  // Reporte de limpieza de conserjería: contraseña -> escanear QR -> formulario -> enviar.
  // La sesión del conserje vive únicamente en memoria del navegador (no se guarda en disco)
  // y se mantiene mientras el diálogo permanezca abierto, sin pedir la contraseña de nuevo
  // entre un aposento y otro.

  const config = window.RESERVAS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const iconos = { aula: '🏫', oficina: '🗄️', bano: '🚻', otro: '📍' };

  const state = {
    client: null,
    conserjePassword: null,
    conserjeNombre: null,
    aposentoActual: null,
    qrScanner: null
  };

  function getClient() {
    if (!state.client) {
      if (!window.RESERVAS_PUBLIC_SUPABASE_CLIENT && (!window.supabase?.createClient || !config.supabaseUrl || !config.supabaseAnonKey)) return null;
      state.client = window.RESERVAS_PUBLIC_SUPABASE_CLIENT
        || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
      window.RESERVAS_PUBLIC_SUPABASE_CLIENT = state.client;
    }
    return state.client;
  }

  function showStep(step) {
    document.querySelectorAll('#conserjeriaDialog .conserjeria-step').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.step === step);
    });
  }

  function setMsg(el, text, kind) {
    el.className = 'conserjeria-msg' + (kind ? ` is-${kind}` : '');
    el.textContent = text || '';
  }

  function fechaHoraActual() {
    return new Intl.DateTimeFormat('es-CR', {
      dateStyle: 'full', timeStyle: 'short'
    }).format(new Date());
  }

  function abrirDialogo() {
    $('conserjeriaDialog').showModal();
    if (state.conserjePassword) {
      $('conserjeriaSessionName').textContent = state.conserjeNombre;
      showStep('scan');
    } else {
      showStep('login');
      window.setTimeout(() => $('conserjeriaPassword')?.focus(), 60);
    }
  }

  function cerrarSesionConserjeria() {
    detenerScanner();
    state.conserjePassword = null;
    state.conserjeNombre = null;
    state.aposentoActual = null;
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
    const client = getClient();
    if (!client) { setMsg(msg, 'La conexión todavía no está lista. Intenta de nuevo en unos segundos.', 'error'); return; }
    const btn = $('conserjeriaLoginBtn');
    btn.disabled = true; btn.textContent = 'Verificando…';
    const { data, error } = await client.rpc('limpieza_login_conserje', { p_password: pw });
    btn.disabled = false; btn.textContent = 'Entrar';
    if (error) {
      setMsg(msg, 'No fue posible verificar la contraseña. Revisa la conexión e intenta de nuevo.', 'error');
      return;
    }
    if (!data || data.length === 0) {
      setMsg(msg, 'Contraseña incorrecta.', 'error');
      return;
    }
    state.conserjePassword = pw;
    state.conserjeNombre = data[0].nombre;
    $('conserjeriaPassword').value = '';
    $('conserjeriaSessionName').textContent = state.conserjeNombre;
    showStep('scan');
  }

  function iniciarScanner() {
    setMsg($('conserjeriaScanMsg'), '');
    if (!window.Html5Qrcode) {
      setMsg($('conserjeriaScanMsg'), 'El lector QR no está disponible. Usa el ingreso manual.', 'error');
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
      $('conserjeriaScanActivo').hidden = true;
      $('conserjeriaScanIdle').hidden = false;
      setMsg($('conserjeriaScanMsg'), 'No se pudo acceder a la cámara. Verifica los permisos o usa el ingreso manual.', 'error');
    });
  }

  function detenerScanner() {
    if (state.qrScanner) {
      state.qrScanner.stop().then(() => state.qrScanner.clear()).catch(() => {});
      state.qrScanner = null;
    }
  }

  function onScanSuccess(decodedText) {
    detenerScanner();
    $('conserjeriaScanActivo').hidden = true;
    $('conserjeriaScanIdle').hidden = false;
    let slug = decodedText.trim();
    try {
      const url = new URL(decodedText);
      const p = url.searchParams.get('aposento');
      if (p) slug = p;
    } catch (_e) { /* el texto no era una URL, se usa tal cual */ }
    cargarAposento(slug);
  }

  async function cargarAposento(slug) {
    setMsg($('conserjeriaScanMsg'), '');
    const { data, error } = await getClient().rpc('limpieza_get_aposento', { p_slug: slug });
    if (error || !data || data.length === 0) {
      setMsg($('conserjeriaScanMsg'), 'Aposento no reconocido. Escanea de nuevo o verifica el código.', 'error');
      return;
    }
    state.aposentoActual = { ...data[0], slug };
    $('conserjeriaAposentoLabel').textContent = state.aposentoActual.nombre;
    $('conserjeriaFechaHora').value = fechaHoraActual();
    $('conserjeriaFuncionario').value = state.conserjeNombre;
    $('conserjeriaAposento').value = state.aposentoActual.nombre;
    $('conserjeriaAposentoIcono').textContent = iconos[state.aposentoActual.tipo] || iconos.otro;
    $('conserjeriaObservaciones').value = '';
    showStep('form');
  }

  async function enviarReporte(event) {
    event.preventDefault();
    const btn = $('conserjeriaEnviarBtn');
    const msg = $('conserjeriaFormMsg');
    setMsg(msg, '');
    btn.disabled = true; btn.textContent = 'Enviando…';
    const { data, error } = await getClient().rpc('limpieza_crear_reporte', {
      p_aposento_slug: state.aposentoActual.slug,
      p_conserje_password: state.conserjePassword,
      p_estado: null,
      p_checklist: '[]',
      p_observaciones: $('conserjeriaObservaciones').value.trim() || null
    });
    btn.disabled = false; btn.textContent = 'Enviar';
    if (error) {
      setMsg(msg, 'Ocurrió un error de conexión. Intenta de nuevo.', 'error');
      return;
    }
    const resultado = data && data[0];
    if (!resultado || !resultado.ok) {
      setMsg(msg, (resultado && resultado.mensaje) || 'No se pudo enviar el reporte. Si tu contraseña cambió, cierra sesión y vuelve a entrar.', 'error');
      return;
    }
    $('conserjeriaExitoTexto').textContent = `${state.aposentoActual.nombre} — gracias ${resultado.conserje_nombre}.`;
    showStep('exito');
    let seg = 4;
    $('conserjeriaCountdown').textContent = `Volviendo al escáner en ${seg}s…`;
    clearInterval(state.autoTimer);
    state.autoTimer = setInterval(() => {
      seg -= 1;
      if (seg <= 0) { clearInterval(state.autoTimer); showStep('scan'); }
      else $('conserjeriaCountdown').textContent = `Volviendo al escáner en ${seg}s…`;
    }, 1000);
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
  $('conserjeriaManualToggle')?.addEventListener('click', () => {
    $('conserjeriaManualBox').hidden = !$('conserjeriaManualBox').hidden;
  });
  $('conserjeriaManualBtn')?.addEventListener('click', () => {
    const slug = $('conserjeriaManualSlug').value.trim();
    if (slug) cargarAposento(slug);
  });
  $('conserjeriaReporteForm')?.addEventListener('submit', enviarReporte);
  $('conserjeriaVolverScanBtn')?.addEventListener('click', () => showStep('scan'));
  $('conserjeriaSiguienteBtn')?.addEventListener('click', () => { clearInterval(state.autoTimer); showStep('scan'); });
})();
