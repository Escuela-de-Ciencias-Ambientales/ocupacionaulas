(() => {
  'use strict';
  const page = location.pathname.split('/').pop() || 'index.html';
  if (page === 'index.html' || new URLSearchParams(location.search).has('embedded')) return;
  const fallback = ['usuarios.html','mis-giras.html','tramites-vehiculos.html','bodega-equipos.html'].includes(page) ? 'reservas.html' : 'index.html';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'global-back-button'; button.textContent = '← Regresar';
  button.setAttribute('aria-label', 'Regresar a la página anterior');
  button.addEventListener('click', () => {
    const referrer = document.referrer;
    const sameApp = referrer && (location.protocol === 'file:' ? referrer.startsWith('file:') : new URL(referrer).origin === location.origin);
    if (sameApp && history.length > 1) history.back(); else location.href = fallback;
  });
  const warehouseToolbar = page === 'bodega-equipos.html' && document.querySelector('.sigep-module-toolbar');
  const studentMain = page === 'solicitar-equipo.html' && document.querySelector('main');
  if (studentMain) {
    button.classList.add('student-back-button');
    studentMain.prepend(button);
  } else if (warehouseToolbar) {
    button.classList.add('warehouse-back-button');
    warehouseToolbar.appendChild(button);
  } else {
    document.body.appendChild(button);
  }
})();
