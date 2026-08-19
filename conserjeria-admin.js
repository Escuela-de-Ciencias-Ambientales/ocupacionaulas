(() => {
  'use strict';
  const config = window.RESERVAS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const DIAS = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' };
  const state = { client: null, session: null, profile: null, catalogos: [], programacion: [], rutinaLabores: [], control: [], weekly: [], weeklyDay: null, reportes: [], chartReportes: [], conserjeId: null, loaded: false, chart: null };
  const isAdmin = () => state.profile?.role === 'admin' && ['conserjeria', 'operations', 'superadmin'].includes(state.profile?.admin_scope);
  const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const catalogo = (tipo) => state.catalogos.filter((item) => item.tipo === tipo && item.extra?.activo !== false);
  const hoyCr = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const hora = (value) => value ? String(value).slice(0, 5) : '—';
  const fechaHora = (value) => value ? new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(value)) : '—';
  const soloHora = (value) => value ? new Intl.DateTimeFormat('es-CR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Costa_Rica' }).format(new Date(value)) : '—';
  const fechaCorta = (value) => new Intl.DateTimeFormat('es-CR', { day: '2-digit', month: '2-digit', timeZone: 'America/Costa_Rica' }).format(new Date(`${value}T12:00:00`));
  const nombreDia = (value, format = 'long') => new Intl.DateTimeFormat('es-CR', { weekday: format, timeZone: 'America/Costa_Rica' }).format(new Date(`${value}T12:00:00`));
  const duracion = (seconds) => { const total = Number(seconds); if (!Number.isFinite(total)) return 'Sin medición'; const minutes = Math.floor(total / 60); return minutes ? `${minutes} min ${total % 60} s` : `${total} s`; };

  function setMessage(text, kind = 'error') {
    const el = $('conserjeriaAdminMessage'); el.hidden = !text; el.className = `conserjeria-admin-message is-${kind}`; el.textContent = text || '';
  }
  function setModule() {
    $('classroomPrivateModule').hidden = true; $('vehiclePrivateModule').hidden = true; $('conserjeriaAdminModule').hidden = false;
    $('showPrivateClassrooms').setAttribute('aria-selected', 'false'); $('showPrivateVehicles').setAttribute('aria-selected', 'false'); $('showConserjeriaAdmin').setAttribute('aria-selected', 'true');
    if ($('modulePageTitle')) $('modulePageTitle').textContent = 'Control de conserjería'; document.title = 'Control de conserjería | EDECA';
    const url = new URL(window.location.href); url.searchParams.set('modulo', 'conserjeria'); window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (!state.loaded) loadPanel();
  }
  async function ensureClientAndProfile() {
    try {
      if (!window.RESERVAS_SUPABASE_CLIENT && !window.supabase?.createClient) return false;
      if (!state.client) state.client = window.RESERVAS_SUPABASE_CLIENT || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      window.RESERVAS_SUPABASE_CLIENT = state.client;
      const { data: { session } } = await state.client.auth.getSession(); state.session = session; if (!session) return false;
      const { data: profile, error } = await state.client.from('profiles').select('id,role,admin_scope,full_name').eq('id', session.user.id).single(); if (error) return false;
      state.profile = profile; return true;
    } catch (_error) { return false; }
  }
  async function initButtonVisibility() { const ok = await ensureClientAndProfile(); $('showConserjeriaAdmin').hidden = !ok || !isAdmin(); if (ok && isAdmin() && new URLSearchParams(location.search).get('modulo') === 'conserjeria') setModule(); }
  async function rpc(name, params) { const { data, error } = await state.client.rpc(name, params); if (error) throw error; return data || []; }
  function fillSelect(id, items, label = (item) => item.nombre) { const select = $(id); const previous = select.value; select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(label(item))}</option>`).join(''); if ([...select.options].some((option) => option.value === previous)) select.value = previous; }

  function renderRutinasAsignacion() { const roomId = $('conserjeriaScheduleAposento').value; fillSelect('conserjeriaScheduleRutina', catalogo('rutina').filter((item) => item.extra?.aposento_id === roomId)); }
  function renderScheduleFilters() {
    const conserjes = catalogo('conserje'); const conserje = $('conserjeriaScheduleFilterConserje'); const selectedConserje = conserje.value;
    conserje.innerHTML = '<option value="">Todos</option>' + conserjes.map((item) => `<option value="${item.id}">${escapeHtml(item.nombre)}</option>`).join('');
    if ([...conserje.options].some((option) => option.value === selectedConserje)) conserje.value = selectedConserje;
    const horarios = [...new Set(state.programacion.map((item) => `${hora(item.hora_inicio)}|${hora(item.hora_fin)}`))].sort();
    const horario = $('conserjeriaScheduleFilterHorario'); const selectedHorario = horario.value;
    horario.innerHTML = '<option value="">Todos</option>' + horarios.map((value) => { const [inicio, fin] = value.split('|'); return `<option value="${value}">${inicio}–${fin}</option>`; }).join('');
    if ([...horario.options].some((option) => option.value === selectedHorario)) horario.value = selectedHorario;
  }
  function renderAdminTabs() {
    const conserjes = catalogo('conserje'); if (!state.conserjeId || !conserjes.some((item) => item.id === state.conserjeId)) state.conserjeId = conserjes[0]?.id || null;
    $('conserjeriaAdminTabs').innerHTML = conserjes.map((item) => `<button type="button" class="${item.id === state.conserjeId ? 'is-active' : ''}" data-conserje-id="${escapeHtml(item.id)}">${escapeHtml(item.nombre)}</button>`).join('');
  }
  function renderControlRecintos() {
    const fecha = $('conserjeriaControlFecha').value || hoyCr();
    const asignados = new Set(state.programacion.filter((item) => item.conserje_id === state.conserjeId && item.vigente_desde <= fecha && (!item.vigente_hasta || item.vigente_hasta >= fecha)).map((item) => item.aposento_id));
    const aposentos = catalogo('aposento').filter((item) => asignados.has(item.id));
    const filter = $('conserjeriaControlRecinto'); const selected = filter.value;
    filter.innerHTML = '<option value="">Todos</option>' + aposentos.map((item) => `<option value="${item.id}">${escapeHtml(item.nombre)}</option>`).join('');
    filter.value = [...filter.options].some((option) => option.value === selected) ? selected : '';
  }
  function renderCatalogos() {
    const conserjes = catalogo('conserje'); const aposentos = catalogo('aposento');
    fillSelect('conserjeriaScheduleConserje', conserjes); fillSelect('conserjeriaScheduleAposento', aposentos);
    renderRutinasAsignacion(); fillSelect('conserjeriaLaborRutina', catalogo('rutina'), (item) => `${aposentos.find((a) => a.id === item.extra?.aposento_id)?.nombre || ''} · ${item.nombre}`); renderAdminTabs(); renderControlRecintos(); renderScheduleFilters(); renderLaborList();
  }
  async function loadPanel() {
    if (!isAdmin()) return; setMessage('');
    try {
      $('conserjeriaControlFecha').value ||= hoyCr(); $('conserjeriaScheduleDesde').value ||= hoyCr();
      [state.catalogos, state.programacion, state.rutinaLabores] = await Promise.all([rpc('limpieza_admin_catalogos_v4'), rpc('limpieza_admin_programacion_v4'), rpc('limpieza_admin_rutina_labores_v4')]);
      state.loaded = true; renderCatalogos(); renderProgramacion(); await loadDashboard();
    } catch (error) { setMessage(`No fue posible cargar el panel: ${error.message}`); }
  }
  function restarDias(fecha, cantidad) { const d = new Date(`${fecha}T12:00:00`); d.setDate(d.getDate() - cantidad); return hoyCr(d); }
  async function loadDashboard() {
    if (!state.conserjeId) return; setMessage(''); renderControlRecintos(); const fecha = $('conserjeriaControlFecha').value || hoyCr(); const aposentoId = $('conserjeriaControlRecinto').value || null;
    try {
      [state.control, state.weekly, state.reportes, state.chartReportes] = await Promise.all([
        rpc('limpieza_admin_control_diario_v4', { p_fecha: fecha, p_conserje_id: state.conserjeId }),
        rpc('limpieza_admin_control_semanal_v5', { p_fecha_semana: fecha, p_conserje_id: state.conserjeId }),
        rpc('limpieza_admin_reportes_v4', { p_desde: fecha, p_hasta: fecha, p_conserje_id: state.conserjeId, p_aposento_id: aposentoId }),
        rpc('limpieza_admin_reportes_v4', { p_desde: restarDias(fecha, 20), p_hasta: fecha, p_conserje_id: state.conserjeId, p_aposento_id: aposentoId })
      ]); renderDashboard(aposentoId);
    } catch (error) { setMessage(`No fue posible actualizar el control: ${error.message}`); }
  }
  function renderDashboard(aposentoId) {
    renderAdminTabs(); const control = state.control.filter((item) => !aposentoId || item.aposento_id === aposentoId); const completed = control.filter((item) => item.reportado); const times = state.reportes.map((item) => Number(item.duracion_segundos)).filter(Number.isFinite);
    $('conserjeriaKpiProgramadas').textContent = control.length; $('conserjeriaKpiCompletadas').textContent = completed.length; $('conserjeriaKpiPendientes').textContent = control.length - completed.length; $('conserjeriaKpiTiempo').textContent = times.length ? duracion(Math.round(times.reduce((a, b) => a + b, 0) / times.length)) : '—';
    renderControl(control); renderWeekly(aposentoId); renderReportes(); renderChart(); const notice = $('conserjeriaControlNotice'); notice.hidden = control.length > 0; notice.textContent = 'No hay asignaciones vigentes para este conserje en la fecha y recinto seleccionados.';
  }
  const missingNames = (item) => (Array.isArray(item.labores_faltantes) ? item.labores_faltantes : []).map((labor) => labor.nombre).filter(Boolean);
  function renderControl(items) {
    const el = $('conserjeriaControlResumen'); if (!items.length) { el.innerHTML = '<p class="conserjeria-empty">Sin tareas programadas.</p>'; return; }
    el.innerHTML = items.map((item) => { const missing = missingNames(item); const report = state.reportes.find((row) => row.id === item.reporte_id); const status = !item.reportado ? 'pending' : missing.length ? 'incomplete' : 'complete'; const label = !item.reportado ? 'Pendiente' : missing.length ? 'Incompleto' : 'Realizado'; return `<article class="conserjeria-task-row is-${status}"><div class="conserjeria-task-time">${hora(item.hora_inicio)}<small>${hora(item.hora_fin)}</small></div><div><strong>${escapeHtml(item.aposento)}</strong><span>${escapeHtml(item.rutina || 'Rutina')}</span>${report ? `<span>Escaneó ${escapeHtml(soloHora(report.escaneado_at))} · Envió ${escapeHtml(soloHora(report.enviado_at || report.fecha))}</span>` : ''}${missing.length ? `<p><b>${item.reportado ? 'Faltó' : 'Debe realizar'}:</b> ${escapeHtml(missing.join(', '))}</p>` : ''}</div><div class="conserjeria-task-result"><b>${label}</b>${item.reportado ? `<small>${escapeHtml(duracion(item.duracion_segundos))}</small>` : ''}</div></article>`; }).join('');
  }
  function sumarDias(fecha, cantidad) { const d = new Date(`${fecha}T12:00:00`); d.setDate(d.getDate() + cantidad); return hoyCr(d); }
  function inicioSemana(fecha) { const d = new Date(`${fecha}T12:00:00`); const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); return hoyCr(d); }
  function renderWeekly(aposentoId) {
    const selectedDate = $('conserjeriaControlFecha').value || hoyCr(); const base = inicioSemana(selectedDate); const end = sumarDias(base, 4);
    if (!state.weeklyDay || state.weeklyDay < base || state.weeklyDay > end) {
      const selectedDow = new Date(`${selectedDate}T12:00:00`).getDay();
      state.weeklyDay = selectedDow >= 1 && selectedDow <= 5 ? selectedDate : base;
    }
    $('conserjeriaWeekLabel').textContent = `${fechaCorta(base)} – ${fechaCorta(end)}`;
    const rows = state.weekly.filter((item) => item.fecha >= base && item.fecha <= end && (!aposentoId || item.aposento_id === aposentoId));
    $('conserjeriaWeeklySummary').innerHTML = Array.from({ length: 5 }, (_, index) => {
      const date = sumarDias(base, index); const dayRows = rows.filter((item) => item.fecha === date); const pending = dayRows.filter((item) => !item.reportado);
      return `<button type="button" class="conserjeria-week-day ${pending.length ? 'is-pending' : ''} ${state.weeklyDay === date ? 'is-active' : ''}" data-week-date="${date}" aria-pressed="${state.weeklyDay === date}"><strong>${escapeHtml(nombreDia(date))}</strong><span>${escapeHtml(fechaCorta(date))}</span><b>${dayRows.length - pending.length}/${dayRows.length}</b><span>completadas · ${pending.length} pendientes</span></button>`;
    }).join('');
    const dayRows = rows.filter((item) => item.fecha === state.weeklyDay); const list = $('conserjeriaWeeklyList');
    if (!dayRows.length) { list.innerHTML = '<p class="conserjeria-empty">No hay turnos programados para este día.</p>'; return; }
    list.innerHTML = dayRows.map((item) => {
      const missing = missingNames(item); let status = 'pending'; let label = 'Pendiente';
      if (item.reportado && missing.length) { status = 'incomplete'; label = item.dentro_horario ? 'Incompleto · En horario' : 'Incompleto · Fuera de horario'; }
      else if (item.reportado && item.dentro_horario) { status = 'on-time'; label = 'Realizado'; }
      else if (item.reportado) { status = 'late'; label = 'Realizado'; }
      return `<article class="conserjeria-week-row is-${status}"><div><b>${hora(item.hora_inicio)}</b><span>${hora(item.hora_fin)}</span></div><div><strong>${escapeHtml(item.aposento)}</strong><small>${escapeHtml(item.rutina || 'Rutina')}</small></div><div><small>Escaneó</small><b>${escapeHtml(soloHora(item.escaneado_at))}</b></div><div><small>Envió</small><b>${escapeHtml(soloHora(item.enviado_at))}</b></div><b class="is-status">${escapeHtml(label)}</b></article>`;
    }).join('');
  }
  function renderReportes() {
    const el = $('conserjeriaReportesFiltrados'); if (!state.reportes.length) { el.innerHTML = '<p class="conserjeria-empty">No hay reportes enviados con estos filtros.</p>'; return; }
    el.innerHTML = state.reportes.map((item) => { const list = Array.isArray(item.checklist) ? item.checklist : []; const done = list.filter((x) => x.completada).map((x) => x.nombre); const missing = list.filter((x) => !x.completada).map((x) => x.nombre); return `<article class="conserjeria-admin-report"><header><div><strong>${escapeHtml(item.aposento)}</strong><span>${escapeHtml(item.rutina || 'Rutina')}</span></div><time>${escapeHtml(fechaHora(item.enviado_at || item.fecha))}</time></header><dl><div><dt>Escaneó</dt><dd>${escapeHtml(fechaHora(item.escaneado_at))}</dd></div><div><dt>Envió</dt><dd>${escapeHtml(fechaHora(item.enviado_at || item.fecha))}</dd></div><div><dt>Duración</dt><dd>${escapeHtml(duracion(item.duracion_segundos))}</dd></div></dl><p><b>Realizadas:</b> ${escapeHtml(done.join(', ') || 'Ninguna marcada')}</p>${missing.length ? `<p class="is-missing"><b>No realizadas:</b> ${escapeHtml(missing.join(', '))}</p>` : ''}${item.observaciones ? `<p><b>Observaciones:</b> ${escapeHtml(item.observaciones)}</p>` : ''}${item.foto_path ? `<button type="button" class="secondary-button compact-button" data-photo-path="${escapeHtml(item.foto_path)}">Ver fotografía</button>` : ''}</article>`; }).join('');
  }
  function renderChart() {
    if (typeof window.Chart !== 'function') return; const end = $('conserjeriaControlFecha').value || hoyCr(); const dates = [];
    for (let offset = 0; dates.length < 10; offset += 1) { const date = restarDias(end, offset); const day = new Date(`${date}T12:00:00`).getDay(); if (day >= 1 && day <= 5) dates.unshift(date); }
    const counts = dates.map((date) => state.chartReportes.filter((item) => hoyCr(new Date(item.enviado_at || item.fecha)) === date).length);
    if (state.chart) state.chart.destroy(); state.chart = new Chart($('conserjeriaChartActivo'), { type: 'bar', data: { labels: dates.map((d) => d.slice(5).split('-').reverse().join('/')), datasets: [{ data: counts, backgroundColor: '#087a55', borderRadius: 5 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  }
  function renderProgramacion() {
    const conserjeId = $('conserjeriaScheduleFilterConserje').value; const dia = $('conserjeriaScheduleFilterDia').value; const horario = $('conserjeriaScheduleFilterHorario').value;
    const rows = state.programacion.filter((item) => DIAS[Number(item.dia_semana)] && (!conserjeId || item.conserje_id === conserjeId) && (dia === '' || Number(item.dia_semana) === Number(dia)) && (!horario || `${hora(item.hora_inicio)}|${hora(item.hora_fin)}` === horario));
    $('conserjeriaScheduleCount').textContent = `${rows.length} de ${state.programacion.length} asignaciones`;
    const el = $('conserjeriaScheduleList'); if (!rows.length) { el.innerHTML = '<p class="conserjeria-empty">No hay asignaciones con estos filtros.</p>'; return; }
    el.innerHTML = rows.map((item) => `<article class="conserjeria-schedule-row"><div><strong>${escapeHtml(item.conserje)}</strong><span>${escapeHtml(item.aposento)} · ${escapeHtml(item.rutina || 'Sin rutina')}</span></div><span>${DIAS[Number(item.dia_semana)]}</span><span>${hora(item.hora_inicio)}–${hora(item.hora_fin)}</span><span>${escapeHtml(item.vigente_desde)} → ${escapeHtml(item.vigente_hasta || 'sin final')}</span><span>${item.foto_requerida ? 'Foto requerida' : 'Foto opcional'}</span><div><button type="button" data-schedule-edit="${item.id}">Editar</button><button type="button" class="is-danger" data-schedule-close="${item.id}">Cerrar</button></div></article>`).join('');
  }
  function resetScheduleForm() { $('conserjeriaScheduleId').value = ''; $('conserjeriaScheduleForm').reset(); $('conserjeriaScheduleDesde').value = hoyCr(); $('conserjeriaScheduleCancel').hidden = true; renderRutinasAsignacion(); }
  function editSchedule(id) {
    const item = state.programacion.find((row) => row.id === id); if (!item) return; $('conserjeriaScheduleId').value = item.id; $('conserjeriaScheduleConserje').value = item.conserje_id; $('conserjeriaScheduleAposento').value = item.aposento_id; renderRutinasAsignacion(); $('conserjeriaScheduleRutina').value = item.rutina_id; $('conserjeriaScheduleHoraInicio').value = hora(item.hora_inicio); $('conserjeriaScheduleHoraFin').value = hora(item.hora_fin); $('conserjeriaScheduleDesde').value = item.vigente_desde; $('conserjeriaScheduleHasta').value = item.vigente_hasta || ''; $('conserjeriaScheduleFoto').checked = Boolean(item.foto_requerida); document.querySelectorAll('input[name="conserjeriaDia"]').forEach((input) => { input.checked = Number(input.value) === Number(item.dia_semana); }); $('conserjeriaScheduleCancel').hidden = false; $('conserjeriaScheduleForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function saveSchedule(event) {
    event.preventDefault(); const days = [...document.querySelectorAll('input[name="conserjeriaDia"]:checked')].map((input) => Number(input.value)); if (!days.length) { setMessage('Seleccione al menos un día.'); return; } const id = $('conserjeriaScheduleId').value || null;
    const base = { p_conserje_id: $('conserjeriaScheduleConserje').value, p_aposento_id: $('conserjeriaScheduleAposento').value, p_rutina_id: $('conserjeriaScheduleRutina').value, p_hora_inicio: $('conserjeriaScheduleHoraInicio').value, p_hora_fin: $('conserjeriaScheduleHoraFin').value, p_foto_requerida: $('conserjeriaScheduleFoto').checked, p_vigente_desde: $('conserjeriaScheduleDesde').value, p_vigente_hasta: $('conserjeriaScheduleHasta').value || null };
    try { for (let i = 0; i < days.length; i += 1) await rpc('limpieza_admin_guardar_programacion_v4', { ...base, p_id: i === 0 ? id : null, p_dia_semana: days[i] }); state.programacion = await rpc('limpieza_admin_programacion_v4'); renderScheduleFilters(); renderProgramacion(); resetScheduleForm(); await loadDashboard(); setMessage('Asignación guardada correctamente.', 'success'); } catch (error) { setMessage(`No fue posible guardar: ${error.message}`); }
  }
  async function closeSchedule(id) { if (!confirm('¿Cerrar esta asignación? El historial se conservará.')) return; try { await rpc('limpieza_admin_cerrar_programacion_v4', { p_id: id }); state.programacion = await rpc('limpieza_admin_programacion_v4'); renderScheduleFilters(); renderProgramacion(); await loadDashboard(); } catch (error) { setMessage(`No fue posible cerrar: ${error.message}`); } }
  function renderLaborList() {
    const routineId = $('conserjeriaLaborRutina')?.value; const rows = state.rutinaLabores.filter((item) => item.rutina_id === routineId); const el = $('conserjeriaLaborList'); if (!el) return;
    el.innerHTML = rows.length ? rows.map((item) => `<div class="conserjeria-labor-row"><label><input type="checkbox" data-labor-assigned="${item.labor_id}" ${item.asignada ? 'checked' : ''} /><span>${escapeHtml(item.labor)}</span></label><label><input type="checkbox" data-labor-required="${item.labor_id}" ${item.obligatoria ? 'checked' : ''} /> Obligatoria</label><label>Orden <input type="number" min="1" max="100" value="${Number(item.orden) || 50}" data-labor-order="${item.labor_id}" /></label></div>`).join('') : '<p class="conserjeria-empty">Seleccione una rutina.</p>';
  }
  async function saveLabors() {
    const routineId = $('conserjeriaLaborRutina').value; const assigned = [...document.querySelectorAll('[data-labor-assigned]')];
    try { await Promise.all(assigned.map((input) => rpc('limpieza_admin_guardar_rutina_labor_v4', { p_rutina_id: routineId, p_labor_id: input.dataset.laborAssigned, p_asignada: input.checked, p_obligatoria: document.querySelector(`[data-labor-required="${input.dataset.laborAssigned}"]`).checked, p_orden: Number(document.querySelector(`[data-labor-order="${input.dataset.laborAssigned}"]`).value) }))); state.rutinaLabores = await rpc('limpieza_admin_rutina_labores_v4'); renderLaborList(); setMessage('Labores actualizadas.', 'success'); } catch (error) { setMessage(`No fue posible guardar las labores: ${error.message}`); }
  }
  async function addLabor(event) { event.preventDefault(); const name = $('conserjeriaNewLabor').value.trim(); if (!name) return; try { await rpc('limpieza_admin_crear_labor_v4', { p_nombre: name }); [state.catalogos, state.rutinaLabores] = await Promise.all([rpc('limpieza_admin_catalogos_v4'), rpc('limpieza_admin_rutina_labores_v4')]); $('conserjeriaNewLabor').value = ''; renderCatalogos(); setMessage('Labor agregada.', 'success'); } catch (error) { setMessage(`No fue posible agregar la labor: ${error.message}`); } }
  async function openPhoto(path) { const { data, error } = await state.client.storage.from('limpieza-reportes').createSignedUrl(path, 600); if (error || !data?.signedUrl) { setMessage('No fue posible abrir la fotografía.'); return; } window.open(data.signedUrl, '_blank', 'noopener'); }
  async function exportExcel() {
    try { const end = hoyCr(); const start = `${Number(end.slice(0, 4)) - 10}${end.slice(4)}`; const all = await rpc('limpieza_admin_reportes_v4', { p_desde: start, p_hasta: end, p_conserje_id: null, p_aposento_id: null }); if (!all.length) { setMessage('No hay reportes para exportar.'); return; } const rows = all.map((r) => ({ Fecha: hoyCr(new Date(r.enviado_at || r.fecha)), Hora_escaneo: fechaHora(r.escaneado_at), Hora_envio: fechaHora(r.enviado_at || r.fecha), Duracion_segundos: r.duracion_segundos ?? '', Conserje: r.conserje, Recinto: r.aposento, Rutina: r.rutina || '', Labores_realizadas: (r.checklist || []).filter((x) => x.completada).map((x) => x.nombre).join(' | '), Labores_no_realizadas: (r.checklist || []).filter((x) => !x.completada).map((x) => x.nombre).join(' | '), Observaciones: r.observaciones || '', Fotografia: r.foto_path ? 'Sí' : 'No' })); const ws = XLSX.utils.json_to_sheet(rows); ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 34 }, { wch: 24 }, { wch: 60 }, { wch: 60 }, { wch: 50 }, { wch: 12 }]; const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, ws, 'Reportes'); XLSX.writeFile(book, `reportes_conserjeria_${end}.xlsx`); } catch (error) { setMessage(`No fue posible exportar: ${error.message}`); }
  }
  function activateManagement(tab) { document.querySelectorAll('[data-management-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.managementTab === tab)); document.querySelectorAll('[data-management-panel]').forEach((panel) => { panel.hidden = panel.dataset.managementPanel !== tab; }); }

  $('showConserjeriaAdmin')?.addEventListener('click', setModule); $('refreshConserjeriaAdmin')?.addEventListener('click', loadPanel); $('exportConserjeriaExcel')?.addEventListener('click', exportExcel); $('conserjeriaControlFecha')?.addEventListener('change', () => { state.weeklyDay = null; loadDashboard(); }); $('conserjeriaControlRecinto')?.addEventListener('change', loadDashboard);
  $('conserjeriaAdminTabs')?.addEventListener('click', (event) => { const button = event.target.closest('[data-conserje-id]'); if (button) { state.conserjeId = button.dataset.conserjeId; loadDashboard(); } }); $('conserjeriaReportesFiltrados')?.addEventListener('click', (event) => { const button = event.target.closest('[data-photo-path]'); if (button) openPhoto(button.dataset.photoPath); });
  $('conserjeriaWeeklySummary')?.addEventListener('click', (event) => { const button = event.target.closest('[data-week-date]'); if (button) { state.weeklyDay = button.dataset.weekDate; renderWeekly($('conserjeriaControlRecinto').value || null); } });
  $('conserjeriaScheduleAposento')?.addEventListener('change', renderRutinasAsignacion); $('conserjeriaScheduleForm')?.addEventListener('submit', saveSchedule); $('conserjeriaScheduleCancel')?.addEventListener('click', resetScheduleForm); $('conserjeriaScheduleList')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-schedule-edit]'); const close = event.target.closest('[data-schedule-close]'); if (edit) editSchedule(edit.dataset.scheduleEdit); if (close) closeSchedule(close.dataset.scheduleClose); });
  ['conserjeriaScheduleFilterConserje', 'conserjeriaScheduleFilterDia', 'conserjeriaScheduleFilterHorario'].forEach((id) => $(id)?.addEventListener('change', renderProgramacion));
  document.querySelectorAll('[data-management-tab]').forEach((button) => button.addEventListener('click', () => activateManagement(button.dataset.managementTab))); $('conserjeriaLaborRutina')?.addEventListener('change', renderLaborList); $('conserjeriaSaveLabors')?.addEventListener('click', saveLabors); $('conserjeriaNewLaborForm')?.addEventListener('submit', addLabor);
  document.addEventListener('DOMContentLoaded', () => setTimeout(initButtonVisibility, 400)); if (document.readyState !== 'loading') setTimeout(initButtonVisibility, 400);
})();
