(() => {
  'use strict';

  const config = window.RESERVAS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const state = {
    client: null, session: null, profile: null, reportes: [], control: [],
    programacion: [], catalogos: [], loaded: false,
    chartDias: null, chartHenry: null, chartRocio: null
  };

  const isConserjeriaAdmin = () => state.profile?.role === 'admin'
    && ['conserjeria', 'operations', 'superadmin'].includes(state.profile?.admin_scope);
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function fechaCostaRica(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

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
    if (!state.loaded) loadPanel();
  }

  async function ensureClientAndProfile() {
    try {
      if (!window.RESERVAS_SUPABASE_CLIENT && !window.supabase?.createClient) return false;
      if (!state.client) state.client = window.RESERVAS_SUPABASE_CLIENT
        || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      window.RESERVAS_SUPABASE_CLIENT = state.client;
      const { data: { session } } = await state.client.auth.getSession();
      state.session = session;
      if (!session) return false;
      const { data: profile, error } = await state.client.from('profiles')
        .select('id,role,admin_scope,full_name').eq('id', session.user.id).single();
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
    if (ok && isConserjeriaAdmin() && new URLSearchParams(window.location.search).get('modulo') === 'conserjeria') setModule();
  }

  async function rpc(nombre, parametros) {
    const { data, error } = await state.client.rpc(nombre, parametros);
    if (error) throw error;
    return data || [];
  }

  async function loadPanel() {
    setMessage('');
    if (!isConserjeriaAdmin()) return;
    try {
      const fecha = $('conserjeriaControlFecha').value || fechaCostaRica();
      $('conserjeriaControlFecha').value = fecha;
      $('conserjeriaScheduleDesde').value ||= fecha;
      [state.reportes, state.catalogos, state.programacion, state.control] = await Promise.all([
        rpc('limpieza_admin_reportes'), rpc('limpieza_admin_catalogos'),
        rpc('limpieza_admin_programacion'), rpc('limpieza_admin_control_diario', { p_fecha: fecha })
      ]);
      state.loaded = true;
      render();
      renderCatalogos();
      renderControl();
      renderProgramacion();
    } catch (error) {
      setMessage(`No fue posible cargar el panel: ${error.message}`);
    }
  }

  async function loadControl() {
    setMessage('');
    try {
      state.control = await rpc('limpieza_admin_control_diario', { p_fecha: $('conserjeriaControlFecha').value });
      renderControl();
    } catch (error) {
      setMessage(`No fue posible cargar el control diario: ${error.message}`);
    }
  }

  function formatFecha(value) {
    return new Intl.DateTimeFormat('es-CR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Costa_Rica'
    }).format(new Date(value));
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
      </div>`).join('');
  }

  function renderChartPorDia(reportes, canvasId, refKey) {
    if (typeof window.Chart !== 'function') return;
    const dias = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0); dias.push(d);
    }
    const conteo = dias.map((d) => {
      const next = new Date(d); next.setDate(next.getDate() + 1);
      return reportes.filter((r) => { const f = new Date(r.fecha); return f >= d && f < next; }).length;
    });
    const labels = dias.map((d) => d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit' }));
    if (state[refKey]) state[refKey].destroy();
    state[refKey] = new Chart($(canvasId), {
      type: 'bar', data: { labels, datasets: [{ data: conteo, backgroundColor: '#007A53', borderRadius: 5 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function render() {
    const hoyCr = fechaCostaRica();
    const semana = new Date(); semana.setDate(semana.getDate() - 7);
    $('conserjeriaKpiTotal').textContent = state.reportes.length;
    $('conserjeriaKpiHoy').textContent = state.reportes.filter((r) => fechaCostaRica(new Date(r.fecha)) === hoyCr).length;
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

  function horaCorta(value) {
    return value ? String(value).slice(0, 5) : '';
  }

  function renderControl() {
    const conserjes = state.catalogos.filter((item) => item.tipo === 'conserje');
    const resumen = $('conserjeriaControlResumen');
    const notice = $('conserjeriaControlNotice');
    const hayProgramacion = state.control.some((item) => item.programado);
    notice.hidden = hayProgramacion;
    notice.textContent = 'Aún no hay asignaciones vigentes para esta fecha. Los reportes se muestran normalmente; los faltantes aparecerán cuando la jefatura cargue la programación.';

    resumen.innerHTML = conserjes.map((conserje) => {
      const filas = state.control.filter((item) => item.conserje_id === conserje.id);
      const reportados = filas.filter((item) => item.reportado);
      const faltantes = filas.filter((item) => item.programado && !item.reportado);
      const total = reportados.reduce((sum, item) => sum + Number(item.cantidad_reportes || 0), 0);
      const chipsReportados = reportados.length ? reportados.map((item) => {
        const extra = !item.programado ? ' is-extra' : '';
        const rango = item.primera_hora === item.ultima_hora
          ? horaCorta(item.primera_hora)
          : `${horaCorta(item.primera_hora)}–${horaCorta(item.ultima_hora)}`;
        return `<span class="conserjeria-room-chip${extra}">${escapeHtml(item.aposento)} <small>${escapeHtml(rango)}${Number(item.cantidad_reportes) > 1 ? ` · ${item.cantidad_reportes} reportes` : ''}</small></span>`;
      }).join('') : '<span class="conserjeria-empty">Sin reportes en esta fecha.</span>';
      const chipsFaltantes = faltantes.length
        ? faltantes.map((item) => `<span class="conserjeria-room-chip is-missing">⚠ ${escapeHtml(item.aposento)}</span>`).join('')
        : '<span class="conserjeria-room-chip">✓ Ningún faltante</span>';
      return `<article class="conserjeria-daily-card">
        <header><h4>${escapeHtml(conserje.nombre)}</h4><span class="conserjeria-daily-total">${total} reporte${total === 1 ? '' : 's'}</span></header>
        <div class="conserjeria-room-group"><strong>Aposentos reportados</strong><div class="conserjeria-room-list">${chipsReportados}</div></div>
        ${hayProgramacion ? `<div class="conserjeria-room-group"><strong>Faltantes programados</strong><div class="conserjeria-room-list">${chipsFaltantes}</div></div>` : ''}
      </article>`;
    }).join('');
  }

  function renderCatalogos() {
    const fill = (id, tipo) => {
      $(id).innerHTML = state.catalogos.filter((item) => item.tipo === tipo)
        .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nombre)}</option>`).join('');
    };
    fill('conserjeriaScheduleConserje', 'conserje');
    fill('conserjeriaScheduleAposento', 'aposento');
  }

  function renderProgramacion() {
    const el = $('conserjeriaScheduleList');
    if (!state.programacion.length) {
      el.innerHTML = '<div class="conserjeria-empty">El horario aún no está definido. Puede comenzar a cargarlo cuando esté listo.</div>';
      return;
    }
    el.innerHTML = state.programacion.map((item) => `
      <div class="conserjeria-schedule-row">
        <strong>${escapeHtml(item.conserje)}</strong><span>${escapeHtml(item.aposento)}</span>
        <span>${DIAS[Number(item.dia_semana)]}</span>
        <span>${escapeHtml(item.vigente_desde)} → ${escapeHtml(item.vigente_hasta || 'sin fecha final')}</span>
        <button type="button" data-schedule-delete="${escapeHtml(item.id)}">Cerrar</button>
      </div>`).join('');
  }

  async function guardarProgramacion(event) {
    event.preventDefault();
    setMessage('');
    const desde = $('conserjeriaScheduleDesde').value;
    const hasta = $('conserjeriaScheduleHasta').value || null;
    if (hasta && hasta < desde) { setMessage('La fecha final no puede ser anterior a la fecha inicial.'); return; }
    try {
      await rpc('limpieza_admin_guardar_programacion', {
        p_conserje_id: $('conserjeriaScheduleConserje').value,
        p_aposento_id: $('conserjeriaScheduleAposento').value,
        p_dia_semana: Number($('conserjeriaScheduleDia').value),
        p_vigente_desde: desde, p_vigente_hasta: hasta
      });
      state.programacion = await rpc('limpieza_admin_programacion');
      renderProgramacion();
      await loadControl();
    } catch (error) {
      setMessage(`No fue posible guardar la asignación: ${error.message}`);
    }
  }

  async function cerrarProgramacion(id) {
    if (!window.confirm('¿Desea cerrar esta asignación? Se conservará el historial para los controles anteriores.')) return;
    setMessage('');
    try {
      await rpc('limpieza_admin_eliminar_programacion', { p_id: id });
      state.programacion = await rpc('limpieza_admin_programacion');
      renderProgramacion();
      await loadControl();
    } catch (error) {
      setMessage(`No fue posible cerrar la asignación: ${error.message}`);
    }
  }

  function exportarExcel() {
    if (!state.reportes.length) { setMessage('No hay reportes para exportar.'); return; }
    const filas = [...state.reportes].sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).map((r) => ({
      Fecha: new Date(r.fecha).toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica' }),
      Hora: new Date(r.fecha).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Costa_Rica' }),
      Conserje: r.conserje, Aposento: r.aposento, 'Tipo de aposento': r.aposento_tipo, Observaciones: r.observaciones || ''
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reportes de limpieza');
    XLSX.writeFile(wb, `reportes_conserjeria_${fechaCostaRica()}.xlsx`);
  }

  $('showConserjeriaAdmin')?.addEventListener('click', setModule);
  $('refreshConserjeriaAdmin')?.addEventListener('click', loadPanel);
  $('exportConserjeriaExcel')?.addEventListener('click', exportarExcel);
  $('conserjeriaControlFecha')?.addEventListener('change', loadControl);
  $('conserjeriaScheduleForm')?.addEventListener('submit', guardarProgramacion);
  $('conserjeriaScheduleList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-schedule-delete]');
    if (button) cerrarProgramacion(button.dataset.scheduleDelete);
  });

  document.addEventListener('DOMContentLoaded', () => window.setTimeout(initButtonVisibility, 400));
  if (document.readyState !== 'loading') window.setTimeout(initButtonVisibility, 400);
})();
