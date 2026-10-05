const fs=require('fs'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module');
let handler,scope='superadmin',calls=[],finalizeFail=false;
const caller={id:'admin',role:'admin',admin_scope:'superadmin',active:true};
const target={id:'teacher',role:'teacher',full_name:'Docente de ejemplo',email:'ejemplo@una.cr',active:true};
function query(){return {id:null,select(){return this},eq(k,v){if(k==='id')this.id=v;return this},limit(){return this},single:async function(){return {data:this.id==='admin'?{...caller,admin_scope:scope}:target}},then(resolve){return Promise.resolve({data:[]}).then(resolve)}};}
const admin={from:()=>query(),auth:{admin:{createUser:async data=>{calls.push(['create',data.email]);return {data:{user:{id:'new'}}}},deleteUser:async()=>{calls.push(['cleanup']);return {}},getUserById:async()=>({data:{user:{created_at:'2026-10-05',last_sign_in_at:'2026-10-05'}}}),updateUserById:async(id,data)=>{calls.push(['ban',data.ban_duration]);return {}}}}};
const session={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async(name,p)=>{calls.push(['rpc',name]);return finalizeFail?{error:{message:'Conflicto de padrón'}}:{data:[]}}};
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/admin-manage-users/index.ts','utf8').replace(/^import[^\n]+\n/,''));
vm.runInNewContext(source,{createClient:(url,key)=>key==='service'?admin:session,Deno:{env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'service':'test'},serve:cb=>handler=cb},Request,Response,Set,console});
async function send(body){const response=await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}
(async()=>{
const create={action:'create',fullName:'Docente Ejemplo',nationalId:'000000001',email:'ejemplo@una.cr',unit:'Docencia',accessType:'teacher',password:'Temporal123'};
scope='operations';if((await send(create)).status!==403)throw Error('Creación no protegida');
if((await send({action:'detail',userId:'teacher'})).status!==403)throw Error('Detalle no protegido');
scope='superadmin';if((await send({...create,password:'short'})).status!==400)throw Error('Contraseña');
if(!(await send(create)).body.ok)throw Error('Creación');
finalizeFail=true;if((await send(create)).body.ok||!calls.some(c=>c[0]==='cleanup'))throw Error('Compensación');finalizeFail=false;
if(!(await send({action:'detail',userId:'teacher'})).body.detail.last_sign_in_at)throw Error('Detalle');
if(!(await send({action:'access_block',userId:'teacher',reason:'Prueba'})).body.ok||!calls.some(c=>c[0]==='ban'&&c[1]==='876000h'))throw Error('Bloqueo Auth');
if(!(await send({action:'access_unblock',userId:'teacher'})).body.ok||!calls.some(c=>c[0]==='ban'&&c[1]==='none'))throw Error('Desbloqueo Auth');
console.log('Edge: permisos, contraseña, creación, compensación, detalle, bloqueo/desbloqueo Auth simulados: OK');
})();
