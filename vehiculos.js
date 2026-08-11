(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.RESERVAS_CONFIG || {};
  const state = {
    client: null, session: null, profile: null, cycle: null, vehicles: [], events: [],
    reservations: [], calendarEvents: [], history: [], maintenance: [], services: [], teachers: [], profiles: [], vehicleId: null,
    month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), loaded: false
  };
  const categories = { oil_change: 'Cambio de aceite', minor_repair: 'Reparación menor', major_repair: 'Reparación mayor' };
  const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const isAdmin = () => state.profile?.role === 'admin'
    && ['superadmin', 'reservations'].includes(state.profile?.admin_scope);
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const pad = (value) => String(value).padStart(2, '0');
  const localDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const localDateTime = (date) => `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const formatDateTime = (value) => new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const formatTime = (value) => new Intl.DateTimeFormat('es-CR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  const statusNames = {
    pending_approval: 'Pendiente de aprobación',
    confirmed: 'Confirmada',
    suspended_maintenance: 'Suspendida temporalmente',
    cancelled: 'Cancelada',
    rejected: 'Rechazada'
  };
  const vehicleImage = (value = '') => {
    const path = String(value);
    if (/mitsubishi/i.test(path) && window.VEHICLE_IMAGES?.mitsubishi) return window.VEHICLE_IMAGES.mitsubishi;
    if (/toyota/i.test(path) && window.VEHICLE_IMAGES?.toyota) return window.VEHICLE_IMAGES.toyota;
    return path.replace(/\.(webp|jpe?g)$/i, '.png');
  };

  function setMessage(element, text, success = false) {
    if (!element) return;
    element.textContent = text;
    element.hidden = !text;
    element.classList.toggle('is-success', success);
  }

  function reservationsOpen() {
    if (!state.cycle?.reservations_enabled) return false;
    const now = new Date();
    return now >= new Date(state.cycle.booking_opens_at) && now <= new Date(state.cycle.booking_closes_at);
  }

  function reservationBlockReason() {
    if (!state.cycle) return 'La administración todavía no ha configurado el periodo de reservación.';
    if (!state.cycle.reservations_enabled) return 'Las reservas están cerradas por la administración.';
    const now = new Date();
    if (now < new Date(state.cycle.booking_opens_at)) return `Las reservas abrirán el ${formatDateTime(state.cycle.booking_opens_at)}.`;
    if (now > new Date(state.cycle.booking_closes_at)) return 'El periodo de reservación ya finalizó.';
    if (!isAdmin() && state.profile?.reservations_blocked) {
      return state.profile.reservations_block_reason || 'Tu cuenta no tiene habilitada la creación de reservas.';
    }
    if (!isAdmin() && pendingPhotosFor().length > 0) {
      return 'Debes cargar la fotografía de bitácora pendiente antes de realizar otra reserva.';
    }
    return '';
  }

  function updateVehicleConnectionStatus() {
    const reason = reservationBlockReason();
    const blockedByPhoto = reason.includes('bitácora');
    const blockedByAdmin = !isAdmin() && state.profile?.reservations_blocked;
    $('vehicleConnectionStatus').textContent = blockedByAdmin ? 'Reservas bloqueadas' : blockedByPhoto ? 'Bitácora pendiente' : reason ? 'Reservas cerradas' : 'Reservas abiertas';
    $('vehicleConnectionStatus').classList.toggle('is-offline', Boolean(reason));
    setMessage($('vehicleReservationNotice'), reason);
  }

  function setModule(module) {
    const vehicles = module === 'vehicles';
    $('classroomPrivateModule').hidden = vehicles;
    $('vehiclePrivateModule').hidden = !vehicles;
    if ($('conserjeriaAdminModule')) $('conserjeriaAdminModule').hidden = true;
    $('showPrivateClassrooms').setAttribute('aria-selected', String(!vehicles));
    $('showPrivateVehicles').setAttribute('aria-selected', String(vehicles));
    if ($('showConserjeriaAdmin')) $('showConserjeriaAdmin').setAttribute('aria-selected', 'false');
    $('publicOccupationLink').href = vehicles ? 'index.html?vista=vehiculos' : 'index.html';
    if (vehicles && !state.loaded) loadVehicleModule();
  }

  function monthBounds() {
    return {
      from: new Date(state.month.getFullYear(), state.month.getMonth(), 1),
      to: new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0)
    };
  }

  function renderVehicleOptions() {
    const options = state.vehicles.map((vehicle) =>
      `<option value="${vehicle.id}">${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.display_name)}</option>`
    ).join('');
    ['privateVehicleSelect', 'vehicleBookingVehicle', 'maintenanceVehicle', 'serviceVehicle'].forEach((id) => {
      if ($(id)) $(id).innerHTML = options;
    });
    if (!state.vehicleId && state.vehicles[0]) state.vehicleId = String(state.vehicles[0].id);
    $('privateVehicleSelect').value = state.vehicleId || '';
    $('vehicleBookingVehicle').value = state.vehicleId || '';
    const teacherOptions = state.teachers.map((teacher) =>
      `<option value="${teacher.id}">${escapeHtml(teacher.full_name)}${teacher.unit ? ` · ${escapeHtml(teacher.unit)}` : ' · Unidad pendiente'}${teacher.reservations_blocked ? ' · Reservas bloqueadas' : ''}</option>`
    ).join('');
    $('vehicleBookingResponsible').innerHTML = teacherOptions;
    $('vehicleResponsibleField').hidden = !isAdmin();
    $('vehicleOverrideOption').hidden = !isAdmin();
    syncBookingUnit();
  }

  function selectedResponsibleProfile() {
    if (!isAdmin()) return state.profile;
    return state.teachers.find((teacher) => teacher.id === $('vehicleBookingResponsible').value) || null;
  }

  function syncBookingUnit() {
    const profile = selectedResponsibleProfile();
    $('vehicleBookingUnit').value = profile?.unit || '';
    $('vehicleBookingUnit').disabled = Boolean(profile?.unit) || isAdmin();
  }

  function pendingPhotosFor(userId = state.session?.user?.id, source = state.reservations) {
    const now = new Date();
    return source.filter((item) => item.user_id === userId
      && item.status === 'confirmed'
      && item.photo_required
      && new Date(item.ends_at) <= now
      && !item.trip_photo_path
      && !item.trip_photo_exempted_at);
  }

  function uploadablePhotosFor(userId = state.session?.user?.id, source = state.reservations) {
    return source.filter((item) => item.user_id === userId
      && item.status === 'confirmed'
      && item.photo_required
      && !item.trip_photo_path
      && !item.trip_photo_exempted_at);
  }

  function currentMaintenance(vehicleId) {
    const now = new Date();
    return state.maintenance.find((item) => String(item.vehicle_id) === String(vehicleId) && item.active
      && new Date(item.starts_at) <= now && (!item.ends_at || new Date(item.ends_at) > now));
  }

  function renderVehicleCards() {
    $('privateVehicleCards').innerHTML = state.vehicles.map((vehicle) => {
      const maintenance = currentMaintenance(vehicle.id);
      return `<article class="vehicle-card">
        <img src="${escapeHtml(vehicleImage(vehicle.image_path))}" alt="${escapeHtml(vehicle.display_name)}" />
        <div class="vehicle-card-body">
          <div><h3>${escapeHtml(vehicle.plate)}</h3><p>${escapeHtml(vehicle.display_name)}</p></div>
          <span class="status-chip${maintenance ? ' is-maintenance' : ''}">${maintenance ? `En mantenimiento · ${escapeHtml(categories[maintenance.category])}` : 'Disponible'}</span>
        </div>
      </article>`;
    }).join('');
  }

  function eventsForDay(day) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return state.calendarEvents.filter((item) => String(item.vehicle_id) === String(state.vehicleId)
      && new Date(item.starts_at) < end && new Date(item.ends_at) > start);
  }

  function canReserveDay(day, events) {
    const end = new Date(day); end.setHours(23, 59, 59, 999);
    return reservationsOpen()
      && (isAdmin() || !state.profile?.reservations_blocked)
      && (isAdmin() || pendingPhotosFor().length === 0)
      && end >= new Date()
      && !events.some((event) => event.event_type === 'maintenance');
  }

  function renderCalendar() {
    const { from } = monthBounds();
    $('privateVehicleMonthLabel').textContent = new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric' }).format(from);
    const first = new Date(from); first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const today = localDate(new Date());
    let html = weekdays.map((day) => `<div class="vehicle-weekday">${day}</div>`).join('');
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(first); day.setDate(first.getDate() + index);
      const events = eventsForDay(day);
      const outside = day.getMonth() !== state.month.getMonth();
      const items = events.map((event) => {
        if (event.event_type === 'maintenance') return `<span class="vehicle-event is-maintenance">${escapeHtml(categories[event.category] || 'Mantenimiento')}</span>`;
        const suspended = event.status === 'suspended_maintenance';
        const pending = event.status === 'pending_approval';
        return `<span class="vehicle-event${suspended ? ' is-suspended' : ''}${pending ? ' is-pending' : ''}">
          ${suspended ? 'Suspendida temporalmente' : pending ? 'Pendiente de aprobación' : `${formatTime(event.starts_at)}–${formatTime(event.ends_at)}`}<br>${escapeHtml(event.responsible_name)}
        </span>`;
      }).join('');
      const reserve = canReserveDay(day, events) && !outside
        ? `<button class="vehicle-free-button" type="button" data-reserve-date="${localDate(day)}">Reservar</button>`
        : (!items ? `<span class="vehicle-day-empty">${outside ? 'Fuera del mes' : reservationBlockReason() || (new Date(day).setHours(23, 59, 59, 999) < Date.now() ? 'Fecha pasada' : 'No disponible')}</span>` : '');
      html += `<div class="vehicle-day${outside ? ' is-outside' : ''}${localDate(day) === today ? ' is-today' : ''}">
        <span class="vehicle-day-number">${day.getDate()}</span>${items}${reserve}
      </div>`;
    }
    $('privateVehicleCalendar').innerHTML = html;
    $('privateVehicleCalendar').querySelectorAll('[data-reserve-date]').forEach((button) => {
      button.addEventListener('click', () => openBooking(button.dataset.reserveDate));
    });
  }

  function openBooking(date, item = null) {
    if (!reservationsOpen()) {
      window.alert('Las reservas están cerradas por la administración.');
      return;
    }
    if (!isAdmin() && pendingPhotosFor().length) {
      window.alert('Debes cargar la fotografía de bitácora de tu última gira antes de realizar otra reserva.');
      return;
    }
    if (!isAdmin() && state.profile?.reservations_blocked) {
      window.alert(state.profile.reservations_block_reason || 'Tu cuenta no tiene habilitada la creación de reservas.');
      return;
    }
    const start = item ? new Date(item.starts_at) : new Date(`${date}T08:00:00`);
    const end = item ? new Date(item.ends_at) : new Date(`${date}T17:00:00`);
    $('vehicleBookingForm').dataset.editId = item?.id || '';
    $('vehicleBookingVehicle').value = item?.vehicle_id || state.vehicleId;
    $('vehicleBookingStart').value = localDateTime(start);
    $('vehicleBookingEnd').value = localDateTime(end);
    $('vehicleBookingDestination').value = item?.destination || '';
    $('vehicleBookingObjective').value = item?.objective || '';
    $('vehicleBookingPartySize').value = item?.party_size || 1;
    $('vehicleBookingItinerary').value = item?.itinerary === 'No indicado' ? '' : (item?.itinerary || '');
    $('vehicleBookingObservations').value = item?.observations || '';
    $('vehicleDriverOne').value = item?.additional_drivers?.[0] || '';
    $('vehicleDriverTwo').value = item?.additional_drivers?.[1] || '';
    if (item && isAdmin()) $('vehicleBookingResponsible').value = item.user_id;
    $('vehiclePolicyOverride').checked = Boolean(item?.policy_override);
    $('vehicleOverrideReason').value = item?.override_reason || '';
    $('vehicleOverrideReasonField').hidden = !isAdmin() || !$('vehiclePolicyOverride').checked;
    syncBookingUnit();
    setMessage($('vehicleBookingMessage'), '');
    $('vehicleBookingDialog').showModal();
  }

  function detailField(label, value, wide = false) {
    return `<div${wide ? ' class="detail-wide"' : ''}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'No indicado')}</dd></div>`;
  }

  async function openReservationDetail(id) {
    if (!isAdmin()) return;
    const item = state.history.find((entry) => entry.id === id)
      || state.reservations.find((entry) => entry.id === id);
    if (!item) return;
    const vehicle = state.vehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
    const profile = state.profiles.find((entry) => entry.id === item.user_id);
    const drivers = item.additional_drivers || [];
    const status = statusNames[item.status] || item.status;
    $('vehicleDetailStatus').innerHTML = `<span class="status-chip${item.status === 'suspended_maintenance' ? ' is-maintenance' : ''}">${escapeHtml(status)}</span>`;
    $('vehicleDetailGrid').innerHTML = [
      detailField('Vehículo', `${vehicle?.plate || ''} · ${vehicle?.display_name || ''}`),
      detailField('Profesor responsable', item.responsible_name),
      detailField('Correo institucional', profile?.email || 'No indicado'),
      detailField('Unidad institucional', item.unit || profile?.unit || 'No indicada'),
      detailField('Salida', formatDateTime(item.starts_at)),
      detailField('Regreso', formatDateTime(item.ends_at)),
      detailField('Cantidad de personas', String(item.party_size || 1)),
      detailField('Destino', item.destination),
      detailField('Objetivo de la gira', item.objective, true),
      detailField('Itinerario', item.itinerary, true),
      detailField('Observaciones', item.observations || 'Sin observaciones', true),
      detailField('Chofer adicional 1', drivers[0] || 'No indicado'),
      detailField('Chofer adicional 2', drivers[1] || 'No indicado'),
      detailField('Número de boleta de gira', item.trip_sheet_number || 'No indicado'),
      detailField('Kilometraje de salida', item.departure_mileage == null ? 'No indicado' : `${item.departure_mileage.toLocaleString('es-CR')} km`),
      detailField('Kilometraje de llegada', item.arrival_mileage == null ? 'No indicado' : `${item.arrival_mileage.toLocaleString('es-CR')} km`),
      detailField('Combustible de salida', ({ quarter: '¼', half: '½', three_quarters: '¾', full: 'Lleno' })[item.departure_fuel_level || item.fuel_level] || 'No indicado'),
      detailField('Combustible de llegada', ({ quarter: '¼', half: '½', three_quarters: '¾', full: 'Lleno' })[item.arrival_fuel_level] || 'No indicado'),
      detailField('Estado del vehículo', ({ clean: 'Limpio', dirty: 'Sucio', other: 'Otro' })[item.vehicle_condition] || 'No indicado'),
      detailField('Kilometraje de abastecimiento', item.fueling_mileage == null ? 'No indicado' : `${item.fueling_mileage.toLocaleString('es-CR')} km`),
      detailField('Estación de servicio o gasolinera', item.service_station_location || 'No indicada'),
      detailField('Cantidad de litros de combustible', item.fuel_liters == null ? 'No indicada' : `${Number(item.fuel_liters).toLocaleString('es-CR')} L`),
      detailField('Tipo de combustible', ({ diesel: 'Diésel', regular: 'Gasolina regular', super: 'Gasolina súper', other: 'Otro' })[item.fuel_type] || 'No indicado'),
      detailField('Monto de factura', item.invoice_amount == null ? 'No indicado' : `₡${Number(item.invoice_amount).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
      detailField('Fecha de factura', item.invoice_date || 'No indicada'),
      detailField('Número de factura', item.invoice_number || 'No indicado'),
      detailField('Número de autorización del voucher', item.voucher_authorization_number || 'No indicado'),
      detailField('Observaciones', item.irregularity_notes || 'Sin observaciones registradas', true),
      detailField('Fecha de registro', formatDateTime(item.created_at)),
      detailField('Bitácora fotográfica', item.trip_photo_path ? `Cargada el ${formatDateTime(item.trip_photo_uploaded_at)}` : item.trip_photo_exempted_at ? `Exonerada: ${item.trip_photo_exemption_reason}` : item.photo_required ? 'Pendiente' : 'No requerida'),
      detailField('Aprobación o excepción', item.override_reason || item.approval_reason || 'No requerida', true),
      detailField('Identificador', item.id)
    ].join('');
    $('tripPhotoDetail').hidden = true;
    if (item.trip_photo_path) {
      const { data, error } = await state.client.storage.from('vehicle-trip-photos').createSignedUrl(item.trip_photo_path, 900);
      if (!error && data?.signedUrl) {
        $('tripPhotoLink').href = data.signedUrl;
        $('tripPhotoDetailImage').src = data.signedUrl;
        $('tripPhotoDetail').hidden = false;
      }
    }
    $('vehicleReservationDetailDialog').showModal();
  }

  function renderReservationList(target, items, adminControls = false) {
    if (!items.length) {
      target.innerHTML = '<p class="empty-state">No hay reservas para mostrar.</p>';
      return;
    }
    target.innerHTML = items.map((item) => {
      const vehicle = state.vehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
      const suspended = item.status === 'suspended_maintenance';
      const pending = item.status === 'pending_approval';
      let controls = '';
      if (adminControls) {
        controls = `<div class="vehicle-admin-actions">
          <button class="secondary-button compact-button" type="button" data-detail-vehicle="${item.id}">Ver detalle</button>
          ${pending ? `<button class="primary-button compact-button" type="button" data-vehicle-action="approve" data-id="${item.id}">Aprobar</button><button class="danger-button" type="button" data-vehicle-action="reject" data-id="${item.id}">Rechazar</button>` : ''}
          ${['cancelled', 'rejected'].includes(item.status) || pending ? '' : `${suspended ? `<button class="secondary-button compact-button" type="button" data-vehicle-action="reactivate" data-id="${item.id}">Reactivar</button>` : `<button class="secondary-button compact-button" type="button" data-edit-vehicle="${item.id}">Editar</button>`}
          <button class="secondary-button compact-button" type="button" data-vehicle-action="reassign" data-id="${item.id}">Reasignar</button>
          <button class="danger-button" type="button" data-vehicle-action="cancel" data-id="${item.id}">Cancelar</button>`}
        </div>`;
      } else if (!adminControls) {
        controls = `<div class="vehicle-admin-actions"><a class="secondary-button compact-button" href="mis-giras.html?gira=${encodeURIComponent(item.id)}">Ver detalle</a>
          ${['pending_approval', 'confirmed'].includes(item.status) && new Date(item.starts_at) > new Date() ? `<button class="danger-button" type="button" data-cancel-vehicle="${item.id}">Cancelar</button>` : ''}</div>`;
      }
      return `<article class="vehicle-reservation-item${suspended ? ' is-suspended' : ''}${pending ? ' is-pending' : ''}">
        <span class="vehicle-plate">${escapeHtml(vehicle?.plate || 'Vehículo')}</span>
        <div><h4>${escapeHtml(item.destination)}</h4><p>${formatDateTime(item.starts_at)} → ${formatDateTime(item.ends_at)}</p>
        <p>${escapeHtml(item.responsible_name)} · ${escapeHtml(item.objective)} · ${escapeHtml(statusNames[item.status] || item.status)}</p></div>
        ${controls}
      </article>`;
    }).join('');
    target.querySelectorAll('[data-cancel-vehicle]').forEach((button) => button.addEventListener('click', () => cancelReservation(button.dataset.cancelVehicle)));
    target.querySelectorAll('[data-vehicle-action]').forEach((button) => button.addEventListener('click', () => resolveReservation(button.dataset.id, button.dataset.vehicleAction)));
    target.querySelectorAll('[data-edit-vehicle]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = state.history.find((entry) => entry.id === button.dataset.editVehicle)
          || state.reservations.find((entry) => entry.id === button.dataset.editVehicle);
        if (item) openBooking(localDate(new Date(item.starts_at)), item);
      });
    });
    target.querySelectorAll('[data-detail-vehicle]').forEach((button) => button.addEventListener('click', () => openReservationDetail(button.dataset.detailVehicle)));
  }

  function renderLists() {
    const upcoming = state.reservations.filter((item) => item.user_id === state.session?.user?.id
      && !['cancelled', 'rejected'].includes(item.status) && new Date(item.ends_at) >= new Date());
    renderReservationList($('myVehicleReservations'), upcoming);
    renderPendingPhotos();
    if (isAdmin()) {
      renderReservationList($('pendingVehicleApprovals'), state.history.filter((item) => item.status === 'pending_approval'), true);
      renderReservationList($('suspendedVehicleReservations'), state.reservations.filter((item) => item.status === 'suspended_maintenance'), true);
      renderReservationList($('adminVehicleReservations'), state.reservations.filter((item) => item.status === 'confirmed'), true);
      renderReservationList($('adminVehicleHistoryList'), state.history, true);
      renderAdminPendingPhotos();
    }
  }

  function renderPendingPhotos() {
    const pending = uploadablePhotosFor();
    const target = $('pendingTripPhotos');
    if (!pending.length) {
      target.innerHTML = '<p class="empty-state">No tienes reservas pendientes de fotografía.</p>';
      return;
    }
    target.innerHTML = pending.map((item) => {
      const vehicle = state.vehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
      const now = new Date();
      const startsAt = new Date(item.starts_at);
      const endsAt = new Date(item.ends_at);
      const timing = now < startsAt
        ? `Reserva programada para el ${formatDateTime(item.starts_at)}`
        : now <= endsAt
          ? `Gira en curso hasta el ${formatDateTime(item.ends_at)}`
          : `Gira finalizada el ${formatDateTime(item.ends_at)}`;
      const reminder = now <= endsAt
        ? 'La fotografía ya está habilitada para esta reserva.'
        : 'Debes completar esta bitácora antes de reservar nuevamente.';
      return `<article class="vehicle-reservation-item is-photo-pending">
        <span class="vehicle-plate">${escapeHtml(vehicle?.plate || 'Vehículo')}</span>
        <div><h4>${escapeHtml(item.destination)}</h4><p>${timing}</p>
        <p>${reminder}</p></div>
        <button class="primary-button compact-button" type="button" data-upload-trip-photo="${item.id}">Cargar fotografía</button>
      </article>`;
    }).join('');
    target.querySelectorAll('[data-upload-trip-photo]').forEach((button) =>
      button.addEventListener('click', () => openTripPhotoDialog(button.dataset.uploadTripPhoto)));
  }

  function renderAdminPendingPhotos() {
    const target = $('adminPendingTripPhotos');
    const pending = state.history.filter((item) => item.status === 'confirmed'
      && item.photo_required && new Date(item.ends_at) <= new Date()
      && !item.trip_photo_path && !item.trip_photo_exempted_at);
    if (!pending.length) {
      target.innerHTML = '<p class="empty-state">No hay bitácoras pendientes.</p>';
      return;
    }
    target.innerHTML = pending.map((item) => {
      const vehicle = state.vehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
      return `<article class="vehicle-reservation-item is-photo-pending">
        <span class="vehicle-plate">${escapeHtml(vehicle?.plate || 'Vehículo')}</span>
        <div><h4>${escapeHtml(item.responsible_name)}</h4><p>${escapeHtml(item.unit || 'Unidad pendiente')} · ${escapeHtml(item.destination)}</p>
        <p>Gira finalizada el ${formatDateTime(item.ends_at)}</p></div>
        <div class="vehicle-admin-actions">
          <button class="secondary-button compact-button" type="button" data-detail-vehicle="${item.id}">Ver detalle</button>
          <button class="secondary-button compact-button" type="button" data-exempt-trip-photo="${item.id}">Exonerar</button>
        </div>
      </article>`;
    }).join('');
    target.querySelectorAll('[data-detail-vehicle]').forEach((button) =>
      button.addEventListener('click', () => openReservationDetail(button.dataset.detailVehicle)));
    target.querySelectorAll('[data-exempt-trip-photo]').forEach((button) =>
      button.addEventListener('click', () => exemptTripPhoto(button.dataset.exemptTripPhoto)));
  }

  function serviceState(service) {
    const days = service?.next_oil_date ? Math.ceil((new Date(`${service.next_oil_date}T23:59:59`) - new Date()) / 86400000) : Infinity;
    const km = service?.next_oil_mileage != null && service?.current_mileage != null ? service.next_oil_mileage - service.current_mileage : Infinity;
    if (!service?.next_oil_date && service?.next_oil_mileage == null) return { label: 'Cambio de aceite sin programar', className: 'is-warning' };
    if (days < 0 || km <= 0) return { label: 'Cambio de aceite vencido', className: 'is-overdue' };
    if (days <= 30 || km <= 500) return { label: 'Cambio de aceite próximo', className: 'is-warning' };
    return { label: 'Cambio de aceite al día', className: '' };
  }

  function dekraState(service) {
    if (!service?.next_dekra_month) return { label: 'DEKRA sin programar', className: 'is-warning' };
    const due = new Date(`${service.next_dekra_month}T23:59:59`);
    due.setMonth(due.getMonth() + 1); due.setDate(0);
    const days = Math.ceil((due - new Date()) / 86400000);
    if (days < 0) return { label: 'DEKRA vencida', className: 'is-overdue' };
    if (days <= 30) return { label: `DEKRA vence en ${days} días`, className: 'is-overdue' };
    if (days <= 60) return { label: `DEKRA vence en ${days} días`, className: 'is-warning' };
    return { label: `DEKRA: ${new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric' }).format(new Date(`${service.next_dekra_month}T12:00:00`))}`, className: '' };
  }

  function renderAdminService() {
    if (!isAdmin()) return;
    $('adminServiceAlerts').innerHTML = state.vehicles.map((vehicle) => {
      const service = state.services.find((item) => String(item.vehicle_id) === String(vehicle.id));
      const oil = serviceState(service); const dekra = dekraState(service);
      return `<article class="service-card"><h3>${escapeHtml(vehicle.plate)}</h3>
        <div class="service-alert ${oil.className}">${oil.label}</div>
        <div class="service-alert ${dekra.className}">${dekra.label}</div>
      </article>`;
    }).join('');
    loadServiceForm();
  }

  function renderMaintenanceList() {
    if (!isAdmin()) return;
    const active = state.maintenance.filter((item) => item.active);
    $('activeMaintenanceList').innerHTML = active.length ? active.map((item) => {
      const vehicle = state.vehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
      return `<article class="vehicle-reservation-item"><span class="vehicle-plate">${escapeHtml(vehicle?.plate || '')}</span>
        <div><h4>${escapeHtml(categories[item.category])}</h4><p>${formatDateTime(item.starts_at)}${item.ends_at ? ` → ${formatDateTime(item.ends_at)}` : ' · Sin fecha de finalización'}</p></div>
        <button class="secondary-button compact-button" type="button" data-close-maintenance="${item.id}">Finalizar</button></article>`;
    }).join('') : '<p class="empty-state">No hay mantenimientos activos.</p>';
    $('activeMaintenanceList').querySelectorAll('[data-close-maintenance]').forEach((button) =>
      button.addEventListener('click', () => closeMaintenance(button.dataset.closeMaintenance)));
  }

  function loadServiceForm() {
    const service = state.services.find((item) => String(item.vehicle_id) === String($('serviceVehicle').value));
    $('currentMileage').value = service?.current_mileage ?? '';
    $('nextOilMileage').value = service?.next_oil_mileage ?? '';
    $('nextOilDate').value = service?.next_oil_date ?? '';
    $('nextDekraMonth').value = service?.next_dekra_month?.slice(0, 7) ?? '2026-09';
    $('serviceNotes').value = service?.notes ?? '';
  }

  async function loadCore() {
    const [{ data: vehicleData, error: vehicleError }, { data: cycleData }] = await Promise.all([
      state.client.from('vehicles').select('*').eq('active', true).order('sort_order'),
      state.client.from('reservation_cycles').select('*').eq('is_current', true).maybeSingle()
    ]);
    if (vehicleError) throw vehicleError;
    state.vehicles = vehicleData || []; state.cycle = cycleData || null;
    if (isAdmin()) {
      const { data } = await state.client.from('profiles').select('id,full_name,email,unit,active,reservations_blocked,reservations_block_reason').eq('role', 'teacher').order('full_name');
      state.profiles = data || [];
      state.teachers = state.profiles.filter((profile) => profile.active);
    }
    renderVehicleOptions();
  }

  async function reloadData() {
    const { from, to } = monthBounds();
    const endExclusive = new Date(to); endExclusive.setDate(endExclusive.getDate() + 1);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cycleEnd = state.cycle?.reservation_end_date
      ? new Date(`${state.cycle.reservation_end_date}T23:59:59`) : new Date(today.getFullYear() + 1, 11, 31);
    const queryFrom = new Date(Math.min(from.getTime(), today.getTime()));
    const queryTo = new Date(Math.max(endExclusive.getTime(), cycleEnd.getTime()));
    const calendarFrom = localDate(from);
    const calendarTo = localDate(to);
    const reservationQuery = isAdmin()
      ? state.client.from('vehicle_reservations').select('*').lt('starts_at', queryTo.toISOString()).gt('ends_at', queryFrom.toISOString()).order('starts_at')
      : state.client.from('vehicle_reservations').select('*').order('starts_at', { ascending: false }).limit(500);
    const queries = [
      state.client.rpc('get_public_vehicle_calendar', { p_from: calendarFrom, p_to: calendarTo }),
      reservationQuery,
      state.client.from('vehicle_maintenance').select('*').eq('active', true).lt('starts_at', queryTo.toISOString()).or(`ends_at.is.null,ends_at.gt.${queryFrom.toISOString()}`).order('starts_at')
    ];
    if (isAdmin()) {
      queries.push(state.client.from('vehicle_service_schedules').select('*').order('vehicle_id'));
      queries.push(state.client.from('vehicle_reservations').select('*').order('starts_at', { ascending: false }).limit(1000));
    }
    const results = await Promise.all(queries);
    const firstError = results.find((result) => result.error)?.error;
    if (firstError) throw firstError;
    state.calendarEvents = results[0].data || [];
    state.reservations = results[1].data || [];
    state.maintenance = results[2].data || [];
    state.services = results[3]?.data || [];
    state.history = isAdmin() ? (results[4]?.data || []) : state.reservations;
    renderVehicleCards(); renderCalendar(); renderLists(); renderMaintenanceList(); renderAdminService(); updateVehicleConnectionStatus();
  }

  async function loadVehicleModule() {
    try {
      $('vehicleConnectionStatus').textContent = 'Conectando…';
      if (!state.client) state.client = window.RESERVAS_SUPABASE_CLIENT || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      window.RESERVAS_SUPABASE_CLIENT = state.client;
      const { data: { session } } = await state.client.auth.getSession();
      if (!session) { window.location.replace('ingreso.html?v=7'); return; }
      state.session = session;
      const { data: profile, error } = await state.client.from('profiles').select('id,full_name,email,unit,role,admin_scope,active,reservations_blocked,reservations_block_reason').eq('id', session.user.id).single();
      if (error) throw error;
      state.profile = profile;
      $('vehicleAdminPanel').hidden = !isAdmin();
      await loadCore();
      await reloadData();
      state.loaded = true;
      updateVehicleConnectionStatus();
    } catch (error) {
      $('vehicleConnectionStatus').textContent = 'No disponible';
      $('privateVehicleCalendar').innerHTML = `<p class="vehicle-message">${escapeHtml(error.message || 'No fue posible cargar los vehículos.')}</p>`;
    }
  }

  async function saveReservation(event) {
    event.preventDefault();
    const drivers = [$('vehicleDriverOne').value.trim(), $('vehicleDriverTwo').value.trim()].filter(Boolean);
    const userId = isAdmin() ? $('vehicleBookingResponsible').value : state.session.user.id;
    if (!userId) { setMessage($('vehicleBookingMessage'), 'Selecciona el profesor responsable.'); return; }
    const responsible = selectedResponsibleProfile();
    const selectedUnit = $('vehicleBookingUnit').value;
    if (responsible?.reservations_blocked) {
      setMessage($('vehicleBookingMessage'), responsible.reservations_block_reason || 'La cuenta responsable no tiene habilitada la creación de reservas.');
      return;
    }
    if (!responsible?.unit && !isAdmin()) {
      if (!['Docencia', 'Administrativo', 'LAA', 'PROCAME'].includes(selectedUnit)) {
        setMessage($('vehicleBookingMessage'), 'Selecciona tu unidad institucional.'); return;
      }
      const { error: unitError } = await state.client.rpc('set_my_unit', { p_unit: selectedUnit });
      if (unitError) { setMessage($('vehicleBookingMessage'), unitError.message); return; }
      state.profile.unit = selectedUnit;
    } else if (!responsible?.unit) {
      setMessage($('vehicleBookingMessage'), 'El responsable no tiene una unidad institucional registrada.'); return;
    }
    const payload = {
      vehicle_id: Number($('vehicleBookingVehicle').value), user_id: userId,
      responsible_name: state.profile.full_name,
      starts_at: new Date($('vehicleBookingStart').value).toISOString(),
      ends_at: new Date($('vehicleBookingEnd').value).toISOString(),
      destination: $('vehicleBookingDestination').value.trim(),
      objective: $('vehicleBookingObjective').value.trim(),
      party_size: Number($('vehicleBookingPartySize').value),
      itinerary: $('vehicleBookingItinerary').value.trim(),
      observations: $('vehicleBookingObservations').value.trim() || null,
      additional_drivers: drivers,
      unit: selectedUnit || responsible?.unit,
      policy_override: isAdmin() && $('vehiclePolicyOverride').checked,
      override_reason: isAdmin() && $('vehiclePolicyOverride').checked ? $('vehicleOverrideReason').value.trim() : null
    };
    if (new Date(payload.starts_at) >= new Date(payload.ends_at)) {
      setMessage($('vehicleBookingMessage'), 'La fecha de regreso debe ser posterior a la salida.'); return;
    }
    const editId = $('vehicleBookingForm').dataset.editId;
    if (payload.policy_override && (!payload.override_reason || payload.override_reason.length < 5)) {
      setMessage($('vehicleBookingMessage'), 'Indica la justificación de la excepción administrativa.'); return;
    }
    const request = editId
      ? state.client.from('vehicle_reservations').update(payload).eq('id', editId).select('status').single()
      : state.client.from('vehicle_reservations').insert(payload).select('status').single();
    const { data, error } = await request;
    if (error) { setMessage($('vehicleBookingMessage'), error.message); return; }
    $('vehicleBookingDialog').close();
    await reloadData();
    if (data?.status === 'pending_approval') {
      window.alert('La solicitud fue registrada y quedó pendiente de aprobación porque supera los 3 días.');
    }
  }

  async function cancelReservation(id) {
    if (!window.confirm('¿Deseas cancelar esta reserva de vehículo?')) return;
    const { error } = await state.client.from('vehicle_reservations').update({ status: 'cancelled' }).eq('id', id);
    if (error) window.alert(error.message); else await reloadData();
  }

  async function resolveReservation(id, action) {
    const labels = { approve: 'aprobar', reject: 'rechazar', reactivate: 'reactivar', reassign: 'reasignar al otro vehículo', cancel: 'cancelar' };
    if (!window.confirm(`¿Deseas ${labels[action]} esta reserva?`)) return;
    let reason = null;
    if (action === 'approve' || action === 'reject') {
      reason = window.prompt(action === 'approve' ? 'Indica la justificación de la aprobación:' : 'Indica el motivo del rechazo:');
      if (!reason?.trim()) return;
    }
    const item = state.history.find((entry) => entry.id === id)
      || state.reservations.find((entry) => entry.id === id);
    const other = action === 'reassign' ? state.vehicles.find((vehicle) => String(vehicle.id) !== String(item.vehicle_id)) : null;
    const { error } = await state.client.rpc('admin_resolve_vehicle_reservation', {
      p_id: id, p_action: action, p_vehicle_id: other?.id || null, p_reason: reason
    });
    if (error) window.alert(error.message); else await reloadData();
  }

  function openTripPhotoDialog(id) {
    const item = state.reservations.find((entry) => entry.id === id)
      || state.history.find((entry) => entry.id === id);
    if (!item) return;
    $('tripPhotoForm').reset();
    $('tripPhotoForm').dataset.reservationId = id;
    $('tripPhotoPreview').hidden = true;
    $('tripPhotoPreview').removeAttribute('src');
    setMessage($('tripPhotoMessage'), '');
    const now = new Date();
    const startsAt = new Date(item.starts_at);
    const endsAt = new Date(item.ends_at);
    let timingDescription = `gira finalizada el ${formatDateTime(item.ends_at)}`;
    if (now < startsAt) {
      timingDescription = `reserva programada para el ${formatDateTime(item.starts_at)}`;
    } else if (now <= endsAt) {
      timingDescription = `gira en curso hasta el ${formatDateTime(item.ends_at)}`;
    }
    $('tripPhotoDescription').textContent = `${item.destination} · ${timingDescription}`;
    $('tripPhotoDialog').showModal();
  }

  function closeTripPhotoDialog() {
    $('tripPhotoForm').reset();
    $('tripPhotoPreview').hidden = true;
    $('tripPhotoPreview').removeAttribute('src');
    setMessage($('tripPhotoMessage'), '');
    $('tripPhotoDialog').close();
  }

  function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('No fue posible procesar la fotografía.')),
      'image/jpeg',
      quality
    ));
  }

  async function compressTripPhoto(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('Selecciona una fotografía válida.');
    if (file.size > 50 * 1024 * 1024) throw new Error('La fotografía original supera el límite permitido.');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    let width = bitmap.width;
    let height = bitmap.height;
    const maxDimension = 1800;
    if (Math.max(width, height) > maxDimension) {
      const ratio = maxDimension / Math.max(width, height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    let blob;
    let quality = 0.82;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      blob = await canvasBlob(canvas, quality);
      if (blob.size <= 950 * 1024) break;
      width = Math.max(900, Math.round(width * 0.82));
      height = Math.max(700, Math.round(height * 0.82));
      quality = Math.max(0.62, quality - 0.05);
    }
    bitmap.close?.();
    if (!blob || blob.size > 1024 * 1024) throw new Error('No fue posible reducir la fotografía a 1 MB. Intenta con otra imagen.');
    return blob;
  }

  async function uploadTripPhoto(event) {
    event.preventDefault();
    const file = $('tripPhotoFile').files[0];
    if (!file) { setMessage($('tripPhotoMessage'), 'Selecciona o toma una fotografía.'); return; }
    const button = $('uploadTripPhoto');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Procesando fotografía…';
    let objectPath = '';
    try {
      const reservationId = $('tripPhotoForm').dataset.reservationId;
      const blob = await compressTripPhoto(file);
      objectPath = `${state.session.user.id}/${reservationId}/${Date.now()}-${crypto.randomUUID()}.jpg`;
      button.textContent = 'Guardando fotografía…';
      const { error: uploadError } = await state.client.storage.from('vehicle-trip-photos').upload(objectPath, blob, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });
      if (uploadError) throw uploadError;
      const { error: attachError } = await state.client.rpc('attach_vehicle_trip_photo', {
        p_reservation_id: reservationId,
        p_object_path: objectPath
      });
      if (attachError) {
        await state.client.storage.from('vehicle-trip-photos').remove([objectPath]);
        throw attachError;
      }
      closeTripPhotoDialog();
      await reloadData();
      window.alert('Fotografía de bitácora guardada correctamente. Ya puedes realizar una nueva reserva.');
    } catch (error) {
      setMessage($('tripPhotoMessage'), error.message || 'No fue posible guardar la fotografía.');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function exemptTripPhoto(id) {
    const reason = window.prompt('Indica la justificación para exonerar esta fotografía:');
    if (!reason?.trim()) return;
    const { error } = await state.client.rpc('admin_exempt_vehicle_trip_photo', {
      p_reservation_id: id,
      p_reason: reason.trim()
    });
    if (error) window.alert(error.message);
    else await reloadData();
  }

  async function saveMaintenance(event) {
    event.preventDefault();
    setMessage($('maintenanceMessage'), '');
    const end = $('maintenanceEnd').value ? new Date($('maintenanceEnd').value).toISOString() : null;
    const { error } = await state.client.rpc('admin_set_vehicle_maintenance', {
      p_vehicle_id: Number($('maintenanceVehicle').value),
      p_starts_at: new Date($('maintenanceStart').value).toISOString(),
      p_ends_at: end, p_category: $('maintenanceCategory').value,
      p_details: $('maintenanceDetails').value.trim()
    });
    if (error) { setMessage($('maintenanceMessage'), error.message); return; }
    setMessage($('maintenanceMessage'), 'Mantenimiento registrado. Las reservas afectadas quedaron suspendidas temporalmente.', true);
    await reloadData();
  }

  async function closeMaintenance(id) {
    if (!window.confirm('¿Deseas finalizar este mantenimiento? Las reservas suspendidas deberán revisarse manualmente.')) return;
    const { error } = await state.client.rpc('admin_close_vehicle_maintenance', { p_id: id, p_ends_at: new Date().toISOString() });
    if (error) window.alert(error.message); else await reloadData();
  }

  async function saveService(event) {
    event.preventDefault();
    const month = $('nextDekraMonth').value ? `${$('nextDekraMonth').value}-01` : null;
    const { error } = await state.client.rpc('admin_upsert_vehicle_service', {
      p_vehicle_id: Number($('serviceVehicle').value),
      p_current_mileage: $('currentMileage').value ? Number($('currentMileage').value) : null,
      p_next_oil_date: $('nextOilDate').value || null,
      p_next_oil_mileage: $('nextOilMileage').value ? Number($('nextOilMileage').value) : null,
      p_next_dekra_month: month,
      p_notes: $('serviceNotes').value.trim()
    });
    if (error) { setMessage($('serviceMessage'), error.message); return; }
    setMessage($('serviceMessage'), 'Programación actualizada.', true);
    await reloadData();
  }

  async function exportVehicleHistory() {
    if (!isAdmin()) return;
    if (!window.XLSX) {
      setMessage($('vehicleHistoryMessage'), 'No fue posible iniciar la exportación de Excel.');
      return;
    }
    const button = $('exportVehicleHistory');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparando Excel…';
    setMessage($('vehicleHistoryMessage'), '');
    try {
      const [reservationsResult, profilesResult] = await Promise.all([
        state.client.from('vehicle_reservations').select('*').order('starts_at', { ascending: false }).limit(5000),
        state.client.from('profiles').select('id,full_name,email,unit')
      ]);
      if (reservationsResult.error) throw reservationsResult.error;
      if (profilesResult.error) throw profilesResult.error;
      const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const rows = (reservationsResult.data || []).map((item) => {
        const vehicle = state.vehicles.find((entry) => String(entry.id) === String(item.vehicle_id));
        const profile = profileMap.get(item.user_id);
        return {
          'Estado': statusNames[item.status] || item.status,
          'Vehículo': vehicle?.display_name || '',
          'Placa': vehicle?.plate || '',
          'Profesor responsable': item.responsible_name,
          'Correo institucional': profile?.email || '',
          'Unidad institucional': item.unit || profile?.unit || '',
          'Salida': new Date(item.starts_at),
          'Regreso': new Date(item.ends_at),
          'Cantidad de personas': item.party_size || 1,
          'Destino': item.destination,
          'Objetivo de la gira': item.objective,
          'Itinerario': item.itinerary || '',
          'Observaciones': item.observations || '',
          'Chofer adicional 1': item.additional_drivers?.[0] || '',
          'Chofer adicional 2': item.additional_drivers?.[1] || '',
          'Número de boleta de gira': item.trip_sheet_number || '',
          'Kilometraje de salida': item.departure_mileage ?? '',
          'Kilometraje de llegada': item.arrival_mileage ?? '',
          'Combustible de salida': ({ quarter: '¼', half: '½', three_quarters: '¾', full: 'Lleno' })[item.departure_fuel_level || item.fuel_level] || '',
          'Combustible de llegada': ({ quarter: '¼', half: '½', three_quarters: '¾', full: 'Lleno' })[item.arrival_fuel_level] || '',
          'Estado del vehículo': ({ clean: 'Limpio', dirty: 'Sucio', other: 'Otro' })[item.vehicle_condition] || '',
          'Kilometraje de abastecimiento': item.fueling_mileage ?? '',
          'Estación de servicio o gasolinera': item.service_station_location || '',
          'Cantidad de litros de combustible': item.fuel_liters ?? '',
          'Tipo de combustible': ({ diesel: 'Diésel', regular: 'Gasolina regular', super: 'Gasolina súper', other: 'Otro' })[item.fuel_type] || '',
          'Monto de factura': item.invoice_amount ?? '',
          'Fecha de factura': item.invoice_date ? new Date(`${item.invoice_date}T00:00:00`) : '',
          'Número de factura': item.invoice_number || '',
          'Número de autorización del voucher': item.voucher_authorization_number || '',
          'Observaciones': item.irregularity_notes || '',
          'Fecha de registro': new Date(item.created_at),
          'Fecha de cancelación': item.cancelled_at ? new Date(item.cancelled_at) : '',
          'Aprobación o excepción': item.override_reason || item.approval_reason || '',
          'Bitácora fotográfica': item.trip_photo_path ? 'Cargada' : item.trip_photo_exempted_at ? 'Exonerada' : item.photo_required ? 'Pendiente' : 'No requerida',
          'Fecha de fotografía': item.trip_photo_uploaded_at ? new Date(item.trip_photo_uploaded_at) : '',
          'Ruta privada de fotografía': item.trip_photo_path || '',
          'Identificador': item.id
        };
      });
      if (!rows.length) {
        setMessage($('vehicleHistoryMessage'), 'No hay reservas de vehículos para exportar.');
        return;
      }
      const sheet = window.XLSX.utils.json_to_sheet(rows, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm' });
      sheet['!cols'] = [
        { wch: 24 }, { wch: 25 }, { wch: 12 }, { wch: 30 }, { wch: 34 },
        { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 38 },
        { wch: 45 }, { wch: 45 }, { wch: 28 }, { wch: 28 }, { wch: 20 },
        { wch: 20 }, { wch: 38 }
      ];
      sheet['!autofilter'] = { ref: sheet['!ref'] };
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, sheet, 'Historial de vehículos');
      window.XLSX.writeFile(workbook, `historial_reservas_vehiculos_${localDate(new Date())}.xlsx`, {
        compression: true,
        cellDates: true
      });
      setMessage($('vehicleHistoryMessage'), `Excel generado con ${rows.length} reserva${rows.length === 1 ? '' : 's'}.`, true);
    } catch (error) {
      setMessage($('vehicleHistoryMessage'), error.message || 'No fue posible generar el historial.');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  $('showPrivateClassrooms')?.addEventListener('click', () => setModule('classrooms'));
  $('showPrivateVehicles')?.addEventListener('click', () => setModule('vehicles'));
  $('privateVehicleSelect')?.addEventListener('change', (event) => { state.vehicleId = event.target.value; renderCalendar(); });
  $('privateVehiclePrevMonth')?.addEventListener('click', async () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); await reloadData(); });
  $('privateVehicleNextMonth')?.addEventListener('click', async () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); await reloadData(); });
  $('refreshVehicleReservations')?.addEventListener('click', reloadData);
  $('vehicleBookingForm')?.addEventListener('submit', saveReservation);
  $('vehicleBookingResponsible')?.addEventListener('change', syncBookingUnit);
  $('vehiclePolicyOverride')?.addEventListener('change', () => {
    $('vehicleOverrideReasonField').hidden = !$('vehiclePolicyOverride').checked;
    if (!$('vehiclePolicyOverride').checked) $('vehicleOverrideReason').value = '';
  });
  $('closeVehicleBookingDialog')?.addEventListener('click', () => $('vehicleBookingDialog').close());
  $('cancelVehicleBooking')?.addEventListener('click', () => $('vehicleBookingDialog').close());
  $('maintenanceForm')?.addEventListener('submit', saveMaintenance);
  $('serviceScheduleForm')?.addEventListener('submit', saveService);
  $('serviceVehicle')?.addEventListener('change', loadServiceForm);
  $('exportVehicleHistory')?.addEventListener('click', exportVehicleHistory);
  $('closeVehicleDetailDialog')?.addEventListener('click', () => $('vehicleReservationDetailDialog').close());
  $('acceptVehicleDetailDialog')?.addEventListener('click', () => $('vehicleReservationDetailDialog').close());
  $('tripPhotoForm')?.addEventListener('submit', uploadTripPhoto);
  $('closeTripPhotoDialog')?.addEventListener('click', closeTripPhotoDialog);
  $('cancelTripPhoto')?.addEventListener('click', closeTripPhotoDialog);
  $('tripPhotoFile')?.addEventListener('change', () => {
    const file = $('tripPhotoFile').files[0];
    if (!file) { $('tripPhotoPreview').hidden = true; return; }
    $('tripPhotoPreview').src = URL.createObjectURL(file);
    $('tripPhotoPreview').hidden = false;
  });
  if (new URLSearchParams(window.location.search).get('modulo') === 'vehiculos') setModule('vehicles');
})();
