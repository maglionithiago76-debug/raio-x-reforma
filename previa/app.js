/* Prévia local: screen logic. Reads the files with core.js (no upload), looks up the buyers' CNPJs in the public base
   (only the CNPJ number leaves, and only when the box is ticked) and builds the totals-only summary file. */
(function () {
  "use strict";
  var C = window.RaioxCore, RX = window.RX || {};
  var $ = function (id) { return document.getElementById(id); };
  var SOURCES = ["https://brasilapi.com.br/api/cnpj/v1/", "https://minhareceita.org/"];
  var GAP_MS = 350, TOP_BUYERS = 15;
  var state = null;       // {texts, read, regimes, names, demo, run}
  var portfolio = [];     // clients seen in this session (memory only)
  var runId = 0;

  function brl(v) { return "R$ " + Math.round(v).toLocaleString("pt-BR"); }
  function pct(v) { return isFinite(v) ? Math.round(v * 100) + "%" : "–"; }
  function cnpjFmt(c) { return c.length === 14 ? c.slice(0, 2) + "." + c.slice(2, 5) + "." + c.slice(5, 8) + "/" + c.slice(8, 12) + "-" + c.slice(12) : c; }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function row(cells, cls) {
    var tr = el("tr", null, cls);
    cells.forEach(function (c) { tr.appendChild(c instanceof Node ? c : el("td", c)); });
    return tr;
  }
  function status(id, text, error) { var e = $(id); e.textContent = text || ""; e.classList.toggle("erro", !!error); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function monthName(m) { return m.slice(5) + "/" + m.slice(0, 4); }

  // ---------- files ----------
  function readFile(f) {
    return f.arrayBuffer().then(function (b) { return { name: f.name, bytes: new Uint8Array(b) }; });
  }
  async function start(fileList, demoRegimes) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) { return /\.(xml|zip)$/i.test(f.name); });
    if (!files.length) return status("status", "Escolha arquivos .xml ou .zip.", true);
    var mine = ++runId;
    status("status", "Lendo " + files.length + (files.length === 1 ? " arquivo" : " arquivos") + " neste computador...");
    try {
      // (new browsers give File its own .bytes() method, so test the type, not the property)
      var loaded = files[0] instanceof Blob ? await Promise.all(files.map(readFile)) : files;
      var texts = await C.expand(loaded);
      if (mine !== runId) return;
      if (!texts.length) return status("status", "Não achei nenhum .xml nesses arquivos.", true);
      state = { texts: texts, regimes: demoRegimes || {}, names: {}, demo: !!demoRegimes, done: !!demoRegimes };
      analyse();
    } catch (e) {
      status("status", "Não consegui ler: " + (e && e.message ? e.message : "arquivo inválido") + ". Tente o .zip original ou os .xml soltos.", true);
    }
  }

  function analyse(client) {
    var mine = runId;
    state.read = C.readAll(state.texts, client);
    var hasSale = state.read.items.some(function (i) { return i.kind === "sale"; });
    if (!hasSale) {
      $("resultado").hidden = true; $("pedido").hidden = true;
      return status("status", "Li " + state.texts.length + " XML, mas não achei nota de venda de uma mesma empresa. Confira se são NF-e ou NFS-e autorizadas.", true);
    }
    status("status", state.texts.length + " XML lidos aqui, no seu navegador. Nada foi enviado.");
    render();
    $("resultado").hidden = false; $("pedido").hidden = false;
    $("resultado").scrollIntoView({ behavior: "smooth", block: "start" });
    if (!state.demo) lookups(mine);
  }

  // ---------- public CNPJ base ----------
  async function fetchCnpj(cnpj) {
    for (var i = 0; i < SOURCES.length; i++) {
      try {
        var r = await fetch(SOURCES[i] + cnpj, { headers: { Accept: "application/json" }, referrerPolicy: "no-referrer", credentials: "omit" });
        if (r.ok) return await r.json();
        if (r.status === 404 || r.status === 400) return null;  // not in the base: no point in asking the other source
      } catch (e) { /* network or blocked: try the next source */ }
    }
    return undefined;
  }
  async function lookups(mine) {
    if (!$("consultar").checked) {
      state.done = true; render();
      return status("progresso", "Consulta à base pública desligada: os compradores com CNPJ aparecem como “sem consulta”.");
    }
    var plan = C.lookupPlan(state.read).filter(function (c) { return /^\d{14}$/.test(c) && !state.regimes[c]; });
    for (var i = 0; i < plan.length; i++) {
      if (mine !== runId) return;
      status("progresso", "Consultando compradores na base pública de CNPJ: " + (i + 1) + " de " + plan.length + "...");
      var d = await fetchCnpj(plan[i]);
      if (mine !== runId) return;
      if (d) { state.regimes[plan[i]] = C.regimeOf(d); state.names[plan[i]] = String(d.razao_social || "").slice(0, 60); }
      if (i % 3 === 2 || i === plan.length - 1) render();
      await sleep(GAP_MS);
    }
    if (mine !== runId) return;
    state.done = true;
    var s = C.summarize(state.read, state.regimes);
    status("progresso", s.shareUnknown > 0.2 ? "Atenção: mais de 20% das vendas ficaram sem consulta. O percentual acima pode estar abaixo do real." : "");
    render();
  }

  // ---------- screen ----------
  function fill(table, rows) { var tb = $(table).tBodies[0]; tb.textContent = ""; rows.forEach(function (r) { tb.appendChild(r); }); }
  function render() {
    var r = state.read, s = C.summarize(r, state.regimes);
    state.summary = s;
    $("eh-exemplo").hidden = !state.demo;
    var period = s.months.length ? monthName(s.months[0]) + " a " + monthName(s.months[s.months.length - 1]) : "–";
    $("empresa-linha").textContent = "Empresa: CNPJ " + cnpjFmt(r.client) + " · " + r.notes.length + " notas lidas · vendas de " + period +
      " (" + s.months.length + (s.months.length === 1 ? " mês completo" : " meses completos") + ")";
    var sel = $("emissor");
    $("varias").hidden = r.issuers.length < 2 || !r.skipped["nota de outra empresa"];
    if (sel.options.length !== r.issuers.length) {
      sel.textContent = "";
      r.issuers.forEach(function (it) { var o = el("option", cnpjFmt(it[0]) + " (" + it[1] + " notas emitidas)"); o.value = it[0]; sel.appendChild(o); });
    }
    sel.value = r.client;
    $("n-credito").textContent = state.done || s.shareCredit > 0 ? pct(s.shareCredit) : "…";
    $("n-vendas").textContent = brl(s.totalYear);
    $("n-vendas-nota").textContent = "vendas por ano (projeção: " + s.months.length + (s.months.length === 1 ? " mês" : " meses") + " × " + s.factor.toFixed(1).replace(".", ",") + ")";
    $("n-incerto").textContent = pct(s.shareUnknown);

    var top = Math.max.apply(null, C.GROUPS.map(function (g) { return Math.abs(s.groups[g] || 0); }).concat([1]));
    fill("t-grupos", C.GROUPS.filter(function (g) { return s.groups[g]; }).sort(function (a, b) { return s.groups[b] - s.groups[a]; }).map(function (g) {
      var bar = el("td", null, "barra"), i = el("i");
      i.style.width = Math.max(1, Math.abs(s.groups[g]) / top * 100) + "%";
      bar.appendChild(i);
      return row([el("td", C.GROUP_NAMES[g], "esq"), el("td", brl(s.groups[g] * s.factor)), el("td", pct(s.groups[g] / s.total)), bar], g === "regular" ? "credito" : "");
    }));
    if ($("t-grupos").tHead.rows[0].cells.length === 3) $("t-grupos").tHead.rows[0].appendChild(el("th", "", "barra"));

    fill("t-compradores", s.buyers.slice(0, TOP_BUYERS).map(function (b) {
      var tag = el("td", null, "esq"), name = b.regime === "regular" ? "Fora do Simples" : b.regime === "simples" ? "Simples" : b.regime === "mei" ? "MEI" :
        b.regime === "naocontrib" ? "Não é empresa" : "Sem consulta";
      tag.appendChild(el("span", name, "selo selo--" + b.regime));
      return row([el("td", cnpjFmt(b.cnpj), "esq"), el("td", state.names[b.cnpj] || (state.demo ? "(fictício)" : "–"), "esq"), tag, el("td", brl(b.value)), el("td", pct(b.value / s.total))],
        b.regime === "regular" ? "credito" : "");
    }));
    $("mais-compradores").textContent = s.buyers.length > TOP_BUYERS ? "E mais " + (s.buyers.length - TOP_BUYERS) + " compradores com CNPJ, somados na tabela de cima." : "";
    fill("t-compras", [
      row([el("td", "Fornecedores do regime regular (geram crédito se o cliente recolher por fora), sem ICMS, PIS e Cofins destacados", "esq"), el("td", brl(s.purchasesRegularYear) + "/ano")]),
      row([el("td", "Fornecedores do Simples ou sem regime identificado", "esq"), el("td", brl(s.purchasesOtherYear) + "/ano")])
    ]);
    var ign = Object.keys(r.skipped).map(function (k) { return k + ": " + r.skipped[k]; });
    $("ignorados").textContent = ign.length ? ign.join(" · ") : "Nenhum.";
    order();
  }

  // ---------- summary file ----------
  function info() { return { empresa: $("f-empresa").value, anexo: $("f-anexo").value, escritorio: $("f-escritorio").value }; }
  function order() {
    if (!state) return;
    $("ver-resumo").textContent = C.buildResumo(state.read, state.regimes, info());
    if (RX.preco) $("preco").textContent = "R$ " + String(RX.preco).replace(".", ",").replace(/,0$/, "");
    var zap = $("zap"), msg = "Oi! Fiz a prévia local de um cliente e quero o relatório completo. Vou anexar aqui o arquivo de resumo.";
    if (RX.whatsapp) { zap.href = "https://wa.me/" + RX.whatsapp + "?text=" + encodeURIComponent(msg); zap.removeAttribute("aria-disabled"); }
    else { zap.removeAttribute("href"); zap.setAttribute("aria-disabled", "true"); zap.title = "WhatsApp em breve"; }
  }
  function download() {
    if (!state) return;
    var i = info();
    if (state.demo) return status("pedido-status", "Este é o exemplo fictício. Carregue os XMLs de um cliente seu pra gerar o resumo.", true);
    if (!i.empresa.trim() || !i.anexo) return status("pedido-status", "Preencha o nome da empresa e o anexo do Simples.", true);
    if (!state.done) return status("pedido-status", "Espere a consulta dos compradores terminar (alguns segundos).", true);
    var blob = new Blob([C.buildResumo(state.read, state.regimes, i)], { type: "application/xml" });
    var a = el("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = "raiox-resumo-" + state.read.client.slice(0, 8) + ".xml";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    status("pedido-status", "Resumo baixado (" + a.download + "). Agora é só anexar esse arquivo na conversa do WhatsApp.");
    remember(i.empresa.trim());
  }
  function remember(name) {
    var s = state.summary, id = state.read.client;
    portfolio = portfolio.filter(function (p) { return p.id !== id; });
    portfolio.push({ id: id, name: name || cnpjFmt(id), total: s.totalYear, credit: s.shareCredit, unknown: s.shareUnknown });
    portfolio.sort(function (a, b) { return b.credit - a.credit; });
    fill("t-carteira-lista", portfolio.map(function (p) { return row([el("td", p.name, "esq"), el("td", brl(p.total)), el("td", pct(p.credit)), el("td", pct(p.unknown))]); }));
    $("carteira").hidden = false;
  }
  function another() {
    if (state && !state.demo) remember($("f-empresa").value.trim());
    runId++; state = null;
    ["resultado", "pedido"].forEach(function (id) { $(id).hidden = true; });
    ["f-empresa", "f-anexo"].forEach(function (id) { $(id).value = ""; });
    $("arquivos").value = "";
    status("status", ""); status("progresso", ""); status("pedido-status", "");
    $("entrada").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- wiring ----------
  var drop = $("solta"), input = $("arquivos");
  $("escolher").addEventListener("click", function (e) { e.stopPropagation(); input.click(); });
  drop.addEventListener("click", function () { input.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", function () { start(input.files); });
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("sobre"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("sobre"); }); });
  drop.addEventListener("drop", function (e) { start(e.dataTransfer.files); });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); });
  $("emissor").addEventListener("change", function () { runId++; state.regimes = {}; state.names = {}; state.done = false; analyse($("emissor").value); });
  ["f-empresa", "f-anexo", "f-escritorio"].forEach(function (id) { $(id).addEventListener("input", order); });
  $("baixar").addEventListener("click", download);
  $("outro").addEventListener("click", another);
  $("demo").addEventListener("click", function () {
    status("status", "Carregando o exemplo fictício...");
    Promise.all([fetch("exemplo.zip").then(function (r) { return r.arrayBuffer(); }), fetch("exemplo-regimes.json").then(function (r) { return r.json(); })])
      .then(function (v) { start([{ name: "exemplo.zip", bytes: new Uint8Array(v[0]) }], v[1]); })
      .catch(function () { status("status", "Não consegui carregar o exemplo. Abra o PDF de exemplo na página inicial.", true); });
  });
  if (RX.vendedor) document.querySelectorAll("[data-vendedor]").forEach(function (s) { s.textContent = RX.vendedor; });
  if (RX.whatsapp) {
    var p = RX.whatsapp.slice(2), fone = "(" + p.slice(0, 2) + ") " + p.slice(2, -4) + "-" + p.slice(-4);
    document.querySelectorAll("[data-fone]").forEach(function (s) { s.textContent = fone; });
  }
})();
