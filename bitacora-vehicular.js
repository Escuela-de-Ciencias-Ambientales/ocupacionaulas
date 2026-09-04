(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const config = window.RESERVAS_CONFIG || {};
  const state = { client:null,session:null,profile:null,vehicles:[],reservations:[],logs:[],profiles:[],selected:null,selectedLog:null,isAdmin:false };
  const fuelNames={reserve:'Reserva',quarter:'¼',half:'½',three_quarters:'¾',full:'Lleno'};
  const reviewNames={pending:'Pendiente de revisión',reviewed:'Revisada',needs_attention:'Requiere atención'};
  const esc=(value='')=>String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const formatDateTime=(value)=>new Intl.DateTimeFormat('es-CR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const localDate=(value)=>{const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
  const vehicleFor=(id)=>state.vehicles.find((item)=>String(item.id)===String(id));
  const logFor=(reservationId)=>state.logs.find((item)=>item.reservation_id===reservationId);
  const profileName=(id)=>state.profiles.find((item)=>item.id===id)?.full_name||state.profile?.full_name||'No indicado';
  const setMessage=(target,text,success=false)=>{target.textContent=text;target.hidden=!text;target.classList.toggle('is-success',success);};

  function setView(view){
    const admin=view==='admin'&&state.isAdmin;
    $('driverLogView').hidden=admin;$('adminLogView').hidden=!admin;
    document.querySelectorAll('[data-log-view]').forEach((button)=>button.setAttribute('aria-selected',String(button.dataset.logView===(admin?'admin':'driver'))));
    if(admin)renderAdmin();
  }

  function eligibleReservations(){
    const now=Date.now();
    return state.reservations.filter((item)=>item.user_id===state.session.user.id&&item.status==='confirmed'&&new Date(item.starts_at).getTime()<=now);
  }

  function populateReservationPicker(){
    const reservations=eligibleReservations();
    $('logReservation').innerHTML='<option value="">Seleccione una gira</option>'+reservations.map((item)=>{
      const vehicle=vehicleFor(item.vehicle_id);const complete=Boolean(logFor(item.id));
      return `<option value="${item.id}"${complete?' disabled':''}>${esc(formatDateTime(item.starts_at))} · ${esc(vehicle?.plate||'')} · ${esc(item.destination)}${complete?' · COMPLETA':''}</option>`;
    }).join('');
    if(!reservations.length){
      $('logReservation').innerHTML='<option value="">No hay giras habilitadas</option>';
      $('vehicleLogForm').setAttribute('aria-disabled','true');
      setMessage($('logMessage'),'No tiene reservas confirmadas que ya hayan iniciado.');
    }
  }

  function selectReservation(id){
    state.selected=state.reservations.find((item)=>item.id===id)||null;
    const item=state.selected;const box=$('reservationIdentity');
    if(!item){box.hidden=true;$('vehicleLogForm').setAttribute('aria-disabled','true');return;}
    const vehicle=vehicleFor(item.vehicle_id);
    box.innerHTML=[['Conductor',item.driver_name||item.responsible_name],['Placa',vehicle?.plate||'No indicada'],['Salida',formatDateTime(item.starts_at)],['Regreso',formatDateTime(item.ends_at)],['Destino',item.destination],['Responsable',item.responsible_name],['Cédula',item.driver_id_number||item.responsible_id_number||'No indicada'],['Unidad',item.unit||'No indicada']].map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    box.hidden=false;$('vehicleLogForm').removeAttribute('aria-disabled');
    $('logTripSheet').value=item.trip_sheet_number||'';
    $('logDepartureMileage').value=item.departure_mileage??'';$('logArrivalMileage').value=item.arrival_mileage??'';
    $('logDepartureFuel').value=item.departure_fuel_level||'';$('logArrivalFuel').value=item.arrival_fuel_level||'';
    setMessage($('logMessage'),'');
  }

  function radioValue(name){const input=document.querySelector(`input[name="${name}"]:checked`);return input?input.value==='true':null;}
  function signaturePad(){
    const canvas=$('logSignature'),context=canvas.getContext('2d');let drawing=false,signed=false;
    context.lineWidth=4;context.lineCap='round';context.strokeStyle='#172b2d';
    const point=(event)=>{const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*(canvas.width/rect.width),y:(event.clientY-rect.top)*(canvas.height/rect.height)};};
    canvas.addEventListener('pointerdown',(event)=>{drawing=true;signed=true;canvas.setPointerCapture(event.pointerId);const p=point(event);context.beginPath();context.moveTo(p.x,p.y);});
    canvas.addEventListener('pointermove',(event)=>{if(!drawing)return;const p=point(event);context.lineTo(p.x,p.y);context.stroke();});
    ['pointerup','pointercancel','pointerleave'].forEach((name)=>canvas.addEventListener(name,()=>{drawing=false;}));
    $('clearLogSignature').addEventListener('click',()=>{context.clearRect(0,0,canvas.width,canvas.height);signed=false;});
    return{hasSignature:()=>signed,data:()=>canvas.toDataURL('image/png'),clear:()=>{context.clearRect(0,0,canvas.width,canvas.height);signed=false;}};
  }
  const signature=signaturePad();

  function canvasBlob(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error('No fue posible procesar la fotografía.')),'image/jpeg',quality));}
  async function compressPhoto(file){
    if(!file?.type?.startsWith('image/'))throw new Error('Seleccione fotografías válidas.');
    if(file.size>50*1024*1024)throw new Error('Una fotografía original supera el límite permitido.');
    let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{bitmap=await createImageBitmap(file);}
    let width=bitmap.width,height=bitmap.height;const limit=1600;if(Math.max(width,height)>limit){const ratio=limit/Math.max(width,height);width=Math.round(width*ratio);height=Math.round(height*ratio);}
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{alpha:false});let blob,quality=.8;
    for(let attempt=0;attempt<6;attempt+=1){canvas.width=width;canvas.height=height;context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);blob=await canvasBlob(canvas,quality);if(blob.size<=950*1024)break;width=Math.max(800,Math.round(width*.82));height=Math.max(600,Math.round(height*.82));quality=Math.max(.6,quality-.05);}
    bitmap.close?.();if(!blob||blob.size>1024*1024)throw new Error('No fue posible comprimir una fotografía a menos de 1 MB.');return blob;
  }

  function bindPhotoPreviews(){document.querySelectorAll('[data-photo-control]').forEach((control)=>{const input=control.querySelector('input'),preview=control.querySelector('.photo-preview'),image=preview.querySelector('img'),text=preview.querySelector('span');input.addEventListener('change',()=>{const file=input.files[0];if(!file){preview.hidden=true;return;}image.src=URL.createObjectURL(file);text.textContent=`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB antes de comprimir`;preview.hidden=false;});});}

  async function submitLog(event){
    event.preventDefault();setMessage($('logMessage'),'');
    if(!state.selected){setMessage($('logMessage'),'Seleccione una reserva.');return;}
    if(!event.currentTarget.reportValidity())return;
    const departure=Number($('logDepartureMileage').value),arrival=Number($('logArrivalMileage').value);
    if(arrival<departure){setMessage($('logMessage'),'El kilometraje final no puede ser menor al inicial.');return;}
    const requiredRadios=['vehicle_clean_out','oils_checked','coolant_checked','oil_change_checked','tools_checked','safety_kit_checked','documents_checked','outbound_damage','vehicle_clean_return','new_damage'];
    if(requiredRadios.some((name)=>radioValue(name)===null)){setMessage($('logMessage'),'Responda Sí o No en todos los puntos de revisión.');return;}
    if(!signature.hasSignature()){setMessage($('logMessage'),'Registre la firma del conductor.');$('logSignature').scrollIntoView({behavior:'smooth',block:'center'});return;}
    const button=$('submitVehicleLog'),original=button.textContent,uploaded=[];button.disabled=true;button.textContent='Comprimiendo fotografías…';
    try{
      const files=[['departure',$('logDeparturePhoto').files[0]],['return',$('logReturnPhoto').files[0]]];
      for(const[kind,file]of files){const blob=await compressPhoto(file);const path=`${state.session.user.id}/${state.selected.id}/bitacora-${kind}-${Date.now()}-${crypto.randomUUID()}.jpg`;button.textContent=`Guardando foto de ${kind==='departure'?'salida':'regreso'}…`;const{error}=await state.client.storage.from('vehicle-trip-photos').upload(path,blob,{contentType:'image/jpeg',cacheControl:'3600',upsert:false});if(error)throw error;uploaded.push(path);}
      button.textContent='Guardando bitácora…';
      const params={p_reservation_id:state.selected.id,p_trip_sheet_number:$('logTripSheet').value.trim(),p_departure_mileage:departure,p_arrival_mileage:arrival,p_departure_fuel_level:$('logDepartureFuel').value,p_arrival_fuel_level:$('logArrivalFuel').value,p_departure_notes:$('logDepartureNotes').value.trim(),p_return_notes:$('logReturnNotes').value.trim(),p_departure_photo_path:uploaded[0],p_return_photo_path:uploaded[1],p_signature_data:signature.data()};
      requiredRadios.forEach((name)=>{params[`p_${name}`]=radioValue(name);});
      const{error}=await state.client.rpc('submit_vehicle_trip_log',params);if(error)throw error;
      event.currentTarget.reset();signature.clear();document.querySelectorAll('.photo-preview').forEach((item)=>item.hidden=true);state.selected=null;$('reservationIdentity').hidden=true;
      await loadData();setMessage($('logMessage'),'Bitácora completa guardada correctamente.',true);window.scrollTo({top:0,behavior:'smooth'});
    }catch(error){if(uploaded.length)await state.client.storage.from('vehicle-trip-photos').remove(uploaded);setMessage($('logMessage'),error.message||'No fue posible guardar la bitácora.');}
    finally{button.disabled=false;button.textContent=original;}
  }

  function adminReservations(){return state.reservations.filter((item)=>item.status==='confirmed'&&new Date(item.starts_at)<=new Date());}
  function filteredAdmin(){
    const search=$('adminLogSearch').value.trim().toLocaleLowerCase('es'),from=$('adminLogFrom').value,to=$('adminLogTo').value,completion=$('adminLogCompletion').value;
    return adminReservations().filter((item)=>{const log=logFor(item.id),vehicle=vehicleFor(item.vehicle_id),text=`${log?.trip_sheet_number||''} ${item.responsible_name||''} ${item.driver_name||''} ${item.driver_id_number||''} ${vehicle?.plate||''} ${item.destination||''}`.toLocaleLowerCase('es');const date=localDate(item.starts_at);return(!search||text.includes(search))&&(!from||date>=from)&&(!to||date<=to)&&(completion==='all'||(completion==='complete'&&log)||(completion==='incomplete'&&!log)||(completion==='attention'&&log?.review_status==='needs_attention'));});
  }

  function renderAdmin(){
    const reservations=adminReservations(),complete=reservations.filter((item)=>logFor(item.id)),attention=complete.filter((item)=>logFor(item.id).review_status==='needs_attention');
    $('logKpiTotal').textContent=reservations.length;$('logKpiComplete').textContent=complete.length;$('logKpiIncomplete').textContent=reservations.length-complete.length;$('logKpiAttention').textContent=attention.length;
    const items=filteredAdmin();$('adminLogList').innerHTML=items.length?items.map((item)=>{const log=logFor(item.id),vehicle=vehicleFor(item.vehicle_id),status=!log?['Incompleta','']:log.review_status==='needs_attention'?['Requiere atención','attention']:['Completa','complete'];return `<article class="admin-log-row"><div><span class="completion-chip ${status[1]}">${status[0]}</span><span class="meta">${esc(log?reviewNames[log.review_status]:'Sin enviar')}</span></div><div><strong>${esc(item.driver_name||item.responsible_name)}</strong><span class="meta">Reserva: ${esc(item.responsible_name)}</span></div><div><strong>${esc(vehicle?.plate||'')}</strong><span class="meta">${esc(item.destination)}</span></div><div><strong>${esc(log?.trip_sheet_number||'Sin boleta')}</strong><span class="meta">${esc(formatDateTime(item.starts_at))}</span></div><div><strong>${esc(log?`${log.arrival_mileage-log.departure_mileage} km`:'—')}</strong><span class="meta">Llenó: ${esc(log?profileName(log.filled_by):'Pendiente')}</span></div><button class="secondary-button compact-button" type="button" data-log-detail="${item.id}">${log?'Ver resumen':'Ver reserva'}</button></article>`;}).join(''):'<p class="empty-state">No hay bitácoras que coincidan con los filtros.</p>';
    document.querySelectorAll('[data-log-detail]').forEach((button)=>button.addEventListener('click',()=>openDetail(button.dataset.logDetail)));
  }

  const detailField=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value??'No indicado')}</dd></div>`;
  const check=(label,value,positive=true)=>`<span class="${value===positive?'ok':'bad'}">${esc(label)}: ${value?'Sí':'No'}</span>`;
  async function openDetail(reservationId){
    const reservation=state.reservations.find((item)=>item.id===reservationId),log=logFor(reservationId),vehicle=vehicleFor(reservation.vehicle_id);state.selectedLog=log||null;
    $('logDetailTitle').textContent=log?`Boleta ${log.trip_sheet_number}`:'Reserva sin bitácora';
    let html=`<dl class="log-detail-grid">${detailField('Conductor',reservation.driver_name||reservation.responsible_name)}${detailField('Responsable',reservation.responsible_name)}${detailField('Placa',vehicle?.plate)}${detailField('Salida',formatDateTime(reservation.starts_at))}${detailField('Regreso',formatDateTime(reservation.ends_at))}${detailField('Destino',reservation.destination)}</dl>`;
    if(log){html+=`<dl class="log-detail-grid">${detailField('Boleta',log.trip_sheet_number)}${detailField('Kilometraje',`${log.departure_mileage} → ${log.arrival_mileage} km`)}${detailField('Recorrido',`${log.arrival_mileage-log.departure_mileage} km`)}${detailField('Combustible inicial',fuelNames[log.departure_fuel_level])}${detailField('Combustible final',fuelNames[log.arrival_fuel_level])}${detailField('Llenó la bitácora',profileName(log.filled_by))}</dl><div class="detail-checks">${check('Limpio al salir',log.vehicle_clean_out)}${check('Aceites revisados',log.oils_checked)}${check('Coolant o agua',log.coolant_checked)}${check('Cambio de aceite revisado',log.oil_change_checked)}${check('Herramientas',log.tools_checked)}${check('Kit de seguridad',log.safety_kit_checked)}${check('Documentos',log.documents_checked)}${check('Golpes al salir',log.outbound_damage,false)}${check('Limpio al regreso',log.vehicle_clean_return)}${check('Golpes nuevos',log.new_damage,false)}</div><div class="detail-notes"><div><h4>Observaciones de salida</h4><p>${esc(log.departure_notes)}</p></div><div><h4>Observaciones de regreso</h4><p>${esc(log.return_notes)}</p></div></div><div class="detail-photos" id="logDetailPhotos"></div><div class="detail-signature"><h4>Firma del conductor</h4><img src="${esc(log.signature_data)}" alt="Firma del conductor" /></div>`;}
    else html+='<div class="form-message">Esta gira inició y todavía no tiene una bitácora completa.</div>';
    $('logDetailContent').innerHTML=html;$('logReviewForm').hidden=!log||!state.isAdmin;
    if(log){$('logReviewStatus').value=log.review_status;$('logReviewNotes').value=log.review_notes||'';const [departure,arrival]=await Promise.all([state.client.storage.from('vehicle-trip-photos').createSignedUrl(log.departure_photo_path,900),state.client.storage.from('vehicle-trip-photos').createSignedUrl(log.return_photo_path,900)]);const photos=$('logDetailPhotos');if(photos)photos.innerHTML=[[departure.data?.signedUrl,'Foto de salida'],[arrival.data?.signedUrl,'Foto de regreso']].filter(([url])=>url).map(([url,label])=>`<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${label}" /><span>${label}</span></a>`).join('');}
    $('logDetailDialog').showModal();
  }

  async function reviewLog(event){event.preventDefault();if(!state.selectedLog)return;const button=event.currentTarget.querySelector('button'),original=button.textContent;button.disabled=true;button.textContent='Guardando…';const{data,error}=await state.client.rpc('admin_review_vehicle_trip_log',{p_log_id:state.selectedLog.id,p_review_status:$('logReviewStatus').value,p_review_notes:$('logReviewNotes').value.trim()});button.disabled=false;button.textContent=original;if(error){setMessage($('adminLogMessage'),error.message);return;}const updated=Array.isArray(data)?data[0]:data;const index=state.logs.findIndex((item)=>item.id===updated.id);if(index>=0)state.logs[index]=updated;$('logDetailDialog').close();renderAdmin();setMessage($('adminLogMessage'),'Revisión guardada correctamente.',true);}

  async function loadData(){
    const admin=state.isAdmin;
    const queries=[state.client.from('vehicles').select('*').eq('active',true).order('sort_order'),state.client.from('vehicle_reservations').select('*').order('starts_at',{ascending:false}).limit(admin?5000:1000),state.client.from('vehicle_trip_logs').select('*').order('submitted_at',{ascending:false}).limit(5000)];
    if(admin)queries.push(state.client.from('profiles').select('id,full_name,national_id,email,role,admin_scope,active').order('full_name'));
    const results=await Promise.all(queries),error=results.find((item)=>item.error)?.error;if(error)throw error;
    state.vehicles=results[0].data||[];state.reservations=results[1].data||[];state.logs=results[2].data||[];state.profiles=results[3]?.data||[state.profile];populateReservationPicker();if(state.isAdmin)renderAdmin();
  }

  function bind(){
    $('logReservation').addEventListener('change',(event)=>selectReservation(event.target.value));$('vehicleLogForm').addEventListener('submit',submitLog);bindPhotoPreviews();
    document.querySelectorAll('[data-log-view]').forEach((button)=>button.addEventListener('click',()=>setView(button.dataset.logView)));
    ['adminLogSearch','adminLogFrom','adminLogTo','adminLogCompletion'].forEach((id)=>$(id).addEventListener(id==='adminLogSearch'?'input':'change',renderAdmin));
    $('refreshLogAdmin').addEventListener('click',async()=>{try{await loadData();setMessage($('adminLogMessage'),'Información actualizada.',true);}catch(error){setMessage($('adminLogMessage'),error.message);}});
    $('closeLogDetail').addEventListener('click',()=>$('logDetailDialog').close());$('acceptLogDetail').addEventListener('click',()=>$('logDetailDialog').close());$('logReviewForm').addEventListener('submit',reviewLog);
    $('logLogout').addEventListener('click',async()=>{await state.client.auth.signOut();window.location.replace('ingreso.html?v=7');});
  }

  async function initialize(){
    bind();if(!config.supabaseUrl||!config.supabaseAnonKey||!window.supabase?.createClient){$('logConnectionStatus').textContent='Configuración pendiente';return;}
    try{state.client=window.RESERVAS_SUPABASE_CLIENT||window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});const{data:{session}}=await state.client.auth.getSession();if(!session){window.location.replace('ingreso.html?v=7');return;}state.session=session;const{data:profile,error}=await state.client.from('profiles').select('id,full_name,email,national_id,role,admin_scope,active').eq('id',session.user.id).single();if(error)throw error;if(!profile?.active){await state.client.auth.signOut();window.location.replace('ingreso.html?v=7');return;}state.profile=profile;state.isAdmin=profile.role==='admin'&&['superadmin','operations','reservations'].includes(profile.admin_scope);$('logHeaderAccount').hidden=false;$('logCurrentName').textContent=profile.full_name;$('logCurrentRole').textContent=profile.admin_scope==='superadmin'?'Superadministrador':profile.admin_scope==='operations'?'Asistente administrativa':profile.role==='admin'?'Administrador de reservas':'Usuario de vehículos';$('logViewTabs').hidden=!state.isAdmin;await loadData();$('logConnectionStatus').textContent='Bitácora disponible';}
    catch(error){$('logConnectionStatus').textContent='No disponible';setMessage($('logMessage'),error.message||'No fue posible cargar las reservas.');}
  }
  initialize();
})();
