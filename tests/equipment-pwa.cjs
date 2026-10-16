const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:"msedge"});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({rpc:async()=>({data:{found:true,authorized:true,full_name:'Persona de prueba',kind:'student',authorization_label:'Prueba',equipment:[{id:1,name:'Brújula',available:4}]}})})};`}));
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8766/solicitar-equipo.html');
 assert.equal(await page.locator('#studentBack').isVisible(),false);
 assert.equal(await page.locator('[data-pwa-install]').isVisible(),true);
 await page.locator('#nationalId').fill('000000'); await page.locator('#idForm button').click();
 await page.locator('#requestArea').waitFor({state:'visible'});assert.equal(await page.locator('#studentBack').isVisible(),true);
 await page.locator('[data-delta="1"]').click(); assert.equal(await page.locator('#qty-1').textContent(),'1');
 await page.locator('#studentBack').click();assert.equal(await page.locator('#identify').isVisible(),true);assert.equal(await page.locator('#requestArea').isVisible(),false);assert.equal(await page.locator('#nationalId').inputValue(),'');assert.equal(await page.locator('#studentBack').isVisible(),false);
 await page.locator('[data-pwa-install]').click();assert.equal(await page.locator('#pwaInstallHelp').isVisible(),true);await page.locator('[data-pwa-install-help-close]').click();
 await page.evaluate(()=>{window.testPrompt=0;const e=new Event('beforeinstallprompt');e.prompt=()=>{window.testPrompt++;return Promise.resolve()};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e)});
 await page.locator('[data-pwa-install]').click();assert.equal(await page.evaluate(()=>window.testPrompt),1);
 await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));assert.equal(await page.locator('[data-pwa-install]').isVisible(),true);
 await page.locator('[data-pwa-install]').click();assert.match(await page.locator('[data-pwa-install-help-text]').textContent(),/lista de aplicaciones/);await page.locator('[data-pwa-install-help-close]').click();
 await page.evaluate(()=>{const e=new Event('beforeinstallprompt');e.prompt=()=>Promise.reject(new Error('rejected'));e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e)});
 await page.locator('[data-pwa-install]').click();await page.locator('#pwaInstallHelp').waitFor({state:'visible'});assert.equal(await page.locator('[data-pwa-install]').isEnabled(),true);await page.locator('[data-pwa-install-help-close]').click();
 await page.evaluate(()=>{const e=new Event('beforeinstallprompt');e.prompt=()=>Promise.resolve();e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e)});
 await page.locator('[data-pwa-install]').click();await page.waitForFunction(()=>document.querySelector('#installStatus').textContent.includes('aceptada'));assert.equal(await page.locator('[data-pwa-install]').isVisible(),true);
 const standalone=await browser.newContext({viewport:{width:390,height:844}});
 await standalone.addInitScript(()=>{const original=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,addEventListener:()=>{}}:original(q)});
 const sp=await standalone.newPage();await sp.goto('http://127.0.0.1:8766/solicitar-equipo.html');assert.equal(await sp.locator('[data-pwa-install]').isVisible(),true);assert.equal(await sp.locator('#studentBack').isVisible(),false);await sp.locator('[data-pwa-install]').click();assert.match(await sp.locator('[data-pwa-install-help-text]').textContent(),/modo aplicación/);

 await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration(location.href);return r?.active?.scriptURL.endsWith('/equipos-service-worker.js')});
 await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/equipos-service-worker.js'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await context.setOffline(true);await page.goto('http://127.0.0.1:8766/solicitar-equipo.html?source=pwa');assert.equal(await page.locator('#identify').isVisible(),true);assert.equal(await page.title(),'Solicitar equipo | EDECA');
 await context.setOffline(false);
 const ios=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',viewport:{width:390,height:844}});const p=await ios.newPage();await p.goto('http://127.0.0.1:8766/solicitar-equipo.html');await p.locator('[data-pwa-install]').click();assert.match(await p.locator('[data-pwa-install-help-text]').textContent(),/Safari.*Compartir/);
 assert.deepEqual(errors,[]); console.log('PASS: Regresar oculto en inicio y visible en equipos, limpieza, instalación aceptada/cancelada/error simulados, ayuda persistente tras appinstalled y en standalone, SW aislado, apertura offline, móvil sin desbordamiento, ayuda iOS, sin errores JS.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

