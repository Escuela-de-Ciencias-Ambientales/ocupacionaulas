(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.RESERVAS_CONFIG || {};
  const state = { client: null, vehicles: [], events: [], month: new Date(), vehicleId: null };
  state.month = new Date(state.month.getFullYear(), state.month.getMonth(), 1);

  const categoryNames = {
    oil_change: 'Cambio de aceite',
    minor_repair: 'Reparación menor',
    major_repair: 'Reparación mayor'
  };
  const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const dateKey = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const formatTime = (value) => new Intl.DateTimeFormat('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const vehicleImage = (value = '') => {
    const path = String(value);
    if (/mitsubishi/i.test(path) && window.VEHICLE_IMAGES?.mitsubishi) return window.VEHICLE_IMAGES.mitsubishi;
    if (/toyota/i.test(path) && window.VEHICLE_IMAGES?.toyota) return window.VEHICLE_IMAGES.toyota;
    return path.replace(/\.(webp|jpe?g)$/i, '.png');
  };

  function setModule(module) {
    const vehicles = module === 'vehicles';
    $('classroomPublicView').hidden = vehicles;
    $('vehiclePublicView').hidden = !vehicles;
    $('showPublicClassrooms').setAttribute('aria-selected', String(!vehicles));
    $('showPublicVehicles').setAttribute('aria-selected', String(vehicles));
    const url = new URL(window.location.href);
    if (vehicles) url.searchParams.set('vista', 'vehiculos');
    else url.searchParams.delete('vista');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (vehicles && !state.vehicles.length) load();
  }

  function monthBounds() {
    return {
      from: new Date(state.month.getFullYear(), state.month.getMonth(), 1),
      to: new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0)
    };
  }

  function renderCards() {
    const now = new Date();
    const available = state.vehicles.filter((vehicle) => !vehicle.maintenance_category).length;
    $('publicVehicleCount').textContent = state.vehicles.length;
    $('publicAvailableCount').textContent = available;
    $('publicVehicleCards').innerHTML = state.vehicles.map((vehicle) => {
      const maintenance = vehicle.maintenance_category;
      const status = maintenance ? `En mantenimiento · ${categoryNames[maintenance] || 'Mantenimiento'}` : 'Disponible';
      return `<article class="vehicle-card">
        <img src="${escapeHtml(vehicleImage(vehicle.image_path))}" alt="${escapeHtml(vehicle.display_name)}" />
        <div class="vehicle-card-body">
          <div><h3>${escapeHtml(vehicle.plate)}</h3><p>${escapeHtml(vehicle.display_name)}</p></div>
          <span class="status-chip${maintenance ? ' is-maintenance' : ''}">${escapeHtml(status)}</span>
        </div>
      </article>`;
    }).join('');
    $('publicVehicleSelect').innerHTML = state.vehicles.map((vehicle) =>
      `<option value="${vehicle.id}">${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.display_name)}</option>`
    ).join('');
    if (!state.vehicleId && state.vehicles[0]) state.vehicleId = String(state.vehicles[0].id);
    $('publicVehicleSelect').value = state.vehicleId || '';
    void now;
  }

  function serviceState(vehicle) {
    if (!vehicle.next_oil_date && vehicle.next_oil_mileage == null) return { label: 'Programación pendiente', className: 'is-warning' };
    const days = vehicle.next_oil_date ? Math.ceil((new Date(`${vehicle.next_oil_date}T23:59:59`) - new Date()) / 86400000) : Infinity;
    const km = vehicle.next_oil_mileage != null && vehicle.current_mileage != null
      ? vehicle.next_oil_mileage - vehicle.current_mileage : Infinity;
    if (days < 0 || km <= 0) return { label: 'Mantenimiento vencido', className: 'is-overdue' };
    if (days <= 30 || km <= 500) return { label: 'Mantenimiento próximo', className: 'is-warning' };
    return { label: 'Programación al día', className: '' };
  }

  function renderService() {
    $('publicServiceSchedule').innerHTML = state.vehicles.map((vehicle) => {
      const status = serviceState(vehicle);
      return `<article class="service-card">
        <h3>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.display_name)}</h3>
        <div class="service-metrics">
          <div><span>Kilometraje actual</span><strong>${vehicle.current_mileage == null ? 'Pendiente' : `${Number(vehicle.current_mileage).toLocaleString('es-CR')} km`}</strong></div>
          <div><span>Próxima fecha</span><strong>${vehicle.next_oil_date ? new Date(`${vehicle.next_oil_date}T12:00:00`).toLocaleDateString('es-CR') : 'Pendiente'}</strong></div>
          <div><span>Próximo kilometraje</span><strong>${vehicle.next_oil_mileage == null ? 'Pendiente' : `${Number(vehicle.next_oil_mileage).toLocaleString('es-CR')} km`}</strong></div>
        </div>
        <div class="service-alert ${status.className}">${status.label}</div>
      </article>`;
    }).join('');
  }

  function eventsForDay(day) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return state.events.filter((event) => String(event.vehicle_id) === String(state.vehicleId)
      && new Date(event.starts_at) < end && new Date(event.ends_at) > start);
  }

  function renderCalendar() {
    const { from } = monthBounds();
    $('publicVehicleMonthLabel').textContent = new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric' }).format(from);
    const first = new Date(from);
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const today = localDate(new Date());
    let html = weekdays.map((day) => `<div class="vehicle-weekday">${day}</div>`).join('');
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(first); day.setDate(first.getDate() + index);
      const events = eventsForDay(day);
      const outside = day.getMonth() !== state.month.getMonth();
      const items = events.map((event) => {
        if (event.event_type === 'maintenance') {
          return `<span class="vehicle-event is-maintenance">${escapeHtml(categoryNames[event.category] || 'Mantenimiento')}</span>`;
        }
        const suspended = event.status === 'suspended_maintenance';
        const pending = event.status === 'pending_approval';
        const label = suspended ? 'Suspendida temporalmente' : pending ? 'Pendiente de aprobación' : `${formatTime(event.starts_at)}–${formatTime(event.ends_at)}`;
        return `<span class="vehicle-event${suspended ? ' is-suspended' : ''}${pending ? ' is-pending' : ''}" title="${escapeHtml(event.responsible_name || '')}">${escapeHtml(label)}<br>${escapeHtml(event.responsible_name || '')}</span>`;
      }).join('');
      html += `<div class="vehicle-day${outside ? ' is-outside' : ''}${localDate(day) === today ? ' is-today' : ''}">
        <span class="vehicle-day-number">${day.getDate()}</span>
        ${items || '<span class="vehicle-day-empty">Disponible</span>'}
      </div>`;
    }
    $('publicVehicleCalendar').innerHTML = html;
  }

  async function loadCalendar() {
    if (!state.client || !state.vehicleId) return;
    const { from, to } = monthBounds();
    const { data, error } = await state.client.rpc('get_public_vehicle_calendar', { p_from: localDate(from), p_to: localDate(to) });
    if (error) {
      $('publicVehicleCalendar').innerHTML = `<p class="vehicle-message">No fue posible cargar el calendario: ${escapeHtml(error.message)}</p>`;
      return;
    }
    state.events = data || [];
    renderCalendar();
  }

  async function load() {
    if (!window.supabase?.createClient || !config.supabaseUrl || !config.supabaseAnonKey) {
      $('publicVehicleCards').innerHTML = '<p class="vehicle-message">La conexión de vehículos todavía no está configurada.</p>';
      return;
    }
    if (!state.client) state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data, error } = await state.client.rpc('get_public_vehicle_overview');
    if (error) {
      $('publicVehicleCards').innerHTML = `<p class="vehicle-message">No fue posible cargar los vehículos: ${escapeHtml(error.message)}</p>`;
      return;
    }
    state.vehicles = data || [];
    renderCards();
    renderService();
    await loadCalendar();
  }

  $('showPublicClassrooms')?.addEventListener('click', () => setModule('classrooms'));
  $('showPublicVehicles')?.addEventListener('click', () => setModule('vehicles'));
  $('publicVehicleSelect')?.addEventListener('change', (event) => { state.vehicleId = event.target.value; renderCalendar(); });
  $('publicVehiclePrevMonth')?.addEventListener('click', async () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); await loadCalendar();
  });
  $('publicVehicleNextMonth')?.addEventListener('click', async () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); await loadCalendar();
  });
  setModule(new URLSearchParams(window.location.search).get('vista') === 'vehiculos' ? 'vehicles' : 'classrooms');
})();
