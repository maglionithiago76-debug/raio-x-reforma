// WhatsApp buttons (data-wa = prefilled text) and the Mercado Pago button (data-pagar). Config: config.js (window.RX).
(function () {
  var c = window.RX || {};
  document.querySelectorAll("[data-wa]").forEach(function (a) {
    if (c.whatsapp) {
      a.href = "https://wa.me/" + c.whatsapp + "?text=" + encodeURIComponent(a.getAttribute("data-wa"));
      a.target = "_blank"; a.rel = "noopener";
    } else {
      a.href = "#preco"; a.title = "WhatsApp em breve";
    }
  });
  document.querySelectorAll("[data-pagar]").forEach(function (a) {
    if (c.pagar) { a.href = c.pagar; a.target = "_blank"; a.rel = "noopener"; } else { a.style.display = "none"; }
  });
  if (c.vendedor) document.querySelectorAll("[data-vendedor]").forEach(function (s) { s.textContent = c.vendedor; });
  if (c.whatsapp) {
    var p = c.whatsapp.slice(2), fone = "(" + p.slice(0, 2) + ") " + p.slice(2, -4) + "-" + p.slice(-4);
    document.querySelectorAll("[data-fone]").forEach(function (s) { s.textContent = fone; });
  }
})();
// Scene: XMLs slide in and the bars grow when the dark section enters the screen.
(function () {
  var cena = document.querySelector(".cena");
  if (!cena || !("IntersectionObserver" in window)) { if (cena) cena.classList.add("ativa"); return; }
  new IntersectionObserver(function (es, o) {
    es.forEach(function (e) { if (e.isIntersecting) { cena.classList.add("ativa"); o.disconnect(); } });
  }, { threshold: 0.35 }).observe(cena);
})();
