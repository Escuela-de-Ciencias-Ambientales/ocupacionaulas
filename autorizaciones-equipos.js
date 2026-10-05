(() => {
  'use strict';
  const config = window.RESERVAS_CONFIG || {};
  const el = (id) => document.getElementById(id);
  const state = { client:null, teacherNationalId:'', courses:[], student:null, signatureDrawn:false, drawing:false };

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
  function signatureContext() { return el('teacherSignature').getContext('2d'); }
  function resizeSignature() {
    const canvas = el('teacherSignature'); const ratio = Math.max(window.devicePixelRatio || 1, 1); const old = state.signatureDrawn ? canvas.toDataURL() : null;
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio)); canvas.height = Math.floor(170 * ratio);
    const ctx = signatureContext(); ctx.setTransform(ratio,0,0,ratio,0,0); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#122c24';
    if (old) { const image = new Image(); image.onload = () => ctx.drawImage(image,0,0,canvas.clientWidth,170); image.src = old; }
  }
  function signaturePoint(event) { const rect = el('teacherSignature').getBoundingClientRect(); return { x:event.clientX-rect.left, y:event.clientY-rect.top }; }
  function startSignature(event) { event.preventDefault(); state.drawing=true; const point=signaturePoint(event); const ctx=signatureContext(); ctx.beginPath(); ctx.moveTo(point.x,point.y); el('teacherSignature').setPointerCapture?.(event.pointerId); }
  function moveSignature(event) { if (!state.drawing) return; event.preventDefault(); const point=signaturePoint(event); const ctx=signatureContext(); ctx.lineTo(point.x,point.y); ctx.stroke(); state.signatureDrawn=true; el('signatureStatus').textContent='Firma registrada'; el('signatureStatus').classList.add('signed'); }
  function stopSignature() { state.drawing=false; }
  function clearSignature() { const canvas=el('teacherSignature'); signatureContext().clearRect(0,0,canvas.width,canvas.height); state.signatureDrawn=false; el('signatureStatus').textContent='Firma pendiente'; el('signatureStatus').classList.remove('signed'); }
  function signatureData() { if (!state.signatureDrawn) throw new Error('Firme en el recuadro antes de autorizar.'); return el('teacherSignature').toDataURL('image/png'); }

  async function loadCourses(event) {
    resetDirectionSearch();
    event.preventDefault(); clearMessage(); el('authorizationArea').hidden=true;el('directionPanel').hidden=true;el('directionForm').hidden=true;state.directionBorrower=null;clearSignature();
    const nationalId = cleanId(el('teacherId').value);
    if (nationalId.length < 7) return message('Revise el número de cédula.');
    const button = el('loadCoursesButton'); busy(button, true, 'Cargando…');
    const { data, error } = await state.client.rpc('public_equipment_teacher_context', { p_national_id:nationalId });
    busy(button, false);
    if (error) return message(friendly(error));
    if (!data?.found) return message('No se encontró un profesor activo con esa cédula. Solicite a la administración que revise el registro docente.');
    state.teacherNationalId = nationalId;
    const direction=await state.client.rpc('public_equipment_direction_context',{p_national_id:nationalId});
    if(direction.error)return message(direction.error.message);
    el('directionPanel').hidden=!direction.data?.can_authorize;
    el('directionEquipment').innerHTML=(direction.data?.equipment||[]).map(x=>`<option value="${x.id}">${Sigep.escapeHtml(x.name)}</option>`).join('');
    el('directionUntil').value=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Costa_Rica'}).format(new Date(Date.now()+7*86400000));
    state.courses = data.courses || [];
    el('teacherName').textContent = data.teacher_name;
    const select = el('courseSelect');
    select.innerHTML = state.courses.length
      ? state.courses.map((course, index) => `<option value="${index}">${course.course_code || 'Curso'} · ${course.course_name || 'Sin nombre'} · NRC ${course.nrc}${course.group_code ? ` · Grupo ${course.group_code}` : ''}</option>`).join('')
      : '<option value="">No se encontraron cursos asociados</option>';
    el('authorizationArea').hidden = false;
    requestAnimationFrame(resizeSignature);
    el('authorizeCourseButton').disabled = !state.courses.length;
    message(direction.data?.can_authorize ? 'Puede autorizar GNSS Trimble en el apartado de Dirección o Subdirección de esta página.' : state.courses.length ? `${state.courses.length} curso(s) cargado(s). Ya puede autorizar con un solo clic.` : 'No hay cursos asociados a su nombre en el ciclo actual.', !!state.courses.length || !!direction.data?.can_authorize);
  }

  async function authorizeCourse(event) {
    event.preventDefault(); clearMessage();
    const course = state.courses[Number(el('courseSelect').value)];
    if (!course) return message('Seleccione un curso válido.');
    let selected, signature; try { selected = reason(event.currentTarget, 'courseReason', 'courseOther'); signature = signatureData(); } catch (error) { return message(error.message); }
    const button = el('authorizeCourseButton'); busy(button, true, 'Autorizando…');
    const { error } = await state.client.rpc('public_authorize_equipment_course', { p_teacher_national_id:state.teacherNationalId, p_cycle_id:course.cycle_id, p_nrc:course.nrc, p_reason:selected.selected, p_reason_detail:selected.detail, p_signature_data:signature });
    busy(button, false);
    if (error) return message(friendly(error));
    message(`Autorización registrada para todo el curso ${course.course_code || course.course_name} (NRC ${course.nrc}).`, true);
    clearSignature();
  }

  async function findStudent(event) {
    event.preventDefault(); clearMessage(); el('individualForm').hidden = true; state.student = null;
    const nationalId = cleanId(el('studentId').value);
    if (nationalId.length < 7) return message('Revise la cédula del estudiante.');
    const button = el('findStudentButton'); busy(button, true, 'Buscando…');
    const { data, error } = await state.client.rpc('public_find_equipment_student', { p_national_id:nationalId });
    busy(button, false);
    if (error) return message(friendly(error));
    state.student = data?.found ? data : null;
    if (!state.student) return message('No se encontró un estudiante activo con esa cédula. Debe incluirse primero en la carga estudiantil.');
    el('studentName').textContent = state.student.full_name;
    el('studentDetails').textContent = [state.student.national_id, state.student.career, state.student.email].filter(Boolean).join(' · ');
    el('individualForm').hidden = false;
  }

  async function authorizeStudent(event) {
    event.preventDefault(); clearMessage();
    if (!state.student) return message('Busque primero al estudiante.');
    let selected, signature; try { selected = reason(event.currentTarget, 'individualReason', 'individualOther'); signature = signatureData(); } catch (error) { return message(error.message); }
    const button = el('authorizeStudentButton'); busy(button, true, 'Autorizando…');
    const { error } = await state.client.rpc('public_authorize_equipment_student', { p_teacher_national_id:state.teacherNationalId, p_student_id:state.student.student_id, p_reason:selected.selected, p_reason_detail:selected.detail, p_signature_data:signature });
    busy(button, false);
    if (error) return message(friendly(error));
    message(`Autorización registrada para ${state.student.full_name}.`, true);
    el('studentSearchForm').reset(); el('individualForm').hidden = true; state.student = null;
    clearSignature();
  }


  let directionSearchTimer, directionSearchVersion=0;
  function resetDirectionSearch() {
    clearTimeout(directionSearchTimer); directionSearchVersion++;
    state.directionBorrower=null; el('directionForm').hidden=true;
    el('directionSearchResults').replaceChildren(); el('directionSearchResults').hidden=true;
    el('directionSearchStatus').textContent='Escriba al menos 2 letras y seleccione una persona de la lista.';
  }
  function selectDirectionBorrower(data,kind) {
    state.directionBorrower={...data,kind};
    el('directionBorrowerName').textContent=data.full_name;
    el('directionForm').hidden=false;
  }
  async function searchDirectionNames(version) {
    const kind=el('directionKind').value, query=el('directionBorrowerSearch').value.trim();
    el('directionSearchStatus').textContent='Buscando…';
    try {
      const {data,error}=await state.client.rpc('public_direction_search_borrowers',{p_director_national_id:state.teacherNationalId,p_query:query,p_kind:kind});
      if(version!==directionSearchVersion)return;
      if(error)throw error;
      const results=el('directionSearchResults');
      results.replaceChildren(); results.hidden=!data?.length;
      (data||[]).forEach(person=>{
        const row=document.createElement('li'), button=document.createElement('button');
        button.type='button'; button.textContent=`${person.full_name} · ${person.national_id}`;
        button.addEventListener('click',()=>{
          resetDirectionSearch(); el('directionBorrowerId').value=person.national_id;
          el('directionBorrowerSearch').value=person.full_name;
          selectDirectionBorrower(person,kind);
          el('directionSearchStatus').textContent=`Seleccionado: ${person.full_name}`;
        });
        row.appendChild(button); results.appendChild(row);
      });
      el('directionSearchStatus').textContent=data?.length ? `${data.length} coincidencia(s). Seleccione una persona.${data.length===30?' Afine el nombre para ver más resultados.':''}` : 'No se encontraron personas activas con ese nombre.';
    } catch(error) {
      if(version===directionSearchVersion)el('directionSearchStatus').textContent=error.message||'No se pudo buscar. Intente nuevamente.';
    }
  }
  el('directionBorrowerSearch').addEventListener('input',()=>{
    resetDirectionSearch(); el('directionBorrowerId').value='';
    if(el('directionBorrowerSearch').value.trim().length>=2){
      const version=directionSearchVersion;
      directionSearchTimer=setTimeout(()=>searchDirectionNames(version),250);
    }
  });
  el('directionBorrowerId').addEventListener('input',()=>{resetDirectionSearch();el('directionBorrowerSearch').value='';});
  async function findDirectionBorrower(event){
    resetDirectionSearch();
    event.preventDefault(); state.directionBorrower=null; el('directionForm').hidden=true;
    const kind=el('directionKind').value;
    const version=++directionSearchVersion;
    const {data,error}=await state.client.rpc('public_direction_find_borrower',{p_director_national_id:state.teacherNationalId,p_national_id:cleanId(el('directionBorrowerId').value),p_kind:kind});
    if(version!==directionSearchVersion)return;
    if(error)return message(error.message); if(!data?.found)return message('Persona no encontrada en el padrón seleccionado.');
    selectDirectionBorrower(data,kind);
  }
  async function authorizeDirection(event){
    event.preventDefault(); if(!state.directionBorrower)return message('Busque al solicitante.');
    let signature;try{signature=signatureData()}catch(e){return message(e.message)}
    const button=el('authorizeDirectionButton');busy(button,true,'Autorizando…');
    const {error}=await state.client.rpc('public_authorize_direction_equipment',{p_director_national_id:state.teacherNationalId,p_borrower_id:state.directionBorrower.id,p_kind:state.directionBorrower.kind,p_catalog_id:Number(el('directionEquipment').value),p_quantity:Number(el('directionQuantity').value),p_valid_until:new Date(`${el('directionUntil').value}T23:59:59-06:00`).toISOString(),p_reason:el('directionReason').value.trim(),p_signature_data:signature});
    busy(button,false);if(error)return message(error.message);message('Autorización GNSS Trimble registrada. El solicitante ya puede seleccionar el equipo dentro de la cantidad y fecha autorizadas.',true);clearSignature();el('directionForm').hidden=true;state.directionBorrower=null;
  }
  el('directionSearchForm').addEventListener('submit',findDirectionBorrower);
  el('directionForm').addEventListener('submit',authorizeDirection);
  el('directionKind').addEventListener('change',()=>{resetDirectionSearch();el('directionBorrowerId').value='';if(el('directionBorrowerSearch').value.trim().length>=2)searchDirectionNames(directionSearchVersion);});

  async function init() {
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) return message('La conexión está pendiente de configuración.');
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
  }

  el('identityForm').addEventListener('submit', loadCourses);
  el('courseForm').addEventListener('submit', authorizeCourse);
  el('studentSearchForm').addEventListener('submit', findStudent);
  el('individualForm').addEventListener('submit', authorizeStudent);
  el('clearSignature').addEventListener('click', clearSignature);
  el('teacherSignature').addEventListener('pointerdown', startSignature);
  el('teacherSignature').addEventListener('pointermove', moveSignature);
  ['pointerup','pointercancel','pointerleave'].forEach((name) => el('teacherSignature').addEventListener(name, stopSignature));
  window.addEventListener('resize', resizeSignature);
  document.querySelectorAll('input[name="courseReason"]').forEach((input) => input.addEventListener('change', () => toggleOther('courseReason','courseOtherWrap','courseOther')));
  document.querySelectorAll('input[name="individualReason"]').forEach((input) => input.addEventListener('change', () => toggleOther('individualReason','individualOtherWrap','individualOther')));
  resizeSignature(); init();
})();
