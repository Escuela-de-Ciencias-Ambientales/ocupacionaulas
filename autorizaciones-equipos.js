(() => {
  'use strict';
  const config = window.RESERVAS_CONFIG || {};
  const el = (id) => document.getElementById(id);
  const state = { client:null, session:null, profile:null, courses:[], student:null };

  function message(text, success = false) {
    const box = el('pageMessage'); box.textContent = text; box.classList.toggle('is-success', success); box.hidden = false;
    box.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
  function clearMessage() { el('pageMessage').hidden = true; }
  function cleanId(value) { return String(value || '').replace(/\D/g, ''); }
  function reason(form, name, detailId) {
    const selected = form.querySelector(`input[name="${name}"]:checked`)?.value;
    const detail = el(detailId).value.trim();
    if (selected === 'other' && detail.length < 3) throw new Error('Especifique el motivo con al menos 3 caracteres.');
    return { selected, detail: selected === 'other' ? detail : null };
  }
  function toggleOther(name, wrapId, inputId) {
    const selected = document.querySelector(`input[name="${name}"]:checked`)?.value;
    el(wrapId).hidden = selected !== 'other'; el(inputId).required = selected === 'other';
  }
  function busy(button, active, text) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = active; button.textContent = active ? text : button.dataset.label;
  }
  function friendly(error) {
    const text = error?.message || 'No fue posible completar la operación.';
    if (/cedula no coincide/i.test(text)) return 'La cédula no coincide con su cuenta. Solicite a la administración que revise su registro docente.';
    return text;
  }

  async function loadCourses(event) {
    event.preventDefault(); clearMessage();
    const nationalId = cleanId(el('teacherId').value);
    if (nationalId.length < 7) return message('Revise el número de cédula.');
    const button = el('loadCoursesButton'); busy(button, true, 'Cargando…');
    const { data, error } = await state.client.rpc('my_equipment_courses', { p_national_id:nationalId });
    busy(button, false);
    if (error) return message(friendly(error));
    state.courses = data || [];
    const select = el('courseSelect');
    select.innerHTML = state.courses.length
      ? state.courses.map((course, index) => `<option value="${index}">${course.course_code || 'Curso'} · ${course.course_name || 'Sin nombre'} · NRC ${course.nrc}${course.group_code ? ` · Grupo ${course.group_code}` : ''}</option>`).join('')
      : '<option value="">No se encontraron cursos asociados</option>';
    el('authorizationArea').hidden = false;
    el('authorizeCourseButton').disabled = !state.courses.length;
    message(state.courses.length ? `${state.courses.length} curso(s) cargado(s). Ya puede autorizar con un solo clic.` : 'No hay cursos asociados a su nombre en el ciclo actual.', !!state.courses.length);
  }

  async function authorizeCourse(event) {
    event.preventDefault(); clearMessage();
    const course = state.courses[Number(el('courseSelect').value)];
    if (!course) return message('Seleccione un curso válido.');
    let selected; try { selected = reason(event.currentTarget, 'courseReason', 'courseOther'); } catch (error) { return message(error.message); }
    const button = el('authorizeCourseButton'); busy(button, true, 'Autorizando…');
    const { error } = await state.client.rpc('authorize_equipment_course', { p_cycle_id:course.cycle_id, p_nrc:course.nrc, p_reason:selected.selected, p_reason_detail:selected.detail });
    busy(button, false);
    if (error) return message(friendly(error));
    message(`Autorización registrada para todo el curso ${course.course_code || course.course_name} (NRC ${course.nrc}).`, true);
  }

  async function findStudent(event) {
    event.preventDefault(); clearMessage(); el('individualForm').hidden = true; state.student = null;
    const nationalId = cleanId(el('studentId').value);
    if (nationalId.length < 7) return message('Revise la cédula del estudiante.');
    const button = el('findStudentButton'); busy(button, true, 'Buscando…');
    const { data, error } = await state.client.rpc('find_equipment_student', { p_national_id:nationalId });
    busy(button, false);
    if (error) return message(friendly(error));
    state.student = data?.[0] || null;
    if (!state.student) return message('No se encontró un estudiante activo con esa cédula. Debe incluirse primero en la carga estudiantil.');
    el('studentName').textContent = state.student.full_name;
    el('studentDetails').textContent = [state.student.national_id, state.student.career, state.student.email].filter(Boolean).join(' · ');
    el('individualForm').hidden = false;
  }

  async function authorizeStudent(event) {
    event.preventDefault(); clearMessage();
    if (!state.student) return message('Busque primero al estudiante.');
    let selected; try { selected = reason(event.currentTarget, 'individualReason', 'individualOther'); } catch (error) { return message(error.message); }
    const button = el('authorizeStudentButton'); busy(button, true, 'Autorizando…');
    const { error } = await state.client.rpc('authorize_equipment_student', { p_student_id:state.student.student_id, p_reason:selected.selected, p_reason_detail:selected.detail });
    busy(button, false);
    if (error) return message(friendly(error));
    message(`Autorización registrada para ${state.student.full_name}.`, true);
    el('studentSearchForm').reset(); el('individualForm').hidden = true; state.student = null;
  }

  async function init() {
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) return message('La conexión está pendiente de configuración.');
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    const { data } = await state.client.auth.getSession(); state.session = data.session;
    if (!state.session) { window.location.replace(`ingreso.html?return=${encodeURIComponent('autorizaciones-equipos.html')}`); return; }
    const result = await state.client.from('profiles').select('id,full_name,role,active').eq('id', state.session.user.id).single();
    if (result.error || !result.data?.active || result.data.role !== 'teacher') return message('Este módulo requiere una cuenta docente activa.');
    state.profile = result.data; el('teacherName').textContent = state.profile.full_name;
  }

  el('identityForm').addEventListener('submit', loadCourses);
  el('courseForm').addEventListener('submit', authorizeCourse);
  el('studentSearchForm').addEventListener('submit', findStudent);
  el('individualForm').addEventListener('submit', authorizeStudent);
  document.querySelectorAll('input[name="courseReason"]').forEach((input) => input.addEventListener('change', () => toggleOther('courseReason','courseOtherWrap','courseOther')));
  document.querySelectorAll('input[name="individualReason"]').forEach((input) => input.addEventListener('change', () => toggleOther('individualReason','individualOtherWrap','individualOther')));
  el('logoutButton').addEventListener('click', async () => { if (state.client) await state.client.auth.signOut(); window.location.replace('ingreso.html'); });
  init();
})();
