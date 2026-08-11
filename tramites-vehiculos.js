(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.RESERVAS_CONFIG || {};
  const state = { client: null, session: null, profile: null, reservations: [], vehicles: [], profiles: [], tab: 'pending', teacherFilter: '' };
  const canProcess = () => state.profile?.role === 'admin'
    && ['superadmin', 'operations', 'reservations', 'conserjeria'].includes(state.profile?.admin_scope);
  const isSuperadmin = () => state.profile?.role === 'admin' && state.profile?.admin_scope === 'superadmin';
  const canOpenConserjeria = () => state.profile?.role === 'admin'
    && ['superadmin', 'operations', 'conserjeria'].includes(state.profile?.admin_scope);
  const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const formatDateTime = (value) => new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const processingStatus = (item) => item.processing_status || 'pending';
  const vehicleLabel = (item) => {
    const vehicle = state.vehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
    return [vehicle?.plate, vehicle?.display_name].filter(Boolean).join(' · ') || 'Pickup';
  };
  const processorName = (id) => state.profiles.find((profile) => profile.id === id)?.full_name || 'Sin registrar';

  function setMessage(text, success = false) {
    const el = $('processingMessage');
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('is-success', success);
  }

  async function copyValue(value, button) {
    const text = String(value || 'No indicado');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else window.prompt('Copia este valor:', text);
    if (button) {
      button.textContent = 'Copiado';
      setTimeout(() => { button.textContent = 'Copiar'; }, 1000);
    }
  }

  function row(label, value, textarea = false) {
    const display = value || 'No indicado';
    return `<div class="institutional-row">
      <label>${escapeHtml(label)}:</label>
      <div class="institutional-value${textarea ? ' is-textarea' : ''}">${escapeHtml(display)}</div>
      <button class="copy-field-button" type="button" data-copy-value="${escapeHtml(display)}">Copiar</button>
    </div>`;
  }

  function card(item) {
    const finalStatus = ['processed', 'rejected'].includes(processingStatus(item));
    const rejected = processingStatus(item) === 'rejected';
    return `<article class="institutional-card">
      <header>
        <p class="eyebrow">Formulario homologado UNA</p>
        <h2>Boleta de gira · ${escapeHtml(item.destination || 'Sin destino')}</h2>
        <p>${escapeHtml(item.responsible_name)} · ${formatDateTime(item.starts_at)} → ${formatDateTime(item.ends_at)}${finalStatus ? ` · ${rejected ? 'Rechazada' : 'Tramitada'} por ${escapeHtml(processorName(item.processed_by))}` : ''}</p>
      </header>
      <div class="institutional-grid">
        ${row('Objetivo', item.objective, true)}
        ${row('Número de personas', item.party_size || 1)}
        ${row('Fecha y hora de salida', formatDateTime(item.starts_at))}
        ${row('Fecha y hora de regreso', formatDateTime(item.ends_at))}
        ${row('Responsable de la gira', [item.responsible_id_number, item.responsible_name].filter(Boolean).join(' · '))}
        ${row('Lugar de salida', item.departure_place)}
        ${row('Provincia', item.destination_province)}
        ${row('Cantón', item.destination_canton)}
        ${row('Distrito', item.destination_district)}
        ${row('Destino', item.destination)}
        ${row('Itinerario', item.itinerary, true)}
        ${row('Vehículo', vehicleLabel(item))}
        ${row('Chofer', [item.driver_id_number, item.driver_name].filter(Boolean).join(' · '))}
        ${row('Curso', item.course)}
        ${row('Observaciones', item.observations || 'Sin observaciones', true)}
      </div>
      <label class="processing-note-label" for="processingNote-${item.id}">Nota interna de trámite</label>
      <textarea id="processingNote-${item.id}" class="institutional-note" maxlength="800">${escapeHtml(item.processing_notes || '')}</textarea>
      <div class="institutional-actions">
        ${finalStatus ? '<button class="processing-action-button is-neutral" type="button" data-processing-action="pending" data-id="' + item.id + '">Volver a por procesar</button>' : '<button class="processing-action-button is-approved" type="button" data-processing-action="processed" data-id="' + item.id + '">Tramitada</button><button class="processing-action-button is-rejected" type="button" data-processing-action="rejected" data-id="' + item.id + '">Rechazada</button>'}
      </div>
    </article>`;
  }

  function countBy(items, labeler) {
    const counts = new Map();
    items.forEach((item) => {
      const label = labeler(item) || 'No indicado';
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
  }

  function filteredByTeacher(items) {
    if (!state.teacherFilter) return items;
    return items.filter((item) => item.user_id === state.teacherFilter);
  }

  function teacherLabel(item) {
    return item.responsible_name || state.profiles.find((profile) => profile.id === item.user_id)?.full_name || 'Sin responsable';
  }

  function renderTeacherFilter() {
    const select = $('processingTeacherFilter');
    if (!select) return;
    const current = state.teacherFilter;
    const teachers = new Map();
    state.reservations.forEach((item) => {
      if (item.user_id) teachers.set(item.user_id, teacherLabel(item));
    });
    const options = [...teachers.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))
      .map(([id, name]) => `<option value="${escapeHtml(id)}"${id === current ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
    select.innerHTML = `<option value="">Todos los profesores</option>${options}`;
    select.value = current && teachers.has(current) ? current : '';
    state.teacherFilter = select.value;
  }

  function renderStats() {
    const processed = filteredByTeacher(state.reservations).filter((item) => ['processed', 'rejected'].includes(processingStatus(item)));
    const scoped = isSuperadmin() ? processed : processed.filter((item) => item.processed_by === state.session.user.id);
    const requester = countBy(scoped, (item) => item.responsible_name)[0];
    const vehicle = countBy(scoped, vehicleLabel)[0];
    const destination = countBy(scoped, (item) => item.destination)[0];
    $('processingContent').innerHTML = `<div class="vehicle-stats-grid">
      <div><span>Total tramitadas</span><strong>${scoped.length}</strong></div>
      <div><span>Funcionario principal</span><strong>${escapeHtml(requester ? requester[0] : 'Sin datos')}</strong></div>
      <div><span>Vehículo principal</span><strong>${escapeHtml(vehicle ? vehicle[0] : 'Sin datos')}</strong></div>
      <div><span>Destino principal</span><strong>${escapeHtml(destination ? destination[0] : 'Sin datos')}</strong></div>
    </div>`;
  }

  function render() {
    document.querySelectorAll('[data-processing-tab]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.processingTab === state.tab));
    });
    renderTeacherFilter();
    if (state.tab === 'stats') { renderStats(); return; }
    const items = filteredByTeacher(state.reservations).filter((item) => !['cancelled', 'rejected'].includes(item.status)
      && (state.tab === 'processed' ? ['processed', 'rejected'].includes(processingStatus(item)) : !['processed', 'rejected'].includes(processingStatus(item))));
    $('processingContent').innerHTML = items.length
      ? `<div class="institutional-form-list">${items.map(card).join('')}</div>`
      : '<p class="empty-state">No hay reservas en esta pestaña.</p>';
    $('processingContent').querySelectorAll('[data-copy-value]').forEach((button) => {
      button.addEventListener('click', () => copyValue(button.dataset.copyValue, button));
    });
    $('processingContent').querySelectorAll('[data-processing-action]').forEach((button) => {
      button.addEventListener('click', () => updateStatus(button.dataset.id, button.dataset.processingAction));
    });
  }

  async function updateStatus(id, status) {
    const note = $(`processingNote-${id}`)?.value.trim() || null;
    const { error } = await state.client.rpc('admin_update_vehicle_reservation_processing', {
      p_id: id, p_processing_status: status, p_processing_notes: note
    });
    if (error) { setMessage(error.message); return; }
    setMessage(status === 'processed' ? 'Reserva marcada como tramitada.' : status === 'rejected' ? 'Reserva rechazada y retirada de la bandeja.' : 'Reserva devuelta a por procesar.', true);
    await loadData();
  }

  async function loadData() {
    const [{ data: vehicles }, { data: reservations, error }, { data: profiles }] = await Promise.all([
      state.client.from('vehicles').select('*').order('sort_order'),
      state.client.from('vehicle_reservations').select('*').order('starts_at', { ascending: false }).limit(2000),
      state.client.from('profiles').select('id,full_name,email,role,admin_scope')
    ]);
    if (error) throw error;
    state.vehicles = vehicles || [];
    state.reservations = reservations || [];
    state.profiles = profiles || [];
    render();
  }

  async function init() {
    try {
      state.client = window.RESERVAS_SUPABASE_CLIENT || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      window.RESERVAS_SUPABASE_CLIENT = state.client;
      const { data: { session } } = await state.client.auth.getSession();
      if (!session) { window.location.replace('ingreso.html?v=7'); return; }
      state.session = session;
      const { data: profile, error } = await state.client.from('profiles').select('id,full_name,email,role,admin_scope').eq('id', session.user.id).single();
      if (error) throw error;
      state.profile = profile;
      if (!canProcess()) { window.location.replace('reservas.html?modulo=vehiculos'); return; }
      $('processingHeaderAccount').hidden = false;
      $('processingUserName').textContent = profile.full_name;
      $('processingConserjeriaNav').hidden = !canOpenConserjeria();
      $('processingManageUsersLink').hidden = !isSuperadmin();
      $('processingStatus').textContent = 'Conectado';
      await loadData();
    } catch (error) {
      $('processingStatus').textContent = 'No disponible';
      $('processingContent').innerHTML = `<p class="vehicle-message">${escapeHtml(error.message || 'No fue posible cargar el trámite.')}</p>`;
    }
  }

  document.querySelectorAll('[data-processing-tab]').forEach((button) => {
    button.addEventListener('click', () => { state.tab = button.dataset.processingTab; render(); });
  });
  $('processingTeacherFilter')?.addEventListener('change', (event) => { state.teacherFilter = event.target.value; render(); });
  $('processingLogout')?.addEventListener('click', async () => { await state.client.auth.signOut(); window.location.replace('ingreso.html?v=7'); });
  init();
})();
