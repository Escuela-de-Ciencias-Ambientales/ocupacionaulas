(function () {
  "use strict";
  var deferredPrompt = null;
  var installationRequested = false;
  var displayMode = window.matchMedia("(display-mode: standalone)");

  function isStandalone() {
    return displayMode.matches || navigator.standalone === true;
  }
  function status(message) {
    var output = document.getElementById("installStatus");
    if (output) { output.textContent = message; output.hidden = false; }
  }
  function refreshVisibility() {
    document.querySelectorAll("[data-pwa-install]").forEach(function (btn) {
      // Keep help available even if Chrome has accepted installation or this is a shortcut.
      btn.hidden = false;
      btn.classList.toggle("is-ready", Boolean(deferredPrompt));
      var label = btn.querySelector("[data-pwa-install-label]");
      if (label) label.textContent = isStandalone() || installationRequested
        ? "¿No encuentra el icono de la app?"
        : "Instalar app en el teléfono";
    });
  }
  function showInstallHelp() {
    var dialog = document.querySelector("[data-pwa-install-help]");
    var text = dialog && dialog.querySelector("[data-pwa-install-help-text]");
    var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (text) {
      if (isStandalone()) {
        text.textContent = "Esta ventana está abierta en modo aplicación. Busque Equipos EDECA o Préstamo Equipos EDECA en la lista de aplicaciones del teléfono y mantenga pulsado su icono para colocarlo en Inicio. Si no aparece, abra esta misma dirección en Chrome y use el menú ⋮ → Agregar a la pantalla principal → Instalar. Si Chrome ofrece Crear acceso directo, puede usar esa opción para colocar el icono en Inicio.";
      } else if (isIos) {
        text.textContent = "En Safari, toque Compartir → Agregar a pantalla de inicio y confirme Agregar. Busque Equipos EDECA en la pantalla de inicio o en la biblioteca de apps.";
      } else {
        text.textContent = "En Chrome para Android, abra el menú ⋮ → Agregar a la pantalla principal → Instalar y confirme. Espere a que Chrome termine y busque Equipos EDECA o Préstamo Equipos EDECA en la lista de aplicaciones; mantenga pulsado el icono para colocarlo en Inicio. Si no aparece, revise las notificaciones de Chrome y vuelva a intentarlo con conexión. Si el menú ofrece Crear acceso directo, esa opción permite colocar el icono en Inicio. Desde WhatsApp u otra app, abra primero el enlace en Chrome.";
      }
    }
    if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("equipos-service-worker.js", { scope: "./solicitar-equipo.html" }).catch(function () {
        status("No se pudo preparar la app para usarla sin conexión. Compruebe la conexión y vuelva a abrir esta página en Chrome.");
      });
    });
  }
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    installationRequested = false;
    refreshVisibility();
  });
  window.addEventListener("appinstalled", function () {
    installationRequested = true;
    deferredPrompt = null;
    status("Chrome recibió la instalación. Espere a que termine y busque Equipos EDECA en la lista de aplicaciones. Si no aparece el icono, pulse el botón de ayuda.");
    refreshVisibility();
  });
  document.addEventListener("click", async function (event) {
    var btn = event.target.closest("[data-pwa-install]");
    if (!btn) return;
    if (!deferredPrompt || isStandalone()) { showInstallHelp(); return; }
    var prompt = deferredPrompt;
    deferredPrompt = null;
    btn.disabled = true;
    try {
      // Call directly in the click handler, preserving the user's activation.
      await prompt.prompt();
      var choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        installationRequested = true;
        status("Solicitud de instalación aceptada. Espere a que Chrome termine y busque Equipos EDECA en la lista de aplicaciones. Si no aparece, pulse el botón de ayuda.");
      } else {
        status("No se completó la instalación. Puede volver a intentarlo desde el menú de Chrome; el botón muestra los pasos.");
      }
    } catch (error) {
      status("Chrome no pudo abrir la instalación. Use el menú del navegador siguiendo estos pasos.");
      showInstallHelp();
    } finally {
      btn.disabled = false;
      refreshVisibility();
    }
  });
  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-pwa-install-help-close]")) event.target.closest("dialog").close();
  });
  displayMode.addEventListener?.("change", refreshVisibility);
  document.addEventListener("DOMContentLoaded", refreshVisibility);
  refreshVisibility();
})();
