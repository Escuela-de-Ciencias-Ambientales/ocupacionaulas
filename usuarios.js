(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.RESERVAS_CONFIG || {};
  const state = { client: null, session: null, profile: null, users: [], academics: { professors: [], courses: [] }, selectedAcademic: null, page: 1, pageSize: 15 };

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const isSuperadmin = () => state.profile?.role === 'admin' && state.profile?.admin_scope === 'superadmin';
  const accessType = (user) => {
    if (user.role !== 'admin') return 'teacher';
    if (user.admin_scope === 'superadmin') return 'superadmin';
    if (user.admin_scope === 'operations') return 'operations_admin';
    return user.admin_scope === 'conserjeria' ? 'conserjeria_admin' : 'reservation_admin';
  };
  const accessName = (user) => accessType(user) === 'superadmin' ? 'Superadministrador'
    : accessType(user) === 'operations_admin' ? 'Administrador operativo'
    : accessType(user) === 'reservation_admin' ? 'Administrador de reservas'
      : accessType(user) === 'conserjeria_admin' ? 'Administrador de conserjería' : 'Docente';
  const serviceAccessName = (user) => accessType(user) === 'superadmin' ? 'Todos los módulos actuales y futuros'
    : accessType(user) === 'operations_admin' ? 'Operación y trámite de servicios'
      : accessType(user) === 'reservation_admin' ? 'Administración de reservas'
        : accessType(user) === 'conserjeria_admin' ? 'Conserjería' : 'Aulas, vehículos y autorizaciones de equipos';
  const canEdit = (user) => isSuperadmin() || user.role === 'teacher' || user.id === state.profile?.id;
  const canManageAccess = (user) => isSuperadmin() || user.role === 'teacher';

  function setMessage(text, success = false) {
    const message = $('usersPageMessage');
    message.textContent = text;
    message.classList.toggle('is-error', !success);
    message.hidden = !text;
  }
  function setEditorMessage(text) {
    $('userEditorMessage').textContent = text;
    $('userEditorMessage').classList.add('is-error');
    $('userEditorMessage').hidden = !text;
  }
  function setBusy(button, busy, label = 'Procesando…') {
    if (busy) { button.dataset.label = button.textContent; button.textContent = label; button.disabled = true; }
    else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
  }

  function filteredUsers() {
    const search = $('usersSearch').value.trim().toLocaleLowerCase('es');
    const filter = $('usersStatusFilter').value;
    return state.users.filter((user) => {
      const searchMatch = !search || `${user.full_name} ${user.national_id || ''} ${user.email} ${user.unit || ''}`.toLocaleLowerCase('es').includes(search);
      const filterMatch = filter === 'all'
        || (filter === 'active' && user.active && !user.reservations_blocked)
        || (filter === 'blocked' && user.active && user.reservations_blocked)
        || (filter === 'inactive' && !user.active);
      return searchMatch && filterMatch;
    });
  }

  function renderSummary() {
    $('usersTotalCount').textContent = state.users.length.toLocaleString('es-CR');
    $('usersActiveCount').textContent = state.users.filter((user) => user.active).length.toLocaleString('es-CR');
    $('usersBlockedCount').textContent = state.users.filter((user) => user.active && user.reservations_blocked).length.toLocaleString('es-CR');
    $('usersInactiveCount').textContent = state.users.filter((user) => !user.active).length.toLocaleString('es-CR');
  }

  function renderTable() {
    const users = filteredUsers();
    const pages = Math.max(1, Math.ceil(users.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize;
    const pageUsers = users.slice(start, start + state.pageSize);

    $('usersTableBody').innerHTML = pageUsers.length ? pageUsers.map((user) => {
      const self = user.id === state.profile?.id;
      const editable = canEdit(user);
      const manageable = canManageAccess(user);
      const editButton = editable ? `<button class="secondary-button" type="button" data-edit-user="${user.id}">Editar</button>` : '';
      const blockButton = manageable && user.active && !self
        ? `<button class="secondary-button" type="button" data-user-action="${user.reservations_blocked ? 'unblock' : 'block'}" data-user-id="${user.id}">${user.reservations_blocked ? 'Habilitar' : 'Bloquear'}</button>` : '';
      const activeButton = manageable && !self
        ? `<button class="${user.active ? 'danger-button' : 'secondary-button'}" type="button" data-user-action="${user.active ? 'deactivate' : 'reactivate'}" data-user-id="${user.id}">${user.active ? 'Eliminar' : 'Reactivar'}</button>` : '';
      const protectedLabel = !editable && !manageable ? '<span class="user-badge">Protegido</span>' : '';
      const status = !user.active
        ? '<span class="user-badge is-inactive">Acceso eliminado</span>'
        : user.reservations_blocked
          ? `<span class="user-badge is-blocked">Reservas bloqueadas</span>${user.reservations_block_reason ? `<small>${escapeHtml(user.reservations_block_reason)}</small>` : ''}`
          : '<span class="user-badge">Activo</span>';
      return `<tr class="${!user.active ? 'is-inactive' : user.reservations_blocked ? 'is-blocked' : ''}">
        <td data-label="Usuario"><div class="user-identity"><strong>${escapeHtml(user.full_name)}${self ? ' · Tú' : ''}</strong><span>${escapeHtml(user.email)}</span></div></td>
        <td data-label="Cédula"><strong>${escapeHtml(user.national_id || 'Pendiente')}</strong></td>
        <td data-label="Unidad"><span class="user-badge">${escapeHtml(user.unit || 'Pendiente')}</span></td>
        <td data-label="Tipo de acceso"><span class="user-badge${user.role === 'admin' ? ' is-admin' : ''}">${escapeHtml(accessName(user))}</span></td>
        <td data-label="Servicios"><small class="service-access">${escapeHtml(serviceAccessName(user))}</small></td>
        <td data-label="Estado"><div class="user-status-stack">${status}</div></td>
        <td data-label="Acciones"><div class="user-row-actions">${editButton}${blockButton}${activeButton}${protectedLabel}</div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7">No hay usuarios que coincidan con los filtros.</td></tr>';

    $('usersPageIndicator').textContent = `Página ${state.page} de ${pages} · ${users.length} usuarios`;
    $('previousUsersPage').disabled = state.page <= 1;
    $('nextUsersPage').disabled = state.page >= pages;
  }

  async function loadUsers() {
    const { data, error } = await state.client.from('profiles')
      .select('id,full_name,national_id,email,unit,role,admin_scope,active,reservations_blocked,reservations_block_reason,created_at')
      .order('full_name');
    if (error) throw error;
    state.users = data || [];
    renderSummary();
    renderTable();
  }

  function academicAccount(professor) {
    return state.users.find((user) => String(user.email || '').toLocaleLowerCase('es') === String(professor.email || '').toLocaleLowerCase('es'));
  }
  function filteredAcademics() {
    const search = $('academicsSearch').value.trim().toLocaleLowerCase('es');
    return (state.academics.professors || []).filter((professor) => !search || `${professor.full_name} ${professor.national_id || ''} ${professor.email || ''} ${(professor.courses || []).map((course) => `${course.course_code} ${course.course_name} ${course.nrc}`).join(' ')}`.toLocaleLowerCase('es').includes(search));
  }
  function renderAcademics() {
    const professors = filteredAcademics();
    $('academicsTableBody').innerHTML = professors.length ? professors.map((professor) => {
      const account = academicAccount(professor);
      const courses = professor.courses || [];
      return `<tr class="${professor.active ? '' : 'is-inactive'}">
        <td data-label="Académico"><div class="user-identity"><strong>${escapeHtml(professor.full_name)}</strong><span>${escapeHtml(professor.email || 'Sin correo')}</span></div></td>
        <td data-label="Cédula"><strong>${escapeHtml(professor.national_id || 'Pendiente')}</strong></td>
        <td data-label="Estado de cuenta"><span class="user-badge${account ? '' : ' is-inactive'}">${account ? 'Cuenta registrada' : 'Pendiente de registro'}</span></td>
        <td data-label="Cursos asignados"><div class="academic-course-chips">${courses.length ? courses.map((course) => `<span class="academic-course-chip">${escapeHtml(course.course_code)} · ${escapeHtml(course.cycle_name)}</span>`).join('') : '<span>Sin cursos asignados</span>'}</div></td>
        <td data-label="Acciones"><div class="user-row-actions"><button class="secondary-button" type="button" data-academic-courses="${professor.id}">Editar cursos</button></div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5">No hay académicos que coincidan con la búsqueda.</td></tr>';
  }
  async function loadAcademics() {
    const { data, error } = await state.client.rpc('warehouse_professors_data');
    if (error) throw error;
    state.academics = data || { professors: [], courses: [] };
    renderAcademics();
  }
  function fillAcademicCourseOptions() {
    if (!state.selectedAcademic) return;
    const cycleId = $('academicCourseCycle').value;
    const assigned = (state.selectedAcademic.courses || []).filter((course) => course.cycle_id === cycleId);
    const assignedNrc = new Set(assigned.map((course) => course.nrc));
    const available = (state.academics.courses || []).filter((course) => course.cycle_id === cycleId && !assignedNrc.has(course.nrc));
    $('academicCourseNrc').innerHTML = available.map((course) => `<option value="${escapeHtml(course.nrc)}">${escapeHtml(course.course_code)} · ${escapeHtml(course.course_name)} · NRC ${escapeHtml(course.nrc)}</option>`).join('') || '<option value="">No hay más cursos disponibles</option>';
    $('academicCourseForm').querySelector('button[type="submit"]').disabled = assigned.length >= 3 || !available.length;
    $('academicCourseList').innerHTML = (state.selectedAcademic.courses || []).map((course) => `<article class="academic-course-item"><div><strong>${escapeHtml(course.course_code)} · ${escapeHtml(course.course_name)}</strong><span>${escapeHtml(course.cycle_name)} · NRC ${escapeHtml(course.nrc)}${course.group_code ? ` · Grupo ${escapeHtml(course.group_code)}` : ''}</span></div><button class="danger-button" type="button" data-remove-academic-course="${course.id}">Quitar</button></article>`).join('') || '<p>Este académico todavía no tiene cursos asignados.</p>';
    $('academicCoursesMessage').hidden = true;
  }
  function openAcademicCourses(id) {
    state.selectedAcademic = (state.academics.professors || []).find((professor) => professor.id === Number(id));
    if (!state.selectedAcademic) return;
    $('academicCoursesTitle').textContent = `Cursos de ${state.selectedAcademic.full_name}`;
    const cycles = [...new Map((state.academics.courses || []).map((course) => [course.cycle_id, course.cycle_name])).entries()];
    $('academicCourseCycle').innerHTML = cycles.map(([idValue, name]) => `<option value="${idValue}">${escapeHtml(name)}</option>`).join('');
    fillAcademicCourseOptions();
    $('academicCoursesDialog').showModal();
  }
  async function assignAcademicCourse(event) {
    event.preventDefault();
    const button = $('academicCourseForm').querySelector('button[type="submit"]');
    setBusy(button, true, 'Asignando…');
    try {
      const { error } = await state.client.rpc('warehouse_assign_professor_course', { p_teacher_id: state.selectedAcademic.id, p_cycle_id: $('academicCourseCycle').value, p_nrc: $('academicCourseNrc').value });
      if (error) throw error;
      await loadAcademics();
      state.selectedAcademic = state.academics.professors.find((professor) => professor.id === state.selectedAcademic.id);
      fillAcademicCourseOptions();
      setMessage('Curso asignado correctamente.', true);
    } catch (error) { $('academicCoursesMessage').textContent = error.message; $('academicCoursesMessage').hidden = false; }
    finally { setBusy(button, false); fillAcademicCourseOptions(); }
  }
  async function removeAcademicCourse(id) {
    if (!window.confirm('¿Deseas quitar este curso del profesor? El historial de autorizaciones no se eliminará.')) return;
    const { error } = await state.client.rpc('warehouse_remove_professor_course', { p_assignment_id: Number(id) });
    if (error) { $('academicCoursesMessage').textContent = error.message; $('academicCoursesMessage').hidden = false; return; }
    await loadAcademics();
    state.selectedAcademic = state.academics.professors.find((professor) => professor.id === state.selectedAcademic.id);
    fillAcademicCourseOptions();
    setMessage('Curso retirado. El historial institucional se conserva.', true);
  }

  function openEditor(userId) {
    const user = state.users.find((item) => item.id === userId);
    if (!user || !canEdit(user)) return;
    $('editedUserId').value = user.id;
    $('editedUserName').value = user.full_name;
    $('editedUserNationalId').value = user.national_id || '';
    $('editedUserEmail').value = user.email;
    $('editedUserUnit').value = user.unit || 'Docencia';
    $('editedUserAccess').value = accessType(user);
    $('editedUserAccess').disabled = !isSuperadmin() || user.id === state.profile?.id;
    $('userRoleHelp').hidden = isSuperadmin() && user.id !== state.profile?.id;
    setEditorMessage('');
    $('userEditorDialog').showModal();
  }
  function closeEditor() {
    $('userEditorForm').reset();
    $('userEditorDialog').close();
  }

  async function invokeManagement(body) {
    const { data, error } = await state.client.functions.invoke('admin-manage-users', { body });
    if (error) {
      let detail = null;
      try { detail = await error.context?.json(); } catch {}
      throw new Error(detail?.error || error.message);
    }
    if (!data?.ok) throw new Error(data?.error || 'No fue posible actualizar el usuario.');
    return data;
  }

  async function saveUser(event) {
    event.preventDefault();
    const button = $('userEditorForm').querySelector('button[type="submit"]');
    setBusy(button, true, 'Guardando…');
    try {
      const editedId = $('editedUserId').value;
      const data = await invokeManagement({
        action: 'update',
        userId: editedId,
        fullName: $('editedUserName').value.trim(),
        nationalId: $('editedUserNationalId').value.trim(),
        email: $('editedUserEmail').value.trim().toLowerCase(),
        unit: $('editedUserUnit').value,
        accessType: $('editedUserAccess').value
      });
      closeEditor();
      if (editedId === state.profile.id) await loadProfile();
      await loadUsers();
      setMessage(data.message || 'Usuario actualizado.', true);
    } catch (error) { setEditorMessage(error.message); }
    finally { setBusy(button, false); }
  }

  async function manageAccess(userId, action) {
    const user = state.users.find((item) => item.id === userId);
    if (!user) return;
    let reason = '';
    if (action === 'block') {
      reason = window.prompt(`Indica el motivo para bloquear las reservas de ${user.full_name}:`) || '';
      if (!reason.trim()) return;
    } else {
      const messages = {
        unblock: `¿Deseas habilitar nuevamente las reservas de ${user.full_name}?`,
        deactivate: `¿Deseas eliminar el acceso de ${user.full_name}? Su historial institucional se conservará.`,
        reactivate: `¿Deseas reactivar el acceso de ${user.full_name}?`
      };
      if (!window.confirm(messages[action])) return;
    }
    try {
      const data = await invokeManagement({ action, userId, reason: reason.trim() });
      await loadUsers();
      setMessage(data.message || 'Usuario actualizado.', true);
    } catch (error) { setMessage(error.message); }
  }

  async function loadProfile() {
    const { data, error } = await state.client.from('profiles')
      .select('id,full_name,email,role,admin_scope,active')
      .eq('id', state.session.user.id)
      .single();
    if (error || !data?.active || data.role !== 'admin' || !['superadmin', 'operations', 'reservations'].includes(data.admin_scope)) {
      await state.client.auth.signOut();
      window.location.replace('ingreso.html?v=7');
      throw new Error('Se requiere acceso administrativo.');
    }
    state.profile = data;
    $('usersHeaderAccount').hidden = false;
    $('usersCurrentName').textContent = data.full_name;
    $('usersCurrentRole').textContent = isSuperadmin() ? 'Superadministrador' : 'Administrador de reservas';
  }

  function bindEvents() {
    $('usersLogout').addEventListener('click', async () => {
      await state.client.auth.signOut();
      window.location.replace('ingreso.html?v=7');
    });
    $('usersSearch').addEventListener('input', () => { state.page = 1; renderTable(); });
    $('usersStatusFilter').addEventListener('change', () => { state.page = 1; renderTable(); });
    $('academicsSearch').addEventListener('input', renderAcademics);
    $('academicCourseCycle').addEventListener('change', fillAcademicCourseOptions);
    $('academicCourseForm').addEventListener('submit', assignAcademicCourse);
    $('closeAcademicCourses').addEventListener('click', () => $('academicCoursesDialog').close());
    $('refreshAcademics').addEventListener('click', async () => { await loadAcademics(); setMessage('Registro de académicos actualizado.', true); });
    $('refreshUsersTable').addEventListener('click', async () => {
      await loadUsers();
      setMessage('Lista de usuarios actualizada.', true);
    });
    $('previousUsersPage').addEventListener('click', () => { state.page -= 1; renderTable(); });
    $('nextUsersPage').addEventListener('click', () => { state.page += 1; renderTable(); });
    $('userEditorForm').addEventListener('submit', saveUser);
    $('closeUserEditor').addEventListener('click', closeEditor);
    $('cancelUserEditor').addEventListener('click', closeEditor);
    document.addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-user]');
      if (editButton) openEditor(editButton.dataset.editUser);
      const actionButton = event.target.closest('[data-user-action]');
      if (actionButton) manageAccess(actionButton.dataset.userId, actionButton.dataset.userAction);
      const coursesButton = event.target.closest('[data-academic-courses]');
      if (coursesButton) openAcademicCourses(coursesButton.dataset.academicCourses);
      const removeCourseButton = event.target.closest('[data-remove-academic-course]');
      if (removeCourseButton) removeAcademicCourse(removeCourseButton.dataset.removeAcademicCourse);
    });
  }

  async function initialize() {
    bindEvents();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      $('usersConnectionStatus').textContent = 'Configuración pendiente';
      $('usersConnectionStatus').classList.add('is-offline');
      return;
    }
    try {
      state.client = window.RESERVAS_SUPABASE_CLIENT || window.supabase.createClient(
        config.supabaseUrl,
        config.supabaseAnonKey,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
      );
      window.RESERVAS_SUPABASE_CLIENT = state.client;
      const { data } = await state.client.auth.getSession();
      state.session = data.session;
      if (!state.session) { window.location.replace('ingreso.html?v=7'); return; }
      await loadProfile();
      await loadUsers();
      if (isSuperadmin()) { $('academicsPanel').hidden = false; await loadAcademics(); }
      $('usersConnectionStatus').textContent = 'Acceso administrativo';
    } catch (error) {
      $('usersConnectionStatus').textContent = 'No disponible';
      $('usersConnectionStatus').classList.add('is-offline');
      setMessage(error.message);
    }
  }

  initialize();
})();
