import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import nodemailer from "npm:nodemailer@7.0.6";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const costaRicaDateTime=(value:string)=>new Intl.DateTimeFormat("es-CR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Costa_Rica"}).format(new Date(value));
const costaRicaDate=(value:string)=>new Intl.DateTimeFormat("es-CR",{dateStyle:"short",timeZone:"America/Costa_Rica"}).format(new Date(value));

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const {event,requestId,token}=await req.json();
    if(!["delivery","return"].includes(event)||!requestId||!token)return reply({error:"Solo se envían comprobantes de entrega o devolución"},400);
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:r,error}=await admin.from("student_loan_requests").select("id,request_number,status,created_at,expected_return_at,delivered_at,returned_at,receipt_token,student_signature_data,academic_students(full_name,national_id,email,career)").eq("id",requestId).eq("receipt_token",token).single();
    if(error||!r)return reply({error:"Comprobante no autorizado"},403);
    const {data:items}=await admin.from("student_loan_request_items").select("id,quantity,equipment_catalog(name),loan_request_unit_assignments(id,returned_at,return_note,returned_by,equipment_units(consecutive_code,asset_number,brand,model,serial_number))").eq("request_id",requestId);
    const student=Array.isArray(r.academic_students)?r.academic_students[0]:r.academic_students as any;
    const units=(items||[]).flatMap((i:any)=>(i.loan_request_unit_assignments||[]).map((a:any)=>{const u=Array.isArray(a.equipment_units)?a.equipment_units[0]:a.equipment_units;const c=Array.isArray(i.equipment_catalog)?i.equipment_catalog[0]:i.equipment_catalog;return{type:c?.name,...u,...a}}));
    if(event==="delivery"&&!r.delivered_at)return reply({error:"El equipo todavía no ha sido entregado"},409);
    if(event==="return"&&!units.some((u:any)=>u.returned_at))return reply({error:"No hay devoluciones registradas"},409);
    const selected=units.map((u:any)=>`<tr><td>${esc(u.type)}</td><td>${esc(u.consecutive_code)}</td><td>${esc(u.asset_number||"—")}</td><td>${esc([u.brand,u.model].filter(Boolean).join(" · ")||"—")}</td><td>${esc(u.serial_number||"—")}</td><td>${u.returned_at?`Devuelto · ${esc(u.returned_by)}${u.return_note?` · ${esc(u.return_note)}`:""}`:"Pendiente"}</td></tr>`);
    const titles={delivery:"Comprobante de préstamo",return:"Comprobante de devolución"};
    const terms=`<section style="margin-top:28px;padding:18px;background:#f1f6f3;border-left:4px solid #08784d"><h2 style="margin:0 0 10px;font-size:18px">Términos y condiciones</h2><ol style="margin:0;padding-left:22px;line-height:1.55"><li>El equipo debe utilizarse responsablemente y únicamente para la actividad académica o institucional autorizada.</li><li>Debe devolverse completo y en la fecha acordada, para que otros estudiantes y funcionarios puedan utilizarlo.</li><li>Cualquier daño, falla o incidente debe informarse a la Bodega de EDECA al momento de la devolución.</li><li>En caso de daño, robo, pérdida o extravío, la persona responsable deberá asumir el costo del equipo o reemplazarlo por uno nuevo de características equivalentes, según lo determine la institución.</li><li>La firma registrada en el sistema confirma la aceptación de estas condiciones.</li></ol></section>`;
    const html=`<!doctype html><html><body style="font-family:Arial;color:#17322a"><div style="max-width:760px;margin:auto;border:1px solid #d7e2de;border-radius:16px;overflow:hidden"><header style="padding:24px;background:#075f41;color:#fff"><small>EDECA · UNIVERSIDAD NACIONAL</small><h1>${titles[event]} ${esc(r.request_number)}</h1></header><main style="padding:24px"><p><strong>Estudiante:</strong> ${esc(student?.full_name)} · ${esc(student?.national_id)}<br><strong>Correo:</strong> ${esc(student?.email||"No registrado")}<br><strong>Fecha de solicitud:</strong> ${costaRicaDateTime(r.created_at)}<br><strong>Fecha de entrega:</strong> ${r.delivered_at?costaRicaDateTime(r.delivered_at):"—"}<br><strong>Fecha prevista de devolución:</strong> ${costaRicaDate(r.expected_return_at)}</p><table style="width:100%;border-collapse:collapse"><thead><tr><th>Tipo</th><th>Código</th><th>Activo</th><th>Marca/modelo</th><th>Serie</th><th>Estado/nota</th></tr></thead><tbody>${selected.join("")}</tbody></table><p style="margin-top:24px"><strong>Identificador único para trazabilidad: ${esc(r.request_number)}</strong></p><p>Las firmas digitales quedan almacenadas en el sistema y pueden consultarse desde Bodega.</p>${terms}</main></div></body></html>`;
    const transporter=nodemailer.createTransport({host:"smtp.gmail.com",port:465,secure:true,auth:{user:Deno.env.get("GMAIL_USER"),pass:Deno.env.get("GMAIL_APP_PASSWORD")}});
    const recipients=[student?.email,"bodegaedeca@gmail.com"].filter(Boolean).join(",");
    await transporter.sendMail({from:`Bodega EDECA <${Deno.env.get("GMAIL_USER")}>`,to:recipients,subject:`${titles[event]} · ${r.request_number}`,html});
    return reply({ok:true,recipients});
  }catch(error){console.error(error);return reply({error:"No fue posible enviar el comprobante"},500)}
});
