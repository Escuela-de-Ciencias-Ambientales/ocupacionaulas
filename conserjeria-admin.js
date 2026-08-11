(() => {
  'use strict';

  // Panel administrativo de Conserjería: visible únicamente para el perfil con
  // role='admin' y admin_scope='conserjeria' (acceso activado con el mismo
  // inicio de sesión del sitio de reservas, sin contraseña adicional).

  const config = window.RESERVAS_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const state = { client: null, session: null, profile: null, reportes: [], loaded: false, chartDias: null, chartHenry: null, chartRocio: null };
  const isConserjeriaAdmin = () => state.profile?.role === 'admin' && state.profile?.admin_scope === 'conserjeria';
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function setMessage(text) {
    const el = $('conserjeriaAdminMessage');
    el.hidden = !text;
    el.textContent = text || '';
  }

  function setModule() {
    $('classroomPrivateModule').hidden = true;
    $('vehiclePrivateModule').hidden = true;
    $('conserjeriaAdminModule').hidden = false;
    $('showPrivateClassrooms').setAttribute('aria-selected', 'false');
    $('showPrivateVehicles').setAttribute('aria-selected', 'false');
    $('showConserjeriaAdmin').setAttribute('aria-selected', 'true');
    const url = new URL(window.location.href);
    url.searchParams.set('modulo', 'conserjeria');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (!state.loaded) loadReportes();
  }

  async function ensureClientAndProfile() {
    try {
      if (!window.RESERVAS_SUPABASE_CLIENT && !window.supabase?.createClient) return false;
      if (!state.client) state.client = window.RESERVAS_SUPABASE_CLIENT || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      window.RESERVAS_SUPABASE_CLIENT = state.client;
      const { data: { session } } = await state.client.auth.getSession();
      state.session = session;
      if (!session) return false;
      const { data: profile, error } = await state.client.from('profiles').select('id,role,admin_scope,full_name').eq('id', session.user.id).single();
      if (error) return false;
      state.profile = profile;
      return true;
    } catch (_err) {
      return false;
    }
  }

  async function initButtonVisibility() {
    const ok = await ensureClientAndProfile();
    $('showConserjeriaAdmin').hidden = !ok || !isConserjeriaAdmin();
    if (ok && isConserjeriaAdmin() && new URLSearchParams(window.location.search).get('modulo') === 'conserjeria') {
      setModule();
    }
  }

  async function loadReportes() {
    setMessage('');
    if (!isConserjeriaAdmin()) return;
    const { data, error } = await state.client.rpc('limpieza_admin_reportes');
    if (error) {
      setMessage('No fue posible cargar los reportes: ' + error.message);
      return;
    }
    state.reportes = data || [];
    state.loaded = true;
    render();
  }

  function formatFecha(value) {
    return new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }

  function porConserje(nombreParcial) {
    return state.reportes.filter((r) => (r.conserje || '').toLowerCase().includes(nombreParcial));
  }

  function renderLista(elementId, reportes) {
    const el = $(elementId);
    if (!reportes.length) { el.innerHTML = '<div class="conserjeria-empty">Sin reportes todavía.</div>'; return; }
    el.innerHTML = reportes.slice(0, 200).map((r) => `
      <div class="conserjeria-report-item">
        <div class="fecha">${escapeHtml(formatFecha(r.fecha))}</div>
        <div class="aposento">${escapeHtml(r.aposento)} <span style="font-weight:400;color:#5D6B7A;">· ${escapeHtml(r.aposento_tipo || '')}</span></div>
        <div class="observaciones${r.observaciones ? '' : ' is-empty'}">${escapeHtml(r.observaciones || 'Sin observaciones')}</div>
      </div>
    `).join('');
  }

  function renderChartPorDia(reportes, canvasId, refKey) {
    const dias = [];
    for (let i = 13; i >= 0; i -= 1) { const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0); dias.push(d); }
    const conteo = dias.map((d) => {
      const next = new Date(d); next.setDate(next.getDate() + 1);
      return reportes.filter((r) => { const f = new Date(r.fecha); return f >= d && f < next; }).length;
    });
    const labels = dias.map((d) => d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit' }));
    if (state[refKey]) state[refKey].destroy();
    state[refKey] = new Chart($(canvasId), {
      type: 'bar',
      data: { labels, datasets: [{ data: conteo, backgroundColor: '#007A53', borderRadius: 5 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function render() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const semana = new Date(); semana.setDate(semana.getDate() - 7);
    $('conserjeriaKpiTotal').textContent = state.reportes.length;
    $('conserjeriaKpiHoy').textContent = state.reportes.filter((r) => new Date(r.fecha) >= hoy).length;
    $('conserjeriaKpiSemana').textContent = state.reportes.filter((r) => new Date(r.fecha) >= semana).length;

    const henry = porConserje('henry');
    const rocio = porConserje('rocío').length ? porConserje('rocío') : porConserje('rocio');

    $('conserjeriaCountHenry').textContent = `${henry.length} reporte${henry.length === 1 ? '' : 's'}`;
    $('conserjeriaCountRocio').textContent = `${rocio.length} reporte${rocio.length === 1 ? '' : 's'}`;
    renderLista('conserjeriaListHenry', henry);
    renderLista('conserjeriaListRocio', rocio);

    renderChartPorDia(state.reportes, 'conserjeriaChartDias', 'chartDias');
    renderChartPorDia(henry, 'conserjeriaChartHenry', 'chartHenry');
    renderChartPorDia(rocio, 'conserjeriaChartRocio', 'chartRocio');
  }

  function exportarExcel() {
    if (!state.reportes.length) { setMessage('No hay reportes para exportar.'); return; }
    const filas = [...state.reportes]
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
      .map((r) => ({
        Fecha: new Date(r.fecha).toLocaleDateString('es-CR'),
        Hora: new Date(r.fecha).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' }),
        Conserje: r.conserje,
        Aposento: r.aposento,
        'Tipo de aposento': r.aposento_tipo,
        Observaciones: r.observaciones || ''
      }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reportes de limpieza');
    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `reportes_conserjeria_${fecha}.xlsx`);
  }

  $('showConserjeriaAdmin')?.addEventListener('click', setModule);
  $('refreshConserjeriaAdmin')?.addEventListener('click', loadReportes);
  $('exportConserjeriaExcel')?.addEventListener('click', exportarExcel);

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(initButtonVisibility, 400);
  });
  if (document.readyState !== 'loading') window.setTimeout(initButtonVisibility, 400);
})();
