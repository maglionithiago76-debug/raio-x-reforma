/* Raio-X da Reforma · prévia local.
 * Reads NF-e/NFC-e/NFS-e XMLs (also inside .zip) in the accountant's own browser. Nothing here talks to the network.
 * It is a line-by-line port of src/xmlread.py (same rules for CFOP, returns, cancelled notes, complete months);
 * tests/test_previa.py checks that both give the same numbers. Works in the browser (window.RaioxCore) and in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RaioxCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- tiny XML reader (namespace-agnostic, like ElementTree with local names) ----------
  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function unescapeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, function (m, e) {
      if (e[0] === "#") {
        var code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  function local(name) { var i = name.indexOf(":"); return i < 0 ? name : name.slice(i + 1); }

  function parseXml(text) {
    var re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s\/>!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    var top = { name: "#doc", attrs: {}, children: [], text: "" }, stack = [top], m, last = 0;
    while ((m = re.exec(text))) {
      if (m.index !== last) throw new Error("xml inválido");
      last = re.lastIndex;
      var cur = stack[stack.length - 1];
      if (m[1] !== undefined) { if (!cur.children.length) cur.text += m[1]; }
      else if (m[2] !== undefined) {
        if (stack.length < 2 || cur.raw !== m[2]) throw new Error("xml inválido");
        stack.pop();
      } else if (m[3] !== undefined) {
        var node = { name: local(m[3]), raw: m[3], attrs: {}, children: [], text: "" }, am,
          are = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        while ((am = are.exec(m[4] || ""))) node.attrs[local(am[1])] = unescapeXml(am[2] !== undefined ? am[2] : am[3]);
        cur.children.push(node);
        if (!m[5]) stack.push(node);
      } else if (m[6] !== undefined) { if (!cur.children.length) cur.text += unescapeXml(m[6]); }  // text before the 1st child
    }
    if (last !== text.length || stack.length !== 1 || top.children.length !== 1) throw new Error("xml inválido");
    return top.children[0];
  }

  function iter(el, out) { out = out || []; out.push(el); for (var i = 0; i < el.children.length; i++) iter(el.children[i], out); return out; }
  function firstDesc(el, name) {  // first descendant in document order, not the element itself
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (c.name === name) return c;
      var d = firstDesc(c, name);
      if (d) return d;
    }
    return null;
  }
  function find(el) {
    var cur = el;
    for (var i = 1; i < arguments.length && cur; i++) cur = firstDesc(cur, arguments[i]);
    return cur || null;
  }
  function txt(el) {
    if (!el) return "";
    var e = arguments.length > 1 ? find.apply(null, arguments) : el;
    return e && e.text ? e.text.trim() : "";
  }
  function num(s) { if (!s) return 0; var v = Number(String(s).replace(",", ".")); return isFinite(v) ? v : 0; }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

  // ---------- NF-e / NFS-e -> note ----------
  function parseNfe(root, name) {
    var inf = find(root, "infNFe");
    if (!inf) return null;
    var cstat = txt(root, "protNFe", "cStat");
    if (cstat && cstat !== "100" && cstat !== "150") return { skip: "cStat " + cstat };
    var emit = find(inf, "emit"), dest = find(inf, "dest");
    var head = {
      doc: "nfe", model: txt(inf, "ide", "mod"), date: (txt(inf, "ide", "dhEmi") || txt(inf, "ide", "dEmi")).slice(0, 10),
      emit: digits(txt(emit, "CNPJ")), emit_crt: txt(emit, "CRT"),
      emit_uf: txt(emit, "enderEmit", "UF"), emit_cmun: txt(emit, "enderEmit", "cMun"),
      dest: dest ? digits(txt(dest, "CNPJ")) : "", dest_cpf: !!(dest && txt(dest, "CPF")),
      dest_uf: dest ? txt(dest, "enderDest", "UF") : "", dest_cmun: dest ? txt(dest, "enderDest", "cMun") : "",
      tpnf: txt(inf, "ide", "tpNF"), key: (inf.attrs.Id || "").slice(3), file: name,
      fin: txt(inf, "ide", "finNFe"), ind_final: txt(inf, "ide", "indFinal"),
      ind_ie_dest: dest ? txt(dest, "indIEDest") : ""
    };
    var items = [];
    iter(inf).forEach(function (det) {
      if (det.name !== "det") return;
      var prod = find(det, "prod"), ibscbs = find(det, "IBSCBS"), imp = find(det, "imposto");
      var v = num(txt(prod, "vProd")) + num(txt(prod, "vFrete")) + num(txt(prod, "vSeg")) + num(txt(prod, "vOutro")) - num(txt(prod, "vDesc"));
      var embedded = 0;  // taxes inside the price that leave the IBS/CBS base (ICMS, PIS, Cofins)
      if (imp) {
        var icms = find(imp, "ICMS"), pis = find(imp, "PIS"), cof = find(imp, "COFINS");
        if (icms) embedded += num(txt(icms, "vICMS"));
        if (pis) embedded += num(txt(pis, "vPIS"));
        if (cof) embedded += num(txt(cof, "vCOFINS"));
      }
      items.push({ value: round2(v), embedded: round2(embedded), ncm: txt(prod, "NCM"), nbs: "", cfop: txt(prod, "CFOP"),
        cst: ibscbs ? txt(ibscbs, "CST") : "", cclasstrib: ibscbs ? txt(ibscbs, "cClassTrib") : "",
        desc: txt(prod, "xProd").slice(0, 60) });
    });
    head.items = items;
    return head;
  }

  function nfseCrt(inf) {  // provider regime as an NF-e CRT
    var nat = txt(inf, "opSimpNac");
    if (nat) return ({ "1": "3", "2": "4", "3": "1" })[nat] || "";
    return ({ "1": "1", "2": "3" })[txt(inf, "OptanteSimplesNacional")] || "";
  }
  function withKids(el) { return el && el.children.length ? el : null; }  // ElementTree truthiness in the Python source
  function parseNfse(root, name) {
    var inf = withKids(find(root, "infNFSe")) || withKids(find(root, "InfNfse")) || withKids(find(root, "infDPS")) || root;
    var prest = withKids(find(inf, "prest")) || withKids(find(inf, "emit")) || withKids(find(inf, "PrestadorServico")) || find(inf, "Prestador");
    var toma = withKids(find(inf, "toma")) || withKids(find(inf, "TomadorServico")) || find(inf, "Tomador");
    var value = num(txt(inf, "vServ") || txt(inf, "ValorServicos") || txt(inf, "vServPrest"));
    if (!value) return null;
    var ibscbs = find(inf, "IBSCBS");
    return {
      doc: "nfse", model: "nfse",
      date: (txt(inf, "dhEmi") || txt(inf, "dhProc") || txt(inf, "DataEmissao") || txt(inf, "dCompet")).slice(0, 10),
      emit: prest ? digits(txt(prest, "CNPJ") || txt(prest, "Cnpj")) : "", emit_crt: nfseCrt(inf), emit_uf: "",
      emit_cmun: txt(inf, "cLocEmi") || txt(inf, "cLocPrestacao") || txt(inf, "CodigoMunicipio"),
      dest: toma ? digits(txt(toma, "CNPJ") || txt(toma, "Cnpj")) : "", dest_cpf: !!(toma && (txt(toma, "CPF") || txt(toma, "Cpf"))),
      dest_uf: "", dest_cmun: "", tpnf: "1", key: txt(inf, "chNFSe") || inf.attrs.Id || "", file: name,
      fin: "1", ind_final: "", ind_ie_dest: "",
      items: [{ value: round2(value), embedded: 0, ncm: "", nbs: digits(txt(inf, "cNBS")), cfop: "",
        cst: ibscbs ? txt(ibscbs, "CST") : "", cclasstrib: ibscbs ? txt(ibscbs, "cClassTrib") : "",
        desc: (txt(inf, "xDescServ") || txt(inf, "Discriminacao")).slice(0, 60) }]
    };
  }

  function parseText(text, name) {
    var root;
    try { root = parseXml(text.replace(/^\uFEFF/, "").trim()); } catch (e) { return { skip: "xml inválido", file: name }; }
    var tags = {};
    iter(root).forEach(function (e) { tags[e.name] = 1; });
    if (tags.infNFe) return parseNfe(root, name);
    if (tags.infNFSe || tags.InfNfse || tags.infDPS || tags.Nfse || tags.NFSe || tags.CompNfse) return parseNfse(root, name);
    if (tags.procEventoNFe || tags.evento || tags.retEvento) return { skip: "evento", file: name };
    if (tags.raioxResumo) return { skip: "resumo da prévia", file: name };
    return { skip: "tipo desconhecido", file: name };
  }

  function decode(bytes) {  // XML declares its own encoding; NFS-e from city halls is often ISO-8859-1
    var head = "";
    for (var i = 0; i < Math.min(bytes.length, 200); i++) head += String.fromCharCode(bytes[i]);
    var m = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head), enc = m ? m[1].toLowerCase() : "utf-8";
    try { return new TextDecoder(enc).decode(bytes); } catch (e) { return new TextDecoder("utf-8").decode(bytes); }
  }

  // ---------- .zip (stored / deflate), no library: central directory + DecompressionStream ----------
  var MAX_XML = 5000000, MAX_FILES = 20000;
  async function inflateRaw(bytes) {
    var ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzip(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), eocd = -1, out = [];
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("zip inválido");
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), td = new TextDecoder("utf-8");
    for (var k = 0; k < n && out.length < MAX_FILES; k++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip inválido");
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true),
        nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true),
        lho = dv.getUint32(p + 42, true), name = td.decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/\.xml$/i.test(name) || name.indexOf("__MACOSX") === 0 || usize >= MAX_XML) continue;
      if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error("zip inválido");
      var start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = bytes.subarray(start, start + csize);
      if (method === 0) out.push({ name: name, bytes: data });
      else if (method === 8) out.push({ name: name, bytes: await inflateRaw(data) });
    }
    return out;
  }

  /** files: [{name, bytes: Uint8Array}] -> [{name, text}] for every .xml, also inside .zip files (sorted like the server). */
  async function expand(files) {
    var out = [];
    files = files.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (/\.xml$/i.test(f.name)) out.push({ name: f.name, text: decode(f.bytes) });
      else if (/\.zip$/i.test(f.name)) (await unzip(f.bytes)).forEach(function (m) { out.push({ name: f.name + ":" + m.name, text: decode(m.bytes) }); });
    }
    return out;
  }

  // ---------- notes -> items (sales and purchases of the client) ----------
  function classify(cfop, doc, mineOut, iIssued) {
    if (doc === "nfse" || !cfop) return [mineOut ? "sale" : "purchase", 1];
    var c = cfop.replace(/\./g, ""), first = c.slice(0, 1), grp = c.slice(1, 2);
    if (first === "5" || first === "6" || first === "7") {  // an outgoing operation of whoever issued the note
      if (c.slice(1) === "933" || grp === "1" || grp === "4") return [iIssued ? "sale" : "purchase", 1];
      if (grp === "2") return iIssued ? ["purchase", -1] : ["sale", -1];  // devolução
      return [null, 0];
    }
    if (first === "1" || first === "2" || first === "3") {  // an incoming note the client issued itself
      if (grp === "2") return ["sale", -1];
      if (grp === "1" || grp === "4" || c.slice(1) === "933") return ["purchase", 1];
    }
    return [null, 0];
  }

  /** texts: [{name, text}] -> {client, issuers, notes, items, skipped}. client: CNPJ (default = who issued most notes). */
  function readAll(texts, client) {
    var notes = [], skipped = {}, seen = {}, count = new Map();
    function skip(why) { skipped[why] = (skipped[why] || 0) + 1; }
    texts.forEach(function (t) {
      var n = parseText(t.text, t.name);
      if (n === null) skip("sem valor");
      else if (n.skip) skip(n.skip);
      else if (n.key && seen[n.key]) skip("duplicada");
      else { seen[n.key] = 1; notes.push(n); }
    });
    notes.forEach(function (n) { if (n.emit) count.set(n.emit, (count.get(n.emit) || 0) + 1); });
    var issuers = Array.from(count.entries()).sort(function (a, b) { return b[1] - a[1]; });  // stable: first seen wins ties
    client = digits(client || (issuers.length ? issuers[0][0] : ""));
    var items = [];
    notes.forEach(function (n) {
      if (n.fin === "2" || n.fin === "3") return skip("nota complementar/ajuste");
      var mineOut = n.emit === client && n.tpnf !== "0";
      var mineIn = n.dest === client || (n.emit === client && n.tpnf === "0");
      if (!(mineOut || mineIn)) return skip("nota de outra empresa");
      n.items.forEach(function (it) {
        var ks = classify(it.cfop, n.doc, mineOut, n.emit === client), kind = ks[0], sign = ks[1];
        if (!kind) return skip("CFOP " + it.cfop + " (remessa/outros)");
        var cust = "", b2b = true, otherCrt = "";
        if (kind === "sale") {
          cust = n.emit === client ? n.dest : n.emit;  // the other side of the note (own entry note for a return: dest)
          b2b = !!cust && !(mineOut && n.dest_cpf);
        } else otherCrt = n.emit !== client ? n.emit_crt : "";
        items.push({ value: it.value * sign, embedded: it.embedded * sign, ncm: it.ncm, nbs: it.nbs, cfop: it.cfop, cst: it.cst,
          cclasstrib: it.cclasstrib, desc: it.desc, kind: kind, doc: n.doc, date: n.date, b2b: b2b,
          customer: b2b && kind === "sale" ? cust : "", other_crt: otherCrt });
      });
    });
    return { client: client, issuers: issuers, notes: notes, items: items, skipped: skipped };
  }

  function completeMonths(items, kind, today) {
    var ms = {}, cur = (today || new Date().toISOString()).slice(0, 7);
    items.forEach(function (it) { if (it.kind === kind && it.date) ms[it.date.slice(0, 7)] = 1; });
    var list = Object.keys(ms).sort();
    return list.length > 1 && ms[cur] ? list.filter(function (m) { return m !== cur; }) : list;
  }

  // ---------- who takes credit (public CNPJ base, looked up by the page; rules of src/cnpj.py) ----------
  var NOT_CONTRIBUTOR_BUSINESS = { 2127: 1, 2151: 1 };  // SCP, consórcio de sociedades (LC 214, art. 26)
  function regimeOf(d) {  // d = JSON of the public CNPJ base (BrasilAPI / minhareceita.org)
    if (!d) return "unknown";
    if (d.opcao_pelo_mei) return "mei";
    if (d.opcao_pelo_simples) return "simples";
    var nat = parseInt(d.codigo_natureza_juridica, 10);
    if (isFinite(nat) && !(nat >= 2000 && nat < 3000 && !NOT_CONTRIBUTOR_BUSINESS[nat])) return "naocontrib";
    return "regular";
  }
  var GROUPS = ["regular", "simples", "mei", "naocontrib", "unknown", "cpf"];
  var GROUP_NAMES = {
    regular: "Empresas fora do Simples (aproveitam crédito)", simples: "Empresas do Simples", mei: "MEI",
    naocontrib: "CNPJ que não é empresa (órgão público, associação, condomínio...)", unknown: "CNPJ sem consulta",
    cpf: "Consumidor final (CPF ou sem identificação)"
  };

  /** Totals for the screen. regimes: {cnpj: "regular"|"simples"|...}; missing = "unknown". */
  function summarize(read, regimes, today) {
    regimes = regimes || {};
    var ms = completeMonths(read.items, "sale", today), mb = completeMonths(read.items, "purchase", today);
    var inS = {}, inB = {};
    ms.forEach(function (m) { inS[m] = 1; }); mb.forEach(function (m) { inB[m] = 1; });
    var ks = 12 / Math.max(1, ms.length), kb = 12 / Math.max(1, mb.length);
    var groups = {}, buyers = {}, total = 0, buyReg = 0, buyOther = 0;
    read.items.forEach(function (it) {
      var month = it.date.slice(0, 7);
      if (it.kind === "sale" && inS[month]) {
        var g = it.b2b ? (regimes[it.customer] || "unknown") : "cpf";
        groups[g] = (groups[g] || 0) + it.value;
        total += it.value;
        if (it.b2b) buyers[it.customer] = (buyers[it.customer] || 0) + it.value;
      } else if (it.kind === "purchase" && inB[month]) {
        var base = it.value - it.embedded;
        if (it.other_crt === "3") buyReg += base; else buyOther += base;
      }
    });
    var cnpjSales = total - (groups.cpf || 0);
    return {
      months: ms, monthsBuy: mb, factor: ks, total: total, totalYear: total * ks, groups: groups, cnpjSales: cnpjSales,
      buyers: Object.keys(buyers).map(function (c) { return { cnpj: c, value: buyers[c], regime: regimes[c] || "unknown" }; })
        .sort(function (a, b) { return b.value - a.value; }),
      shareCredit: total > 0 ? (groups.regular || 0) / total : 0, shareUnknown: total > 0 ? (groups.unknown || 0) / total : 0,
      purchasesRegularYear: buyReg * kb, purchasesOtherYear: buyOther * kb
    };
  }

  /** Buyers to look up, biggest first, until `cover` of the CNPJ sales is known (same rule as the server). */
  function lookupPlan(read, today, cover, maxCalls) {
    var s = summarize(read, {}, today), total = 0, done = 0, out = [];
    s.buyers.forEach(function (b) { if (b.value > 0) total += b.value; });
    for (var i = 0; i < s.buyers.length; i++) {
      if (done / (total || 1) >= (cover || 0.95) || out.length >= (maxCalls || 150)) break;
      out.push(s.buyers[i].cnpj);
      done += Math.max(s.buyers[i].value, 0);
    }
    return out;
  }

  // ---------- summary file (totals only): what the office may send instead of the XMLs ----------
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function clean(s, n) { return String(s || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n); }

  /** info: {empresa, anexo, escritorio, ipiMantido}. No buyer or supplier CNPJ, no CPF, no note key goes in. */
  function buildResumo(read, regimes, info, now) {
    info = info || {}; regimes = regimes || {};
    var lines = new Map(), cm = new Map(), months = {}, looked = 0;
    read.notes.forEach(function (n) {
      if (n.emit === read.client && n.tpnf !== "0" && n.emit_cmun) {
        var k = n.emit_cmun + "|" + n.emit_uf;
        cm.set(k, (cm.get(k) || 0) + 1);
      }
    });
    var place = Array.from(cm.entries()).sort(function (a, b) { return b[1] - a[1]; })[0];
    read.items.forEach(function (it) {
      var month = it.date.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      months[month] = 1;
      var group = it.kind === "sale" ? (it.b2b ? (regimes[it.customer] || "unknown") : "cpf") : (it.other_crt === "3" ? "3" : "0");
      var k = [it.kind, it.doc, month, it.ncm, it.nbs, it.cst, it.cclasstrib, group].join("|"), l = lines.get(k);
      if (!l) lines.set(k, l = { kind: it.kind, doc: it.doc, month: month, ncm: it.ncm, nbs: it.nbs, cst: it.cst,
        cclasstrib: it.cclasstrib, group: group, value: 0, embedded: 0, desc: it.desc });
      l.value += it.value; l.embedded += it.embedded;
    });
    Object.keys(regimes).forEach(function (c) { if (regimes[c] !== "unknown") looked++; });
    var ms = Object.keys(months).sort(), x = [];
    x.push('<?xml version="1.0" encoding="UTF-8"?>');
    x.push('<raioxResumo versao="1" origem="previa-local" geradoEm="' + esc((now || new Date().toISOString()).slice(0, 19)) + '">');
    x.push('  <empresa cnpj="' + esc(read.client) + '" nome="' + esc(clean(info.empresa, 80)) + '" anexo="' + esc(clean(info.anexo, 3)) +
      '" cmun="' + esc(place ? place[0].split("|")[0] : "") + '" uf="' + esc(place ? place[0].split("|")[1] : "") +
      '" ipiMantido="' + (info.ipiMantido ? "1" : "0") + '"/>');
    x.push('  <escritorio nome="' + esc(clean(info.escritorio, 80)) + '"/>');
    x.push('  <leitura notas="' + read.notes.length + '" inicio="' + esc(ms[0] || "") + '" fim="' + esc(ms[ms.length - 1] || "") +
      '" compradoresConsultados="' + looked + '"/>');
    Object.keys(read.skipped).sort().forEach(function (k) { x.push('  <ignorados motivo="' + esc(clean(k, 60)) + '" n="' + read.skipped[k] + '"/>'); });
    Array.from(lines.values()).forEach(function (l) {
      x.push('  <linha tipo="' + (l.kind === "sale" ? "venda" : "compra") + '" doc="' + l.doc + '" mes="' + l.month + '" ncm="' + esc(digits(l.ncm)) +
        '" nbs="' + esc(digits(l.nbs)) + '" cst="' + esc(digits(l.cst)) + '" cclasstrib="' + esc(digits(l.cclasstrib)) + '" grupo="' + l.group +
        '" valor="' + l.value.toFixed(2) + '" embutido="' + l.embedded.toFixed(2) + '" desc="' + esc(clean(l.desc, 60)) + '"/>');
    });
    x.push("</raioxResumo>");
    return x.join("\n") + "\n";
  }

  return { parseXml: parseXml, parseText: parseText, decode: decode, unzip: unzip, expand: expand, classify: classify,
    readAll: readAll, completeMonths: completeMonths, regimeOf: regimeOf, summarize: summarize, lookupPlan: lookupPlan,
    buildResumo: buildResumo, GROUPS: GROUPS, GROUP_NAMES: GROUP_NAMES };
});
