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
  document.body.appendChild(button);
})();
