(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    });
  }

  var deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function refreshVisibility() {
    document.querySelectorAll("[data-pwa-install]").forEach(function (btn) {
      btn.hidden = isStandalone() || (!deferredPrompt && !btn.hasAttribute("data-pwa-install-always"));
      btn.classList.toggle("is-ready", Boolean(deferredPrompt));
    });
  }

  function showInstallHelp() {
    var dialog = document.querySelector("[data-pwa-install-help]");
    var text = dialog && dialog.querySelector("[data-pwa-install-help-text]");
    var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (text) {
      text.innerHTML = isIos
        ? "Toque <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>."
        : "Abra el menú de su navegador y seleccione <strong>Instalar aplicación</strong> o <strong>Agregar a la pantalla de inicio</strong>.";
    }
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    refreshVisibility();
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    refreshVisibility();
  });

  document.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-pwa-install]");
    if (!btn) return;
    if (!deferredPrompt) {
      showInstallHelp();
      return;
    }
    btn.disabled = true;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () {
      deferredPrompt = null;
      btn.disabled = false;
      refreshVisibility();
    });
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest("[data-pwa-install-help-close]")) return;
    var dialog = event.target.closest("dialog");
    if (dialog) dialog.close();
  });

  document.addEventListener("DOMContentLoaded", refreshVisibility);
})();
