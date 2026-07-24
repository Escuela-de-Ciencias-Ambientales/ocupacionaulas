(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.RESERVAS_CONFIG || {};
  const state = { client:null, session:null, profile:null, vehicles:[], trips:[], page:1, pageSize:12, selected:null };
  const statusNames = { pending_approval:'Pendiente de aprobación', confirmed:'Confirmada', suspended_maintenance:'Suspendida temporalmente', cancelled:'Cancelada', rejected:'Rechazada' };
  const fuelNames = { quarter:'¼', half:'½', three_quarters:'¾', full:'Lleno' };
  const conditionNames = { clean:'Limpio', dirty:'Sucio', other:'Otro' };
  const escapeHtml = (value='') => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const formatDateTime = (value) => new Intl.DateTimeFormat('es-CR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const vehicleFor = (id) => state.vehicles.find((vehicle) => String(vehicle.id) === String(id));
  const isCompleted = (trip) => new Date(trip.ends_at) < new Date();

  function setMessage(text, success=false) {
    const target=$('tripHistoryMessage'); target.textContent=text; target.hidden=!text;
    target.classList.toggle('is-error',!success);
  }
  function setEditMessage(text) {
    const target=$('tripEditMessage'); target.textContent=text; target.hidden=!text; target.classList.add('is-error');
  }
  function filteredTrips() {
    const search=$('tripHistorySearch').value.trim().toLocaleLowerCase('es');
    const stateFilter=$('tripHistoryState').value;
    const year=$('tripHistoryYear').value;
    const vehicle=$('tripHistoryVehicle').value;
    return state.trips.filter((trip) => {
      const cancelled=['cancelled','rejected'].includes(trip.status);
      const stateMatch=stateFilter==='all'
        || (stateFilter==='completed' && isCompleted(trip) && !cancelled)
        || (stateFilter==='upcoming' && !isCompleted(trip) && !cancelled)
        || (stateFilter==='cancelled' && cancelled);
      const searchMatch=!search || `${trip.destination} ${trip.objective} ${trip.trip_sheet_number||''}`.toLocaleLowerCase('es').includes(search);
      return stateMatch && searchMatch
        && (year==='all' || String(new Date(trip.starts_at).getFullYear())===year)
        && (vehicle==='all' || String(trip.vehicle_id)===vehicle);
    });
  }
  function renderSummary() {
    const active=state.trips.filter((trip)=>!['cancelled','rejected'].includes(trip.status));
    $('tripTotalCount').textContent=state.trips.length.toLocaleString('es-CR');
    $('tripCompletedCount').textContent=active.filter(isCompleted).length.toLocaleString('es-CR');
    $('tripUpcomingCount').textContent=active.filter((trip)=>!isCompleted(trip)).length.toLocaleString('es-CR');
    $('tripPhotoPendingCount').textContent=active.filter((trip)=>trip.photo_required && isCompleted(trip) && !trip.trip_photo_path && !trip.trip_photo_exempted_at).length.toLocaleString('es-CR');
  }
  function renderTable() {
    const trips=filteredTrips(); const pages=Math.max(1,Math.ceil(trips.length/state.pageSize)); state.page=Math.min(state.page,pages);
    const pageTrips=trips.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
    $('tripHistoryBody').innerHTML=pageTrips.length?pageTrips.map((trip)=>{
      const vehicle=vehicleFor(trip.vehicle_id);
      const photo=trip.trip_photo_path?'Cargada':trip.trip_photo_exempted_at?'Exonerada':trip.photo_required?'Pendiente':'No requerida';
      return `<tr><td data-label="Fecha"><strong>${escapeHtml(formatDateTime(trip.starts_at))}</strong><small>Regreso: ${escapeHtml(formatDateTime(trip.ends_at))}</small></td>
        <td data-label="Vehículo"><span class="vehicle-plate">${escapeHtml(vehicle?.plate||'')}</span></td>
        <td data-label="Destino"><strong>${escapeHtml(trip.destination)}</strong><small>${escapeHtml(trip.objective)}</small></td>
        <td data-label="Estado">${escapeHtml(statusNames[trip.status]||trip.status)}</td>
        <td data-label="Bitácora">${escapeHtml(photo)}</td>
        <td data-label="Acciones"><button class="secondary-button" type="button" data-view-trip="${trip.id}">Ver detalle</button></td></tr>`;
    }).join(''):'<tr><td colspan="6">No hay giras que coincidan con los filtros.</td></tr>';
    $('tripPageIndicator').textContent=`Página ${state.page} de ${pages} · ${trips.length} registros`;
    $('previousTripPage').disabled=state.page<=1; $('nextTripPage').disabled=state.page>=pages;
  }
  function populateFilters() {
    const years=[...new Set(state.trips.map((trip)=>new Date(trip.starts_at).getFullYear()))].sort((a,b)=>b-a);
    $('tripHistoryYear').innerHTML='<option value="all">Todos</option>'+years.map((year)=>`<option value="${year}">${year}</option>`).join('');
    $('tripHistoryVehicle').innerHTML='<option value="all">Todos</option>'+state.vehicles.map((vehicle)=>`<option value="${vehicle.id}">${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.display_name)}</option>`).join('');
  }
  function detailField(label,value,wide=false){return `<div${wide?' class="detail-wide"':''}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value||'No indicado')}</dd></div>`;}
  async function openTrip(id) {
    const trip=state.trips.find((item)=>item.id===id); if(!trip)return; state.selected=trip;
    const vehicle=vehicleFor(trip.vehicle_id); const drivers=trip.additional_drivers||[];
    $('tripHistoryDialogTitle').textContent=trip.destination;
    $('myTripDetailStatus').innerHTML=`<span class="status-chip">${escapeHtml(statusNames[trip.status]||trip.status)}</span>`;
    $('myTripFixedDetail').innerHTML=[
      detailField('Vehículo',`${vehicle?.plate||''} · ${vehicle?.display_name||''}`),
      detailField('Responsable',trip.responsible_name),
      detailField('Unidad',trip.unit||'No indicada'),
      detailField('Salida',formatDateTime(trip.starts_at)),
      detailField('Regreso',formatDateTime(trip.ends_at)),
      detailField('Fecha de registro',formatDateTime(trip.created_at))
    ].join('');
    $('myTripPartySize').value=trip.party_size||1; $('myTripDestination').value=trip.destination||'';
    $('myTripObjective').value=trip.objective||''; $('myTripItinerary').value=trip.itinerary||'';
    $('myTripDriverOne').value=drivers[0]||''; $('myTripDriverTwo').value=drivers[1]||'';
    $('myTripObservations').value=trip.observations||''; $('myTripSheetNumber').value=trip.trip_sheet_number||'';
    $('myTripDepartureMileage').value=trip.departure_mileage??''; $('myTripArrivalMileage').value=trip.arrival_mileage??'';
    $('myTripDepartureFuelLevel').value=trip.departure_fuel_level||trip.fuel_level||'';
    $('myTripArrivalFuelLevel').value=trip.arrival_fuel_level||'';
    $('myTripVehicleCondition').value=trip.vehicle_condition||'';
    $('myTripFuelingMileage').value=trip.fueling_mileage??'';
    $('myTripServiceStation').value=trip.service_station_location||'';
    $('myTripFuelLiters').value=trip.fuel_liters??'';
    $('myTripFuelType').value=trip.fuel_type||'';
    $('myTripInvoiceAmount').value=trip.invoice_amount??'';
    $('myTripInvoiceDate').value=trip.invoice_date||'';
    $('myTripInvoiceNumber').value=trip.invoice_number||'';
    $('myTripVoucherAuthorization').value=trip.voucher_authorization_number||'';
    $('myTripIrregularities').value=trip.irregularity_notes||'';
    $('saveTripHistoryEdit').disabled=['cancelled','rejected'].includes(trip.status);
    setEditMessage(''); $('myTripPhotoDetail').hidden=true;
    if(trip.trip_photo_path){
      const {data,error}=await state.client.storage.from('vehicle-trip-photos').createSignedUrl(trip.trip_photo_path,900);
      if(!error&&data?.signedUrl){$('myTripPhotoLink').href=data.signedUrl;$('myTripPhotoImage').src=data.signedUrl;$('myTripPhotoDetail').hidden=false;}
    }
    $('tripHistoryDialog').showModal();
  }
  async function saveTrip(event) {
    event.preventDefault(); if(!state.selected)return;
    const departure=$('myTripDepartureMileage').value?Number($('myTripDepartureMileage').value):null;
    const arrival=$('myTripArrivalMileage').value?Number($('myTripArrivalMileage').value):null;
    if(departure!==null&&arrival!==null&&arrival<departure){setEditMessage('El kilometraje de llegada no puede ser menor que el de salida.');return;}
    const button=$('saveTripHistoryEdit'); const original=button.textContent; button.disabled=true; button.textContent='Guardando…';
    const {data,error}=await state.client.rpc('update_my_vehicle_trip_details',{
      p_id:state.selected.id,p_party_size:Number($('myTripPartySize').value),p_destination:$('myTripDestination').value.trim(),
      p_objective:$('myTripObjective').value.trim(),p_itinerary:$('myTripItinerary').value.trim(),p_observations:$('myTripObservations').value.trim(),
      p_additional_drivers:[$('myTripDriverOne').value.trim(),$('myTripDriverTwo').value.trim()].filter(Boolean),
      p_trip_sheet_number:$('myTripSheetNumber').value.trim(),p_departure_mileage:departure,p_arrival_mileage:arrival,
      p_departure_fuel_level:$('myTripDepartureFuelLevel').value||null,
      p_arrival_fuel_level:$('myTripArrivalFuelLevel').value||null,
      p_vehicle_condition:$('myTripVehicleCondition').value||null,
      p_fueling_mileage:$('myTripFuelingMileage').value?Number($('myTripFuelingMileage').value):null,
      p_service_station_location:$('myTripServiceStation').value.trim(),
      p_fuel_liters:$('myTripFuelLiters').value?Number($('myTripFuelLiters').value):null,
      p_fuel_type:$('myTripFuelType').value||null,
      p_invoice_amount:$('myTripInvoiceAmount').value?Number($('myTripInvoiceAmount').value):null,
      p_invoice_date:$('myTripInvoiceDate').value||null,
      p_invoice_number:$('myTripInvoiceNumber').value.trim(),
      p_voucher_authorization_number:$('myTripVoucherAuthorization').value.trim(),
      p_irregularity_notes:$('myTripIrregularities').value.trim()
    });
    button.disabled=false; button.textContent=original;
    if(error){setEditMessage(error.message);return;}
    const updated=Array.isArray(data)?data[0]:data; const index=state.trips.findIndex((trip)=>trip.id===state.selected.id);
    if(updated&&index>=0)state.trips[index]=updated;
    $('tripHistoryDialog').close(); renderSummary(); renderTable(); setMessage('Información de la gira actualizada.',true);
  }
  function exportTrips() {
    if(!window.XLSX){setMessage('No fue posible iniciar la exportación.');return;}
    const rows=filteredTrips().map((trip)=>{const vehicle=vehicleFor(trip.vehicle_id);return{
      'Estado':statusNames[trip.status]||trip.status,'Vehículo':vehicle?.display_name||'','Placa':vehicle?.plate||'',
      'Responsable':trip.responsible_name,'Unidad':trip.unit||'','Salida':new Date(trip.starts_at),'Regreso':new Date(trip.ends_at),
      'Cantidad de personas':trip.party_size||1,'Destino':trip.destination,'Objetivo':trip.objective,'Itinerario':trip.itinerary||'',
      'Observaciones de reserva':trip.observations||'','Chofer adicional 1':trip.additional_drivers?.[0]||'','Chofer adicional 2':trip.additional_drivers?.[1]||'',
      'Número de boleta':trip.trip_sheet_number||'','Kilometraje de salida':trip.departure_mileage??'','Kilometraje de llegada':trip.arrival_mileage??'',
      'Combustible de salida':fuelNames[trip.departure_fuel_level||trip.fuel_level]||'',
      'Combustible de llegada':fuelNames[trip.arrival_fuel_level]||'',
      'Estado del vehículo':conditionNames[trip.vehicle_condition]||'',
      'Kilometraje de abastecimiento':trip.fueling_mileage??'',
      'Estación de servicio o gasolinera':trip.service_station_location||'',
      'Litros de combustible':trip.fuel_liters??'',
      'Tipo de combustible':({diesel:'Diésel',regular:'Gasolina regular',super:'Gasolina súper',other:'Otro'})[trip.fuel_type]||'',
      'Monto de factura':trip.invoice_amount??'','Fecha de factura':trip.invoice_date||'',
      'Número de factura':trip.invoice_number||'','Número de autorización del voucher':trip.voucher_authorization_number||'',
      'Observaciones':trip.irregularity_notes||'',
      'Fotografía':trip.trip_photo_path?'Cargada':trip.trip_photo_exempted_at?'Exonerada':trip.photo_required?'Pendiente':'No requerida'
    };});
    if(!rows.length){setMessage('No hay giras para exportar con los filtros actuales.');return;}
    const sheet=window.XLSX.utils.json_to_sheet(rows,{cellDates:true,dateNF:'yyyy-mm-dd hh:mm'});
    sheet['!cols']=Object.keys(rows[0]).map((key)=>({wch:Math.min(45,Math.max(14,key.length+2))}));
    const workbook=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(workbook,sheet,'Mis giras');
    window.XLSX.writeFile(workbook,`mis_giras_${new Date().toISOString().slice(0,10)}.xlsx`,{compression:true});
  }
  function bindEvents(){
    ['tripHistorySearch','tripHistoryState','tripHistoryYear','tripHistoryVehicle'].forEach((id)=>$(id).addEventListener(id==='tripHistorySearch'?'input':'change',()=>{state.page=1;renderTable();}));
    $('previousTripPage').addEventListener('click',()=>{state.page-=1;renderTable();});$('nextTripPage').addEventListener('click',()=>{state.page+=1;renderTable();});
    $('tripHistoryBody').addEventListener('click',(event)=>{const button=event.target.closest('[data-view-trip]');if(button)openTrip(button.dataset.viewTrip);});
    $('tripHistoryForm').addEventListener('submit',saveTrip);$('closeTripHistoryDialog').addEventListener('click',()=>$('tripHistoryDialog').close());
    $('cancelTripHistoryEdit').addEventListener('click',()=>$('tripHistoryDialog').close());$('exportMyTrips').addEventListener('click',exportTrips);
    $('tripLogout').addEventListener('click',async()=>{await state.client.auth.signOut();window.location.replace('ingreso.html?v=7');});
  }
  async function initialize(){
    bindEvents();
    if(!config.supabaseUrl||!config.supabaseAnonKey||!window.supabase?.createClient){$('tripHistoryStatus').textContent='Configuración pendiente';return;}
    try{
      state.client=window.RESERVAS_SUPABASE_CLIENT||window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
      const {data:{session}}=await state.client.auth.getSession();if(!session){window.location.replace('ingreso.html?v=7');return;}state.session=session;
      const [profileResult,vehiclesResult,tripsResult]=await Promise.all([
        state.client.from('profiles').select('id,full_name,role,admin_scope,active').eq('id',session.user.id).single(),
        state.client.from('vehicles').select('*').eq('active',true).order('plate'),
        state.client.from('vehicle_reservations').select('*').eq('user_id',session.user.id).order('starts_at',{ascending:false}).limit(5000)
      ]);
      const error=profileResult.error||vehiclesResult.error||tripsResult.error;if(error)throw error;
      if(!profileResult.data?.active){await state.client.auth.signOut();window.location.replace('ingreso.html?v=7');return;}
      state.profile=profileResult.data;state.vehicles=vehiclesResult.data||[];state.trips=tripsResult.data||[];
      $('tripHeaderAccount').hidden=false;$('tripCurrentName').textContent=state.profile.full_name;
      $('tripCurrentRole').textContent=state.profile.role==='admin'?(state.profile.admin_scope==='superadmin'?'Superadministrador':'Administrador de reservas'):'Docente';
      populateFilters();renderSummary();renderTable();$('tripHistoryStatus').textContent='Historial disponible';
      const requestedTrip=new URLSearchParams(window.location.search).get('gira');
      if(requestedTrip)await openTrip(requestedTrip);
    }catch(error){$('tripHistoryStatus').textContent='No disponible';setMessage(error.message);}
  }
  initialize();
})();
