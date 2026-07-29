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
      btn.hidden = isStandalone() || !deferredPrompt;
    });
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
    if (!btn || !deferredPrompt) return;
    btn.disabled = true;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () {
      deferredPrompt = null;
      btn.disabled = false;
      refreshVisibility();
    });
  });

  document.addEventListener("DOMContentLoaded", refreshVisibility);
})();
