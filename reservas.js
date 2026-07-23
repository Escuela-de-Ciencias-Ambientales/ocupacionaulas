(() => {
  'use strict';

  const config = window.RESERVAS_CONFIG || {};
  const isConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  const roomCodes = ['L601', 'L602', 'L603', '708', '709', '710', '711', 'SS-3P', 'SR-1P'];
  const roomDisplayNames = {
    L601: 'Laboratorio L601',
    L602: 'Laboratorio L602',
    L603: 'Laboratorio L603',
    'SS-3P': 'Sala de sesiones tercer piso',
    'SR-1P': 'Sala reuniones primer piso'
  };
  const dayNames = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  const monthNames = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];
  const dayMap = { DOMINGO: 0, LUNES: 1, MARTES: 2, MIERCOLES: 3, MIÉRCOLES: 3, JUEVES: 4, VIERNES: 5, SABADO: 6, SÁBADO: 6 };
  const teacherEmailPattern = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+@una\.cr$/;
  const strongPasswordPattern = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

  const byId = (id) => document.getElementById(id);
  const elements = {
    connectionStatus: byId('connectionStatus'), systemMessage: byId('systemMessage'), userView: byId('userView'),
    headerAccount: byId('headerAccount'),
    logoutButton: byId('logoutButton'), currentUserName: byId('currentUserName'), currentUserRole: byId('currentUserRole'), bookingForm: byId('bookingForm'),
    bookingDate: byId('bookingDate'), bookingRoom: byId('bookingRoom'), bookingStart: byId('bookingStart'),
    bookingEnd: byId('bookingEnd'), bookingActivity: byId('bookingActivity'), availabilityCheck: byId('availabilityCheck'),
    saveBookingButton: byId('saveBookingButton'), refreshButton: byId('refreshButton'), myBookingsList: byId('myBookingsList'),
    scheduleBrowser: byId('scheduleBrowser'), scheduleEditorTitle: byId('scheduleEditorTitle'),
    scheduleEditorDescription: byId('scheduleEditorDescription'), editorWeek: byId('editorWeek'),
    adminPanel: byId('adminPanel'), createUserForm: byId('createUserForm'), createUserMessage: byId('createUserMessage'),
    adminBookingsList: byId('adminBookingsList'),
    visitCounterPanel: byId('visitCounterPanel'), visitTodayCount: byId('visitTodayCount'), visitTotalCount: byId('visitTotalCount'),
    cycleBanner: byId('cycleBanner'), cycleName: byId('cycleName'), cycleDates: byId('cycleDates'), cycleState: byId('cycleState'),
    cycleDescription: byId('cycleDescription'), adminCycleState: byId('adminCycleState'), cycleForm: byId('cycleForm'),
    adminCycleName: byId('adminCycleName'), adminReservationStart: byId('adminReservationStart'),
    adminReservationEnd: byId('adminReservationEnd'), adminAcademicEnd: byId('adminAcademicEnd'),
    adminOpensAt: byId('adminOpensAt'), adminClosesAt: byId('adminClosesAt'), scheduleStatus: byId('scheduleStatus'),
    scheduleFile: byId('scheduleFile'), uploadScheduleButton: byId('uploadScheduleButton'),
    toggleReservationsButton: byId('toggleReservationsButton'), cycleActionHelp: byId('cycleActionHelp'),
    passwordDialog: byId('passwordDialog'), openPasswordDialog: byId('openPasswordDialog'),
    closePasswordDialog: byId('closePasswordDialog'), cancelPasswordDialog: byId('cancelPasswordDialog'),
    changePasswordForm: byId('changePasswordForm'), passwordMessage: byId('passwordMessage'),
    newPassword: byId('newPassword'), confirmPassword: byId('confirmPassword'),
    usersFile: byId('usersFile'), usersFileSummary: byId('usersFileSummary'), uploadUsersButton: byId('uploadUsersButton'),
    adminProfessorField: byId('adminProfessorField'), bookingProfessor: byId('bookingProfessor'),
    adminAccessLabel: byId('adminAccessLabel'), editorRoom: byId('editorRoom'), weeklyEditor: byId('weeklyEditor'),
    bookingDialog: byId('bookingDialog'), bookingDialogForm: byId('bookingDialogForm'),
    dialogBookingDate: byId('dialogBookingDate'), dialogBookingRoom: byId('dialogBookingRoom'),
    dialogBookingStart: byId('dialogBookingStart'), dialogBookingEnd: byId('dialogBookingEnd'),
    dialogAdminProfessorField: byId('dialogAdminProfessorField'), dialogBookingProfessor: byId('dialogBookingProfessor'),
    dialogBookingActivity: byId('dialogBookingActivity'), dialogAvailabilityCheck: byId('dialogAvailabilityCheck'),
    closeBookingDialog: byId('closeBookingDialog'), cancelBookingDialog: byId('cancelBookingDialog'),
    saveDialogBookingButton: byId('saveDialogBookingButton'),
    scheduleDialog: byId('scheduleDialog'), scheduleEntryForm: byId('scheduleEntryForm'), scheduleDialogTitle: byId('scheduleDialogTitle'),
    scheduleEntryId: byId('scheduleEntryId'), scheduleEntryRoom: byId('scheduleEntryRoom'), scheduleEntryDay: byId('scheduleEntryDay'),
    scheduleEntryStart: byId('scheduleEntryStart'), scheduleEntryEnd: byId('scheduleEntryEnd'),
    scheduleEntryProfessor: byId('scheduleEntryProfessor'), scheduleEntryCourseCode: byId('scheduleEntryCourseCode'),
    scheduleEntryCourseName: byId('scheduleEntryCourseName'), scheduleEntryNrc: byId('scheduleEntryNrc'),
    scheduleEntryGroup: byId('scheduleEntryGroup'), scheduleProfessorOptions: byId('scheduleProfessorOptions'),
    closeScheduleDialog: byId('closeScheduleDialog'), cancelScheduleDialog: byId('cancelScheduleDialog'),
    saveScheduleEntryButton: byId('saveScheduleEntryButton')
  };

  const state = {
    client: null, session: null, profile: null, cycle: null,
    rooms: roomCodes.map((code) => ({ id: null, code, name: roomDisplayNames[code] || `Aula ${code}` })),
    fixedOccupancies: [], reservations: [], teachers: []
  };

  const isAdmin = () => state.profile?.role === 'admin';
  const isSuperadmin = () => isAdmin() && state.profile?.admin_scope === 'superadmin';

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function roomDisplayName(code) { return roomDisplayNames[code] || `Aula ${code}`; }

  function showMessage(message, type = 'success') {
    elements.systemMessage.textContent = message;
    elements.systemMessage.classList.toggle('is-error', type === 'error');
    elements.systemMessage.hidden = false;
  }
  function clearMessage() { elements.systemMessage.hidden = true; elements.systemMessage.textContent = ''; elements.systemMessage.classList.remove('is-error'); }
  function showCreateUserMessage(message, type = 'success') {
    elements.createUserMessage.textContent = message;
    elements.createUserMessage.classList.toggle('is-error', type === 'error');
    elements.createUserMessage.hidden = false;
    elements.createUserMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function clearCreateUserMessage() {
    elements.createUserMessage.hidden = true;
    elements.createUserMessage.textContent = '';
    elements.createUserMessage.classList.remove('is-error');
  }
  function setBusy(button, busy, busyText = 'Procesando…') {
    if (!button) return;
    if (busy) { button.dataset.label = button.textContent; button.textContent = busyText; button.disabled = true; }
    else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
  }
  function localDateString(date = new Date()) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10); }
  function normalizeTime(value) { return String(value || '').slice(0, 5); }
  function normalizeHeader(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, '_');
  }
  function normalizeClock(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }
  function formatDate(value) { return new Intl.DateTimeFormat('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`)); }
  function formatDateTime(value) { return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  function dayName(dateString) { return dayNames[new Date(`${dateString}T12:00:00`).getDay()]; }
  function overlaps(startA, endA, startB, endB) { return normalizeTime(startA) < normalizeTime(endB) && normalizeTime(endA) > normalizeTime(startB); }
  function dateTimeLocal(value) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16); }

  function cycleIsOpen() {
    if (!state.cycle || !state.cycle.reservations_enabled || !state.cycle.academic_schedule_loaded) return false;
    const now = Date.now();
    return now >= new Date(state.cycle.booking_opens_at).getTime() && now <= new Date(state.cycle.booking_closes_at).getTime();
  }

  function initialDate() {
    if (!state.cycle) return localDateString();
    const today = localDateString();
    if (today < state.cycle.reservation_start_date) return state.cycle.reservation_start_date;
    if (today > state.cycle.reservation_end_date) return state.cycle.reservation_end_date;
    return today;
  }

  function setCycleStateBadge(element, label, className) {
    element.textContent = label;
    element.classList.remove('is-open', 'is-closed', 'is-waiting');
    element.classList.add(className);
  }

  function renderCycle() {
    const cycle = state.cycle;
    elements.cycleBanner.hidden = !cycle;
    if (!cycle) { elements.saveBookingButton.disabled = true; return; }
    const open = cycleIsOpen();
    const waiting = cycle.reservations_enabled && !open;
    elements.cycleName.textContent = cycle.name;
    elements.cycleDates.textContent = `Reservas para fechas del ${formatDate(cycle.reservation_start_date)} al ${formatDate(cycle.reservation_end_date)}.`;
    elements.cycleDescription.textContent = open
      ? `Sistema habilitado hasta el ${formatDateTime(cycle.booking_closes_at)}.`
      : 'La consulta continúa disponible. Solo la administración puede habilitar nuevas reservas.';
    setCycleStateBadge(elements.cycleState, open ? 'Reservas abiertas' : waiting ? 'Fuera de horario' : 'Reservas cerradas', open ? 'is-open' : waiting ? 'is-waiting' : 'is-closed');

    [elements.bookingDate, elements.dialogBookingDate, elements.editorWeek].forEach((input) => { input.min = cycle.reservation_start_date; input.max = cycle.reservation_end_date; });
    if (!elements.bookingDate.value || elements.bookingDate.value < cycle.reservation_start_date || elements.bookingDate.value > cycle.reservation_end_date) elements.bookingDate.value = initialDate();
    if (!elements.editorWeek.value || elements.editorWeek.value < cycle.reservation_start_date || elements.editorWeek.value > cycle.reservation_end_date) elements.editorWeek.value = initialDate();

    if (isAdmin()) {
      elements.adminCycleName.value = cycle.name;
      elements.adminReservationStart.value = cycle.reservation_start_date;
      elements.adminReservationEnd.value = cycle.reservation_end_date;
      elements.adminAcademicEnd.value = cycle.academic_schedule_end_date;
      elements.adminOpensAt.value = dateTimeLocal(cycle.booking_opens_at);
      elements.adminClosesAt.value = dateTimeLocal(cycle.booking_closes_at);
      elements.scheduleStatus.textContent = cycle.academic_schedule_loaded
        ? 'Horario académico cargado. Las clases tienen prioridad sobre cualquier reserva.'
        : 'Aún no se ha cargado para este ciclo.';
      setCycleStateBadge(elements.adminCycleState, open ? 'Abierto' : 'Cerrado', open ? 'is-open' : 'is-closed');
      elements.toggleReservationsButton.textContent = cycle.reservations_enabled ? 'Cerrar reservas' : 'Abrir reservas';
      elements.toggleReservationsButton.disabled = !cycle.academic_schedule_loaded;
      elements.cycleActionHelp.textContent = cycle.academic_schedule_loaded
        ? `Ventana configurada: ${formatDateTime(cycle.booking_opens_at)} a ${formatDateTime(cycle.booking_closes_at)}.`
        : 'Carga primero la ocupación académica; el sistema no permite abrir las reservas sin ella.';
    }
    updateAvailability();
  }

  function baseConflict(roomCode, date, start, end) {
    if (!state.cycle || date > state.cycle.academic_schedule_end_date) return null;
    const selectedDay = new Date(`${date}T12:00:00`).getDay();
    return state.fixedOccupancies.find((record) => record.classrooms?.code === roomCode && record.day_of_week === selectedDay && overlaps(start, end, record.start_time, record.end_time));
  }
  function reservationConflict(roomCode, date, start, end) {
    return state.reservations.find((item) => item.status === 'active' && item.reservation_date === date && item.classrooms?.code === roomCode && overlaps(start, end, item.start_time, item.end_time));
  }
  function validateSlot({ room, date, start, end }) {
    if (!state.cycle) return { ok: false, message: 'La administración aún no ha configurado el ciclo.' };
    if (!cycleIsOpen()) return { ok: false, message: 'Las reservas están cerradas por la administración.' };
    if (!room || !date || !start || !end) return { ok: false, message: 'Completa la fecha, el aula y las dos horas.' };
    if (date < state.cycle.reservation_start_date || date > state.cycle.reservation_end_date) return { ok: false, message: `La fecha debe estar entre ${formatDate(state.cycle.reservation_start_date)} y ${formatDate(state.cycle.reservation_end_date)}.` };
    if (date < localDateString()) return { ok: false, message: 'No se permiten reservas en fechas pasadas.' };
    if (dayName(date) === 'DOMINGO') return { ok: false, message: 'No se permiten reservas los domingos.' };
    if (start >= end) return { ok: false, message: 'La hora de finalización debe ser posterior a la hora de inicio.' };
    if (start < '07:00' || end > '21:00') return { ok: false, message: 'Las reservas deben realizarse entre las 07:00 y las 21:00.' };
    const fixed = baseConflict(room, date, start, end);
    if (fixed) return { ok: false, message: `El aula tiene una clase prioritaria de ${normalizeTime(fixed.start_time)} a ${normalizeTime(fixed.end_time)}: ${fixed.label}.` };
    const reserved = reservationConflict(room, date, start, end);
    if (reserved) return { ok: false, message: `Ya existe una reserva de ${normalizeTime(reserved.start_time)} a ${normalizeTime(reserved.end_time)}.` };
    return { ok: true, message: 'Horario disponible. Puedes guardar la reserva.' };
  }
  function updateAvailability() {
    const result = validateSlot({ room: elements.bookingRoom.value, date: elements.bookingDate.value, start: elements.bookingStart.value, end: elements.bookingEnd.value });
    elements.availabilityCheck.textContent = result.message;
    elements.availabilityCheck.classList.toggle('is-available', result.ok);
    elements.availabilityCheck.classList.toggle('is-conflict', !result.ok && Boolean(elements.bookingStart.value && elements.bookingEnd.value));
    elements.saveBookingButton.disabled = !result.ok || !isConfigured;
    return result;
  }
  function updateDialogAvailability() {
    const result = validateSlot({
      room: elements.dialogBookingRoom.value,
      date: elements.dialogBookingDate.value,
      start: elements.dialogBookingStart.value,
      end: elements.dialogBookingEnd.value
    });
    elements.dialogAvailabilityCheck.textContent = result.message;
    elements.dialogAvailabilityCheck.classList.toggle('is-available', result.ok);
    elements.dialogAvailabilityCheck.classList.toggle('is-conflict', !result.ok);
    elements.saveDialogBookingButton.disabled = !result.ok || !isConfigured;
    return result;
  }

  function roomOptions(all = false) { return (all ? '<option value="TODAS">Todas</option>' : '<option value="">Selecciona un aula</option>') + state.rooms.map((room) => `<option value="${escapeHtml(room.code)}">${escapeHtml(roomDisplayName(room.code))}</option>`).join(''); }
  function populateRoomSelects() {
    elements.bookingRoom.innerHTML = roomOptions();
    elements.dialogBookingRoom.innerHTML = roomOptions();
    elements.editorRoom.innerHTML = state.rooms.map((room) => `<option value="${escapeHtml(room.code)}">${escapeHtml(roomDisplayName(room.code))}</option>`).join('');
    elements.scheduleEntryRoom.innerHTML = state.rooms.map((room) => `<option value="${escapeHtml(room.code)}">${escapeHtml(roomDisplayName(room.code))}</option>`).join('');
  }
  function dateBadge(value) { const date = new Date(`${value}T12:00:00`); return `<span class="booking-date"><strong>${String(date.getDate()).padStart(2, '0')}</strong><span>${monthNames[date.getMonth()]}</span></span>`; }
  function reservationCard(item, controls = false) {
    const canCancel = controls && (isAdmin() || item.user_id === state.session?.user?.id);
    const action = canCancel ? `<button class="danger-button" type="button" data-cancel-reservation="${escapeHtml(item.id)}">Cancelar</button>` : `<span class="reservation-time">${normalizeTime(item.start_time)}–${normalizeTime(item.end_time)}</span>`;
    const roomName = item.classrooms?.code ? roomDisplayName(item.classrooms.code) : 'Aula';
    return `<article class="${controls ? 'booking-item' : 'reservation-item'}">${controls ? dateBadge(item.reservation_date) : `<span class="room-pill">${escapeHtml(roomName)}</span>`}<div class="booking-copy"><strong>${escapeHtml(item.activity)}</strong><span>${controls ? `${escapeHtml(roomName)} · ` : `${escapeHtml(item.professor_name)} · `}${normalizeTime(item.start_time)}–${normalizeTime(item.end_time)}${controls ? '' : ` · ${formatDate(item.reservation_date)}`}</span></div>${action}</article>`;
  }
  function timeToMinutes(time) { const [hours, minutes] = normalizeTime(time).split(':').map(Number); return hours * 60 + minutes; }
  function minutesToTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
  function openBookingDialog(button) {
    elements.bookingDialogForm.reset();
    elements.dialogBookingDate.value = button.dataset.reserveDate || elements.bookingDate.value || initialDate();
    elements.dialogBookingRoom.value = button.dataset.reserveRoom;
    elements.dialogBookingStart.value = button.dataset.reserveStart;
    elements.dialogBookingEnd.value = button.dataset.reserveEnd;
    if (isAdmin() && elements.bookingProfessor.value) elements.dialogBookingProfessor.value = elements.bookingProfessor.value;
    updateDialogAvailability();
    if (!elements.bookingDialog.open) elements.bookingDialog.showModal();
    window.setTimeout(() => elements.dialogBookingActivity.focus(), 80);
  }
  function closeBookingDialog() { elements.bookingDialog.close(); }
  function renderMyReservations() {
    if (!state.session) return;
    const list = state.reservations.filter((item) => item.status === 'active' && item.user_id === state.session.user.id && item.reservation_date >= localDateString()).sort((a, b) => a.reservation_date.localeCompare(b.reservation_date) || a.start_time.localeCompare(b.start_time));
    elements.myBookingsList.innerHTML = list.length ? list.map((item) => reservationCard(item, true)).join('') : '<p class="empty-state">No tienes reservas próximas.</p>';
  }
  function renderAdminReservations() {
    if (!isAdmin()) return;
    const list = state.reservations.filter((item) => item.status === 'active' && item.reservation_date >= localDateString()).sort((a, b) => a.reservation_date.localeCompare(b.reservation_date) || a.start_time.localeCompare(b.start_time));
    elements.adminBookingsList.innerHTML = list.length ? list.map((item) => reservationCard(item, true)).join('') : '<p class="empty-state">No hay reservas activas.</p>';
  }
  function renderSession() {
    const loggedIn = Boolean(state.session && state.profile);
    elements.headerAccount.hidden = !loggedIn;
    elements.userView.hidden = !loggedIn; elements.scheduleBrowser.hidden = !loggedIn; elements.adminPanel.hidden = !loggedIn || !isAdmin();
    if (!loggedIn) return;
    elements.currentUserName.textContent = state.profile.full_name;
    elements.currentUserRole.textContent = isSuperadmin() ? 'Superadministrador' : isAdmin() ? 'Administrador de reservas' : 'Docente';
    elements.adminProfessorField.hidden = !isAdmin();
    elements.dialogAdminProfessorField.hidden = !isAdmin();
    elements.adminAccessLabel.textContent = isSuperadmin() ? 'Acceso de superadministrador' : 'Acceso de administración de reservas';
    elements.scheduleEditorTitle.textContent = isAdmin() ? 'Horario, reservas y ocupación académica' : 'Disponibilidad semanal por aula';
    elements.scheduleEditorDescription.textContent = isAdmin()
      ? 'Selecciona una semana y un aula. Puedes reservar espacios libres y gestionar directamente la ocupación académica.'
      : 'Selecciona una semana y un aula. Pulsa “Reservar” directamente en el espacio que necesitas.';
    document.querySelectorAll('.superadmin-only').forEach((element) => { element.hidden = !isSuperadmin(); });
    renderCycle(); renderMyReservations(); renderAdminReservations();
  }
  function populateTeacherSelect() {
    const options = state.teachers.length
      ? state.teachers.map((teacher) => `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.full_name)}</option>`).join('')
      : '<option value="">No hay docentes activos</option>';
    elements.bookingProfessor.innerHTML = options;
    elements.dialogBookingProfessor.innerHTML = options;
    elements.scheduleProfessorOptions.innerHTML = state.teachers
      .map((teacher) => `<option value="${escapeHtml(teacher.full_name)}"></option>`)
      .join('');
  }
  function freeScheduleGaps(records, shiftStart, shiftEnd) {
    const start = timeToMinutes(shiftStart), end = timeToMinutes(shiftEnd);
    const intervals = records
      .map((item) => ({ start: Math.max(start, timeToMinutes(item.start_time)), end: Math.min(end, timeToMinutes(item.end_time)) }))
      .filter((item) => item.start < item.end)
      .sort((a, b) => a.start - b.start);
    const gaps = []; let cursor = start;
    intervals.forEach((item) => {
      if (cursor < item.start) gaps.push({ start: cursor, end: item.start });
      cursor = Math.max(cursor, item.end);
    });
    if (cursor < end) gaps.push({ start: cursor, end });
    return gaps;
  }
  function dateForWeekDay(referenceDate, dayId) {
    const date = new Date(`${referenceDate}T12:00:00`);
    const currentDay = date.getDay() || 7;
    date.setDate(date.getDate() - currentDay + dayId);
    return localDateString(date);
  }
  function bindWeeklyActions() {
    elements.weeklyEditor.querySelectorAll('[data-reserve-room]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openBookingDialog(button);
      });
    });
    elements.weeklyEditor.querySelectorAll('[data-add-occupancy]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openScheduleDialog(null, {
          room: button.dataset.room,
          day: button.dataset.day,
          start: button.dataset.start,
          end: button.dataset.end
        });
      });
    });
  }
  function renderWeeklyEditor() {
    if (!state.profile || !state.cycle || !elements.editorRoom.value || !elements.editorWeek.value) return;
    const room = elements.editorRoom.value;
    const days = [{ id: 1, label: 'Lunes' }, { id: 2, label: 'Martes' }, { id: 3, label: 'Miércoles' }, { id: 4, label: 'Jueves' }, { id: 5, label: 'Viernes' }, { id: 6, label: 'Sábado' }]
      .map((day) => ({ ...day, date: dateForWeekDay(elements.editorWeek.value, day.id) }));
    const shifts = [
      { id: 'morning', label: 'Mañana', detail: '07:00–13:00', start: '07:00', end: '13:00' },
      { id: 'afternoon', label: 'Tarde', detail: '13:00–16:30', start: '13:00', end: '16:30' },
      { id: 'night', label: 'Noche', detail: '16:30–21:00', start: '16:30', end: '21:00' }
    ];
    const header = `<div class="weekly-editor-cell weekly-editor-header">Jornada</div>${days.map((day) => `<div class="weekly-editor-cell weekly-editor-header"><strong>${day.label}</strong><span>${formatDate(day.date)}</span></div>`).join('')}`;
    const rows = shifts.map((shift) => {
      const cells = days.map((day) => {
        const inCycle = day.date >= state.cycle.reservation_start_date && day.date <= state.cycle.reservation_end_date;
        if (!inCycle) return '<div class="weekly-editor-cell is-outside-cycle"><span class="no-gap">Fuera del periodo</span></div>';
        const fixedForDay = day.date <= state.cycle.academic_schedule_end_date
          ? state.fixedOccupancies.filter((item) => item.classrooms?.code === room && item.day_of_week === day.id)
          : [];
        const reservationsForDay = state.reservations.filter((item) => item.classrooms?.code === room && item.reservation_date === day.date && item.status === 'active');
        const fixedRecords = fixedForDay.filter((item) => overlaps(item.start_time, item.end_time, shift.start, shift.end));
        const reservationRecords = reservationsForDay.filter((item) => overlaps(item.start_time, item.end_time, shift.start, shift.end));
        const isFutureDate = day.date >= localDateString();
        const gapButtons = freeScheduleGaps([...fixedForDay, ...reservationsForDay], shift.start, shift.end).map((gap) => {
          const start = minutesToTime(gap.start), end = minutesToTime(gap.end);
          const reserveAction = isFutureDate
            ? `<button class="add-occupancy" type="button" data-reserve-room="${escapeHtml(room)}" data-reserve-date="${day.date}" data-reserve-start="${start}" data-reserve-end="${end}">Reservar ${start}–${end}</button>`
            : `<span class="available-gap">${start}–${end} · Disponible</span>`;
          const academicAction = isAdmin()
            ? `<button class="academic-gap-action" type="button" data-add-occupancy data-room="${escapeHtml(room)}" data-day="${day.id}" data-start="${start}" data-end="${end}">Crear ocupación académica</button>`
            : '';
          return `<div class="gap-actions">${reserveAction}${academicAction}</div>`;
        }).join('');
        const fixedCards = fixedRecords.map((item) => {
          const heading = item.course_code || item.course_name || item.professor_name || item.label;
          const details = [
            item.course_name && item.course_name !== heading ? `<span class="occupancy-course">${escapeHtml(item.course_name)}</span>` : '',
            item.professor_name && item.professor_name !== heading ? `<span class="occupancy-professor">${escapeHtml(item.professor_name)}</span>` : '',
            item.group_code || item.nrc ? `<span class="occupancy-meta">${item.group_code ? `Grupo ${escapeHtml(item.group_code)}` : ''}${item.group_code && item.nrc ? ' · ' : ''}${item.nrc ? `NRC ${escapeHtml(item.nrc)}` : ''}</span>` : ''
          ].join('');
          const controls = isAdmin() ? `<div class="occupancy-actions"><button class="edit-occupancy" type="button" data-edit-occupancy="${item.id}">Editar</button><button class="delete-occupancy" type="button" data-delete-occupancy="${item.id}">Eliminar</button></div>` : '';
          return `<article class="occupancy-card"><strong>${escapeHtml(heading)}</strong>${details}<span class="occupancy-time">${normalizeTime(item.start_time)}–${normalizeTime(item.end_time)}</span>${controls}</article>`;
        }).join('');
        const reservationCards = reservationRecords.map((item) => {
          const canCancel = isAdmin() || item.user_id === state.session?.user?.id;
          return `<article class="occupancy-card weekly-reservation-card"><span class="reservation-kind">Reserva</span><strong>${escapeHtml(item.activity)}</strong><span>${escapeHtml(item.professor_name)}</span><span class="occupancy-time">${normalizeTime(item.start_time)}–${normalizeTime(item.end_time)}</span>${canCancel ? `<div class="occupancy-actions"><button class="delete-occupancy" type="button" data-cancel-reservation="${escapeHtml(item.id)}">Cancelar</button></div>` : ''}</article>`;
        }).join('');
        return `<div class="weekly-editor-cell">${fixedCards}${reservationCards}${gapButtons || '<span class="no-gap">Sin espacio libre</span>'}</div>`;
      }).join('');
      return `<div class="weekly-editor-cell weekly-editor-header weekly-editor-shift"><strong>${shift.label}</strong><span>${shift.detail}</span></div>${cells}`;
    }).join('');
    elements.weeklyEditor.innerHTML = header + rows;
    bindWeeklyActions();
  }
  function openScheduleDialog(record = null, defaults = {}) {
    elements.scheduleEntryForm.reset();
    elements.scheduleEntryId.value = record?.id || '';
    elements.scheduleEntryRoom.value = record?.classrooms?.code || defaults.room || elements.editorRoom.value;
    elements.scheduleEntryDay.value = String(record?.day_of_week || defaults.day || 1);
    elements.scheduleEntryStart.value = normalizeTime(record?.start_time || defaults.start || '08:00');
    elements.scheduleEntryEnd.value = normalizeTime(record?.end_time || defaults.end || '09:00');
    elements.scheduleEntryProfessor.value = record?.professor_name || '';
    elements.scheduleEntryCourseCode.value = record?.course_code || '';
    elements.scheduleEntryCourseName.value = record?.course_name || '';
    elements.scheduleEntryNrc.value = record?.nrc || '';
    elements.scheduleEntryGroup.value = record?.group_code || '';
    elements.scheduleDialogTitle.textContent = record ? 'Editar ocupación' : 'Reservar espacio';
    elements.scheduleDialog.showModal();
    window.setTimeout(() => elements.scheduleEntryCourseName.focus(), 80);
  }
  function closeScheduleEditor() { elements.scheduleDialog.close(); }
  async function saveScheduleEntry(event) {
    event.preventDefault(); clearMessage();
    const id = elements.scheduleEntryId.value ? Number(elements.scheduleEntryId.value) : null;
    setBusy(elements.saveScheduleEntryButton, true, 'Guardando…');
    try {
      const { error } = await state.client.rpc('admin_upsert_fixed_occupancy', {
        p_id: id,
        p_classroom_code: elements.scheduleEntryRoom.value,
        p_day: Number(elements.scheduleEntryDay.value),
        p_start: elements.scheduleEntryStart.value,
        p_end: elements.scheduleEntryEnd.value,
        p_professor_name: elements.scheduleEntryProfessor.value.trim(),
        p_course_code: elements.scheduleEntryCourseCode.value.trim(),
        p_course_name: elements.scheduleEntryCourseName.value.trim(),
        p_nrc: elements.scheduleEntryNrc.value.trim(),
        p_group_code: elements.scheduleEntryGroup.value.trim()
      });
      if (error) throw error;
      closeScheduleEditor();
      await loadFixedOccupancies();
      renderWeeklyEditor();
      showMessage(id ? 'Ocupación actualizada correctamente.' : 'Ocupación añadida correctamente.');
    } catch (error) { showMessage(error.message, 'error'); }
    finally { setBusy(elements.saveScheduleEntryButton, false); }
  }
  async function deleteScheduleEntry(id) {
    if (!window.confirm('¿Deseas eliminar esta ocupación académica?')) return;
    clearMessage();
    const { error } = await state.client.rpc('admin_delete_fixed_occupancy', { p_id: Number(id) });
    if (error) return showMessage(error.message, 'error');
    await loadFixedOccupancies();
    renderWeeklyEditor();
    showMessage('Ocupación eliminada correctamente.');
  }

  async function loadRooms() { const { data, error } = await state.client.from('classrooms').select('id,code,name').eq('active', true).order('sort_order'); if (error) throw error; if (data?.length) state.rooms = data; populateRoomSelects(); }
  async function loadCycle() {
    const { data, error } = await state.client.from('reservation_cycles').select('*').eq('is_current', true).maybeSingle();
    if (error) throw error;
    state.cycle = data || null; renderCycle();
  }
  async function loadFixedOccupancies() {
    if (!state.cycle) { state.fixedOccupancies = []; return; }
    const { data, error } = await state.client.from('fixed_occupancies').select('id,day_of_week,start_time,end_time,label,professor_name,course_code,course_name,nrc,group_code,classrooms(code)').eq('cycle_id', state.cycle.id).order('day_of_week').order('start_time');
    if (error) throw error; state.fixedOccupancies = data || []; renderWeeklyEditor();
  }
  async function loadTeachers() {
    if (!isAdmin()) { state.teachers = []; populateTeacherSelect(); return; }
    const { data, error } = await state.client.from('profiles').select('id,full_name').eq('role', 'teacher').eq('active', true).order('full_name');
    if (error) throw error;
    state.teachers = data || [];
    populateTeacherSelect();
  }
  async function loadReservations() {
    if (!state.cycle) { state.reservations = []; return; }
    const { data, error } = await state.client.from('reservations').select('id,user_id,classroom_id,reservation_date,start_time,end_time,activity,professor_name,status,created_at,classrooms(code,name)').eq('cycle_id', state.cycle.id).eq('status', 'active').order('reservation_date').order('start_time');
    if (error) throw error; state.reservations = data || []; renderWeeklyEditor(); renderMyReservations(); renderAdminReservations(); updateAvailability();
  }
  async function loadProfile() {
    if (!state.session) { state.profile = null; renderSession(); return; }
    const { data, error } = await state.client.from('profiles').select('id,full_name,email,role,admin_scope,active').eq('id', state.session.user.id).single();
    if (error) throw error;
    if (!data.active) { await state.client.auth.signOut(); throw new Error('Esta cuenta está desactivada. Contacta a la administración.'); }
    state.profile = data; renderSession();
  }
  async function loadVisitStats() {
    if (!isSuperadmin()) return;
    const { data, error } = await state.client.rpc('get_page_visit_stats', { p_page_key: 'ocupacionaulas' });
    if (error) {
      elements.visitTodayCount.textContent = '—';
      elements.visitTotalCount.textContent = '—';
      return;
    }
    const stats = Array.isArray(data) ? data[0] : data;
    elements.visitTodayCount.textContent = Number(stats?.today_count || 0).toLocaleString('es-CR');
    elements.visitTotalCount.textContent = Number(stats?.total_count || 0).toLocaleString('es-CR');
  }
  async function reloadAll() { await loadCycle(); await loadFixedOccupancies(); await loadTeachers(); await loadReservations(); await loadVisitStats(); }
  async function signOut() { clearMessage(); await state.client.auth.signOut(); window.location.replace('ingreso.html?v=7'); }

  async function saveReservation(event) {
    event.preventDefault(); clearMessage();
    const slot = { room: elements.bookingRoom.value, date: elements.bookingDate.value, start: elements.bookingStart.value, end: elements.bookingEnd.value };
    const validation = validateSlot(slot); if (!validation.ok) { showMessage(validation.message, 'error'); return; }
    const room = state.rooms.find((item) => item.code === slot.room); if (!room?.id) { showMessage('No se encontró el aula seleccionada.', 'error'); return; }
    if (isAdmin() && !elements.bookingProfessor.value) { showMessage('Selecciona el profesor para quien se realizará la reserva.', 'error'); return; }
    setBusy(elements.saveBookingButton, true, 'Guardando…');
    try {
      const request = isAdmin()
        ? await state.client.rpc('admin_create_reservation', {
          p_user_id: elements.bookingProfessor.value,
          p_classroom_id: room.id,
          p_date: slot.date,
          p_start: slot.start,
          p_end: slot.end,
          p_activity: elements.bookingActivity.value.trim()
        })
        : await state.client.from('reservations').insert({ cycle_id: state.cycle.id, user_id: state.session.user.id, classroom_id: room.id, reservation_date: slot.date, start_time: slot.start, end_time: slot.end, activity: elements.bookingActivity.value.trim(), professor_name: state.profile.full_name });
      const { error } = request;
      if (error) throw error;
      elements.bookingForm.reset(); elements.bookingDate.value = initialDate(); elements.bookingStart.value = '08:00'; elements.bookingEnd.value = '09:00'; await loadReservations(); showMessage('Reserva guardada correctamente.');
    } catch (error) { showMessage(error.code === '23P01' ? 'El aula ya está ocupada en ese horario.' : error.message, 'error'); }
    finally { setBusy(elements.saveBookingButton, false); updateAvailability(); }
  }
  async function saveDialogReservation(event) {
    event.preventDefault(); clearMessage();
    const slot = {
      room: elements.dialogBookingRoom.value,
      date: elements.dialogBookingDate.value,
      start: elements.dialogBookingStart.value,
      end: elements.dialogBookingEnd.value
    };
    const validation = updateDialogAvailability();
    if (!validation.ok) return;
    const activity = elements.dialogBookingActivity.value.trim();
    if (activity.length < 3) {
      elements.dialogAvailabilityCheck.textContent = 'Describe la actividad que se realizará.';
      elements.dialogAvailabilityCheck.classList.remove('is-available');
      elements.dialogAvailabilityCheck.classList.add('is-conflict');
      return;
    }
    const room = state.rooms.find((item) => item.code === slot.room);
    if (!room?.id) {
      elements.dialogAvailabilityCheck.textContent = 'No se encontró el aula seleccionada.';
      elements.dialogAvailabilityCheck.classList.add('is-conflict');
      return;
    }
    if (isAdmin() && !elements.dialogBookingProfessor.value) {
      elements.dialogAvailabilityCheck.textContent = 'Selecciona el profesor para quien se realizará la reserva.';
      elements.dialogAvailabilityCheck.classList.add('is-conflict');
      return;
    }
    setBusy(elements.saveDialogBookingButton, true, 'Guardando…');
    try {
      const request = isAdmin()
        ? await state.client.rpc('admin_create_reservation', {
          p_user_id: elements.dialogBookingProfessor.value,
          p_classroom_id: room.id,
          p_date: slot.date,
          p_start: slot.start,
          p_end: slot.end,
          p_activity: activity
        })
        : await state.client.from('reservations').insert({
          cycle_id: state.cycle.id,
          user_id: state.session.user.id,
          classroom_id: room.id,
          reservation_date: slot.date,
          start_time: slot.start,
          end_time: slot.end,
          activity,
          professor_name: state.profile.full_name
        });
      const { error } = request;
      if (error) throw error;
      closeBookingDialog();
      await loadReservations();
      showMessage('Reserva guardada correctamente.');
    } catch (error) {
      elements.dialogAvailabilityCheck.textContent = error.code === '23P01' ? 'El aula ya está ocupada en ese horario.' : error.message;
      elements.dialogAvailabilityCheck.classList.remove('is-available');
      elements.dialogAvailabilityCheck.classList.add('is-conflict');
    } finally {
      setBusy(elements.saveDialogBookingButton, false);
    }
  }
  async function cancelReservation(id) { if (!window.confirm('¿Deseas cancelar esta reserva?')) return; clearMessage(); const { error } = await state.client.from('reservations').update({ status: 'cancelled' }).eq('id', id); if (error) return showMessage(error.message, 'error'); await loadReservations(); showMessage('La reserva fue cancelada.'); }
  function clearPasswordMessage() {
    elements.passwordMessage.hidden = true;
    elements.passwordMessage.textContent = '';
    elements.passwordMessage.className = 'form-message';
  }
  function showPasswordMessage(message) {
    elements.passwordMessage.textContent = message;
    elements.passwordMessage.className = 'form-message is-error';
    elements.passwordMessage.hidden = false;
  }
  function openPasswordEditor() {
    elements.changePasswordForm.reset();
    clearPasswordMessage();
    if (!elements.passwordDialog.open) elements.passwordDialog.showModal();
    window.setTimeout(() => elements.newPassword.focus(), 80);
  }
  function closePasswordEditor() {
    elements.changePasswordForm.reset();
    clearPasswordMessage();
    elements.passwordDialog.close();
  }
  async function changePassword(event) {
    event.preventDefault(); clearMessage(); clearPasswordMessage();
    const password = elements.newPassword.value;
    if (!strongPasswordPattern.test(password)) return showPasswordMessage('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.');
    if (password !== elements.confirmPassword.value) return showPasswordMessage('Las contraseñas no coinciden.');
    const button = elements.changePasswordForm.querySelector('button[type="submit"]');
    setBusy(button, true, 'Actualizando…');
    try {
      const { error } = await state.client.auth.updateUser({ password });
      if (error) throw error;
      elements.changePasswordForm.reset();
      elements.passwordDialog.close();
      showMessage('Contraseña actualizada correctamente.');
    } catch (error) { showPasswordMessage(error.message); }
    finally { setBusy(button, false); }
  }
  async function createUser(event) {
    event.preventDefault(); clearMessage(); clearCreateUserMessage();
    const button = elements.createUserForm.querySelector('button[type="submit"]');
    const form = new FormData(elements.createUserForm);
    const fullName = String(form.get('name')).trim();
    const email = String(form.get('email')).trim().toLowerCase();
    const password = String(form.get('password'));
    if (fullName.length < 3) return showCreateUserMessage('Ingresa el nombre completo del usuario.', 'error');
    if (!teacherEmailPattern.test(email)) return showCreateUserMessage('El correo debe tener el formato nombre.apellido.apellido@una.cr.', 'error');
    if (!strongPasswordPattern.test(password)) return showCreateUserMessage('La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.', 'error');
    setBusy(button, true, 'Creando…');
    try {
      const { data, error } = await state.client.functions.invoke('admin-create-user', { body: { fullName, email, password, role: String(form.get('role')) } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No fue posible crear la cuenta.');
      elements.createUserForm.reset();
      await loadTeachers();
      showCreateUserMessage('Usuario creado exitosamente');
    } catch (error) { showCreateUserMessage(error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  async function workbookRows(file) {
    if (!window.XLSX) throw new Error('No fue posible cargar el lector de Excel. Recarga la página e inténtalo de nuevo.');
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!worksheet) throw new Error('El archivo de Excel no contiene hojas.');
    return window.XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
  }

  async function parseTeacherWorkbook(file) {
    const rows = await workbookRows(file);
    if (!rows.length) throw new Error('El archivo no contiene cuentas para crear.');
    const seen = new Set();
    return rows.map((source, index) => {
      const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [normalizeHeader(key), String(value).trim()]));
      const fullName = row.nombre_completo || row.nombre || '';
      const email = (row.correo_electronico || row.correo || row.email || '').toLowerCase();
      const password = row.contrasena_temporal || row.contrasena || '';
      if (fullName.length < 3) throw new Error(`Revisa el nombre completo en la fila ${index + 2}.`);
      if (!teacherEmailPattern.test(email)) throw new Error(`Revisa el correo institucional en la fila ${index + 2}.`);
      if (password && !strongPasswordPattern.test(password)) throw new Error(`La contraseña de la fila ${index + 2} debe tener 8 caracteres, una mayúscula y un número.`);
      if (seen.has(email)) throw new Error(`El correo ${email} está repetido en el archivo.`);
      seen.add(email);
      return { fullName, email, password, role: 'teacher' };
    });
  }

  async function uploadUsers() {
    clearMessage();
    const file = elements.usersFile.files[0];
    if (!file) return showMessage('Selecciona primero el archivo de cuentas docentes.', 'error');
    setBusy(elements.uploadUsersButton, true, 'Creando cuentas…');
    try {
      const users = await parseTeacherWorkbook(file);
      const { data, error } = await state.client.functions.invoke('admin-create-user', { body: { users } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No fue posible procesar las cuentas.');
      const failures = (data.results || []).filter((result) => !result.ok);
      elements.usersFileSummary.textContent = `${data.createdCount || 0} cuentas creadas${failures.length ? `; ${failures.length} no se pudieron crear` : ''}.`;
      const authorized = data.authorizedCount || 0;
      showMessage(failures.length ? `Carga finalizada con observaciones: ${failures.map((item) => `${item.email}: ${item.error}`).join(' · ')}` : `Carga finalizada: ${data.createdCount || 0} cuentas creadas y ${authorized} docentes autorizados para registrarse.`, failures.length ? 'error' : 'success');
    } catch (error) { showMessage(error.message, 'error'); }
    finally { setBusy(elements.uploadUsersButton, false); }
  }

  async function configureCycle(event) {
    event.preventDefault(); clearMessage(); const button = elements.cycleForm.querySelector('button[type="submit"]'); setBusy(button, true, 'Guardando…');
    const form = new FormData(elements.cycleForm);
    try {
      const { error } = await state.client.rpc('admin_configure_cycle', { p_name: String(form.get('name')).trim(), p_reservation_start: form.get('reservationStart'), p_reservation_end: form.get('reservationEnd'), p_academic_end: form.get('academicEnd'), p_opens_at: new Date(String(form.get('opensAt'))).toISOString(), p_closes_at: new Date(String(form.get('closesAt'))).toISOString() });
      if (error) throw error; await reloadAll(); showMessage('Ciclo configurado. Permanece cerrado hasta cargar la ocupación y abrirlo manualmente.');
    } catch (error) { showMessage(error.message, 'error'); } finally { setBusy(button, false); }
  }

  function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) throw new Error('El archivo no contiene registros.');
    const separator = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(separator).map(normalizeHeader);
    const required = ['aula', 'dia', 'hora_inicio', 'hora_fin'];
    if (required.some((name) => !headers.includes(name))) throw new Error(`La plantilla debe incluir: ${required.join(', ')}.`);
    return lines.slice(1).map((line, index) => {
      const values = line.split(separator).map((item) => item.trim()); const row = Object.fromEntries(headers.map((key, i) => [key, values[i] || '']));
      const dayKey = row.dia.toUpperCase(); const day = /^\d$/.test(dayKey) ? Number(dayKey) : dayMap[dayKey];
      const entry = scheduleRow(row);
      if (!roomCodes.includes(row.aula) || !Number.isInteger(day) || day < 1 || day > 6 || !/^\d{2}:\d{2}$/.test(row.hora_inicio) || !/^\d{2}:\d{2}$/.test(row.hora_fin) || !entry.detalle) throw new Error(`Revisa la fila ${index + 2} del archivo.`);
      return { ...entry, aula: row.aula, dia: day, hora_inicio: row.hora_inicio, hora_fin: row.hora_fin };
    });
  }
  function scheduleRow(row) {
    const profesor = row.profesor || row.profesor_o_responsable || '';
    const codigo = row.codigo || row.codigo_del_curso || '';
    const curso = row.curso || row.nombre_del_curso || row.nombre_del_curso_o_actividad || '';
    const nrc = row.nrc || '';
    const grupo = row.grupo || '';
    const detalle = row.detalle || [codigo, profesor].filter(Boolean).join(' · ') || curso || profesor;
    return { detalle, profesor, codigo, curso, nrc, grupo };
  }
  async function parseScheduleFile(file) {
    if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
    const rows = await workbookRows(file);
    if (!rows.length) throw new Error('El archivo no contiene registros de ocupación.');
    return rows.map((source, index) => {
      const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [normalizeHeader(key), String(value).trim()]));
      const room = row.aula || '';
      const dayKey = String(row.dia || '').toUpperCase();
      const day = /^\d$/.test(dayKey) ? Number(dayKey) : dayMap[dayKey];
      const start = normalizeClock(row.hora_inicio);
      const end = normalizeClock(row.hora_fin);
      const entry = scheduleRow(row);
      if (!roomCodes.includes(room) || !Number.isInteger(day) || day < 1 || day > 6 || !start || !end || start >= end || !entry.detalle) {
        throw new Error(`Revisa la fila ${index + 2} del archivo de ocupación.`);
      }
      return { ...entry, aula: room, dia: day, hora_inicio: start, hora_fin: end };
    });
  }
  async function uploadSchedule() {
    clearMessage(); const file = elements.scheduleFile.files[0]; if (!file) return showMessage('Selecciona primero el archivo de ocupación.', 'error');
    setBusy(elements.uploadScheduleButton, true, 'Cargando…');
    try { const entries = await parseScheduleFile(file); const { data, error } = await state.client.rpc('admin_replace_fixed_occupancies', { p_entries: entries }); if (error) throw error; await reloadAll(); showMessage(`Ocupación académica cargada: ${data} registros. Las reservas permanecen cerradas.`); }
    catch (error) { showMessage(error.message, 'error'); } finally { setBusy(elements.uploadScheduleButton, false); }
  }
  async function toggleReservations() {
    clearMessage(); const enable = !state.cycle?.reservations_enabled; setBusy(elements.toggleReservationsButton, true, enable ? 'Abriendo…' : 'Cerrando…');
    try { const { error } = await state.client.rpc('admin_set_reservations_enabled', { p_enabled: enable }); if (error) throw error; await reloadAll(); showMessage(enable ? 'Reservas habilitadas para el ciclo vigente.' : 'Reservas cerradas. No se aceptarán nuevos registros.'); }
    catch (error) { showMessage(error.message, 'error'); } finally { setBusy(elements.toggleReservationsButton, false); renderCycle(); }
  }

  function bindEvents() {
    elements.logoutButton.addEventListener('click', signOut); elements.bookingForm.addEventListener('submit', saveReservation); elements.createUserForm.addEventListener('submit', createUser); elements.cycleForm.addEventListener('submit', configureCycle);
    elements.changePasswordForm.addEventListener('submit', changePassword); elements.uploadUsersButton.addEventListener('click', uploadUsers);
    elements.openPasswordDialog.addEventListener('click', openPasswordEditor);
    elements.closePasswordDialog.addEventListener('click', closePasswordEditor);
    elements.cancelPasswordDialog.addEventListener('click', closePasswordEditor);
    elements.editorRoom.addEventListener('change', renderWeeklyEditor);
    elements.editorWeek.addEventListener('change', renderWeeklyEditor);
    elements.bookingDialogForm.addEventListener('submit', saveDialogReservation);
    elements.closeBookingDialog.addEventListener('click', closeBookingDialog);
    elements.cancelBookingDialog.addEventListener('click', closeBookingDialog);
    elements.scheduleEntryForm.addEventListener('submit', saveScheduleEntry);
    elements.closeScheduleDialog.addEventListener('click', closeScheduleEditor);
    elements.cancelScheduleDialog.addEventListener('click', closeScheduleEditor);
    elements.uploadScheduleButton.addEventListener('click', uploadSchedule); elements.toggleReservationsButton.addEventListener('click', toggleReservations);
    elements.scheduleFile.addEventListener('change', () => { const label = document.querySelector('label[for="scheduleFile"]'); label.textContent = elements.scheduleFile.files[0]?.name || 'Seleccionar Excel'; label.classList.toggle('has-file', Boolean(elements.scheduleFile.files[0])); });
    elements.usersFile.addEventListener('change', async () => {
      const file = elements.usersFile.files[0];
      const label = document.querySelector('label[for="usersFile"]');
      label.textContent = file?.name || 'Seleccionar Excel';
      label.classList.toggle('has-file', Boolean(file));
      if (!file) { elements.usersFileSummary.textContent = 'Ningún archivo seleccionado.'; return; }
      try {
        const users = await parseTeacherWorkbook(file);
        elements.usersFileSummary.textContent = `${users.length} docentes listos para procesar. Las filas sin contraseña quedarán autorizadas para registrarse.`;
      } catch (error) { elements.usersFileSummary.textContent = error.message; }
    });
    elements.refreshButton.addEventListener('click', async () => { await reloadAll(); showMessage('Información actualizada.'); });
    [elements.bookingDate, elements.bookingRoom, elements.bookingStart, elements.bookingEnd].forEach((control) => { control.addEventListener('change', updateAvailability); control.addEventListener('input', updateAvailability); });
    [elements.dialogBookingDate, elements.dialogBookingRoom, elements.dialogBookingStart, elements.dialogBookingEnd].forEach((control) => { control.addEventListener('change', updateDialogAvailability); control.addEventListener('input', updateDialogAvailability); });
    document.addEventListener('click', (event) => {
      const cancelButton = event.target.closest('[data-cancel-reservation]');
      if (cancelButton) cancelReservation(cancelButton.dataset.cancelReservation);
      const editOccupancyButton = event.target.closest('[data-edit-occupancy]');
      if (editOccupancyButton) openScheduleDialog(state.fixedOccupancies.find((item) => String(item.id) === editOccupancyButton.dataset.editOccupancy));
      const deleteOccupancyButton = event.target.closest('[data-delete-occupancy]');
      if (deleteOccupancyButton) deleteScheduleEntry(deleteOccupancyButton.dataset.deleteOccupancy);
    });
  }

  async function initialize() {
    elements.bookingStart.value = '08:00'; elements.bookingEnd.value = '09:00'; elements.bookingDate.value = localDateString(); elements.editorWeek.value = localDateString(); populateRoomSelects(); bindEvents();
    if (!isConfigured || !window.supabase?.createClient) { elements.connectionStatus.textContent = 'Configuración pendiente'; elements.connectionStatus.classList.add('is-offline'); showMessage('El sistema está instalado. Falta conectar el proyecto de Supabase.', 'error'); return; }
    try {
      state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      elements.connectionStatus.textContent = 'Sistema disponible'; const { data } = await state.client.auth.getSession(); state.session = data.session;
      if (!state.session) { window.location.replace('ingreso.html?v=7'); return; }
      await loadProfile(); await loadRooms(); await reloadAll();
      state.client.auth.onAuthStateChange(async (_event, session) => { state.session = session; if (session) { await loadProfile(); await reloadAll(); } else window.location.replace('ingreso.html?v=7'); });
    } catch (error) { elements.connectionStatus.textContent = 'Conexión no disponible'; elements.connectionStatus.classList.add('is-offline'); showMessage(`No fue posible conectar con el sistema: ${error.message}`, 'error'); }
  }
  initialize();
})();
