const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:"msedge"});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({rpc:async()=>({data:{found:true,authorized:true,full_name:'Persona de prueba',kind:'student',authorization_label:'Prueba',equipment:[{id:1,name:'Brújula',available:4}]}})})};`}));
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766/solicitar-equipo.html');
 await page.locator('#studentBack').click(); assert.match(page.url(),/solicitar-equipo.html$/);
 await page.locator('#nationalId').fill('000000'); await page.locator('#idForm button').click();
 await page.locator('#requestArea').waitFor({state:'visible'});
 await page.locator('[data-delta="1"]').click(); assert.equal(await page.locator('#qty-1').textContent(),'1');
 await page.locator('#studentBack').click();assert.equal(await page.locator('#identify').isVisible(),true);assert.equal(await page.locator('#requestArea').isVisible(),false);assert.equal(await page.locator('#nationalId').inputValue(),'');
 await page.locator('[data-pwa-install]').click();assert.equal(await page.locator('#pwaInstallHelp').isVisible(),true);await page.locator('[data-pwa-install-help-close]').click();
 await page.evaluate(()=>{window.testPrompt=0;const e=new Event('beforeinstallprompt');e.prompt=()=>{window.testPrompt++;return Promise.resolve()};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e)});
 await page.locator('[data-pwa-install]').click();assert.equal(await page.evaluate(()=>window.testPrompt),1);
 await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));assert.equal(await page.locator('[data-pwa-install]').isVisible(),false);
 await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration(location.href);return r?.active?.scriptURL.endsWith('/equipos-service-worker.js')});
 await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/equipos-service-worker.js'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await context.setOffline(true);await page.goto('http://127.0.0.1:8766/solicitar-equipo.html?source=pwa');assert.equal(await page.locator('#identify').isVisible(),true);assert.equal(await page.title(),'Solicitar equipo | EDECA');
 await context.setOffline(false);
 const ios=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',viewport:{width:390,height:844}});const p=await ios.newPage();await p.goto('http://127.0.0.1:8766/solicitar-equipo.html');await p.locator('[data-pwa-install]').click();assert.match(await p.locator('[data-pwa-install-help-text]').textContent(),/Safari.*Compartir/);
 assert.deepEqual(errors,[]); console.log('PASS: regreso inicial, regreso desde equipos, limpieza, ayuda, instalación nativa simulada, appinstalled, SW aislado, apertura offline, móvil sin desbordamiento, ayuda iOS, sin errores JS.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

