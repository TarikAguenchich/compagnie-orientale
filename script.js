/* =========================================================
   CONFIG
   ========================================================= */
// Supabase > Project Settings > API (ou Data API)
const SUPABASE_URL = "https://ipdenjiyngkwweklbdbf.supabase.co";
const SUPABASE_KEY = "sb_publishable_Lv560D7iNF9V_d35b-EEyA_FzbYF9od";

// Le webhook Discord et les rôles sont réglés dans Supabase (table « config »), jamais ici.
const MONNAIE       = "septims";

// Intendants, châtelleries et coffres : page « Réglages » du site (tables Supabase)
const INSTITUTIONS = ["Thalmor", "Empire", "Académie des Mages"];

/* =========================================================
   Données
   - catalogue + historique : Supabase (partagés, protégés par la connexion Discord)
   - intendant : Permanence + Historique ; administrateur : tout
   - permanence en cours (saisie) : ce navigateur, jusqu'à clôture ou « vider »
   ========================================================= */
// Adresse officielle du site : l'ancienne adresse .netlify.app y renvoie automatiquement
const SITE_URL = "https://intendant-keizaal.fr";
if (/\.netlify\.app$/i.test(location.hostname) || /^www\./i.test(location.hostname)) {
  location.replace(SITE_URL + location.pathname + location.search + location.hash);
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
const fmt = n => (Number(n) || 0).toLocaleString("fr-FR") + " " + MONNAIE;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dateFR = s => s ? s.split("-").reverse().join("/") : "";

// Article : { k (id Supabase), cat, nom, prix, fourni, note, id (ID item), variantes, varIds, ordre }
const versArticle = r => ({ k: String(r.id), cat: r.cat, nom: r.nom, prix: r.prix, fourni: r.fourni || "", note: r.note || "",
  id: r.item_id || "", variantes: r.variantes?.length ? r.variantes : null, varIds: r.var_ids || null, ordre: r.ordre });
const versLigne = a => ({ cat: a.cat, nom: a.nom, prix: a.prix, fourni: a.fourni || "", note: a.note || "", item_id: a.id || "",
  variantes: a.variantes?.length ? a.variantes : null, var_ids: a.varIds && Object.keys(a.varIds).length ? a.varIds : null, maj_le: new Date().toISOString() });

let CATALOGUE = [], ITEM = {}, catCharge = false;
try { const c = JSON.parse(localStorage.getItem("catalogue_cache")); if (Array.isArray(c)) CATALOGUE = c; } catch {}
const rebuildItems = () => { ITEM = Object.fromEntries(CATALOGUE.map(a => [a.k, a])); };
rebuildItems();
// Ligne de commande -> clé de l'article (anciennes lignes : retrouvées par le nom)
const cle = x => x.k && ITEM[x.k] ? x.k : (CATALOGUE.find(a => a.nom === x.nom)?.k || x.k || "");
// Infos figées à l'enregistrement de la commande, sinon celles du catalogue
const infos = x => { const a = ITEM[cle(x)]; return { prix: x.prix ?? a?.prix ?? 0, fourni: x.fourni ?? a?.fourni ?? "", cat: x.cat ?? a?.cat ?? "—" }; };
const lib = x => x.nom + (x.var ? " — " + x.var : "");
// ID pour le give : celui du catalogue actuel, sinon celui figé dans la commande
const idOf = x => { const a = ITEM[cle(x)]; const cur = a ? (x.var ? a.varIds?.[x.var] : a.id) : ""; return cur || x.id || ""; };

// Intendants / châtelleries / coffres (copie locale pour l'affichage immédiat)
let REG = { intendants: [], chatelleries: [], coffres: [] };
try { const r = JSON.parse(localStorage.getItem("reglages_cache")); if (r && Array.isArray(r.intendants)) REG = r; } catch {}

let state = { intendantId: "", lieu: "", coffre: "", date: today(), orders: [], draft: null };
let hist = [];
try { const s = JSON.parse(localStorage.getItem("perm_state")); if (s && Array.isArray(s.orders)) state = Object.assign(state, s); } catch {}
const save = () => { try { localStorage.setItem("perm_state", JSON.stringify(state)); } catch {} };
let editId = state.draft?.editId || null;
let restoring = false;

function statut(t) { $("dbStatus").textContent = t; }
let ROLE = null, PROFIL = null;
const estAdmin = () => ROLE === "admin";
const estSecretaire = () => ROLE === "secretaire";
const estZone = () => ROLE === "intendant" || ROLE === "secretaire";   // permanence partagée de la zone
let ZONE = null;

/* ---------- Chargement depuis Supabase ---------- */
async function chargerCatalogue() {
  const tout = [];
  for (let de = 0; ; de += 1000) {                       // Supabase renvoie 1000 lignes max par appel
    const { data, error } = await sb.from(estAdmin() ? "articles" : "vue_catalogue").select("*").order("ordre").order("id").range(de, de + 999);
    if (error) { statut("⚠ Catalogue non chargé : " + error.message + (CATALOGUE.length ? " (dernière copie affichée)" : "")); return; }
    tout.push(...data);
    if (data.length < 1000) break;
  }
  CATALOGUE = tout.map(versArticle); catCharge = true;
  try { localStorage.setItem("catalogue_cache", JSON.stringify(CATALOGUE)); } catch {}
  rebuildItems();
  rafraichirLignes();
  calcForm(); render();
  if (!$("viewCat").hidden) renderCat();
  if (!$("viewHist").hidden) renderHist();
  statut(`✔ Catalogue à jour (${CATALOGUE.length} articles)`);
}

async function chargerHist() {
  const { data, error } = await sb.from("permanences").select("*").order("cloture_le", { ascending: false }).limit(500);
  if (error) { $("hist").innerHTML = `<p class="empty">Historique indisponible : ${esc(error.message)}</p>`; return; }
  hist = data.map(r => ({ id: r.id, intendant: r.intendant, coffre: r.coffre, lieu: r.lieu, date: r.date, orders: r.orders || [],
    clotureLe: r.cloture_le, cloturePar: r.cloture_par, discord: r.discord, envoyeLe: r.envoye_le }));
  majFiltres();
  renderHist(); renderStock();
}

async function chargerReglages() {
  const [i, c, k] = await Promise.all(["intendants", "chatelleries", "coffres"].map(t => sb.from(t).select("*").order("nom")));
  const err = [i, c, k].find(r => r.error);
  if (err) { statut("⚠ Intendants / châtelleries non chargés : " + err.error.message + " (as-tu lancé 3_intendants.sql ?)"); return; }
  REG = { intendants: i.data, chatelleries: c.data, coffres: k.data };
  try { localStorage.setItem("reglages_cache", JSON.stringify(REG)); } catch {}
  majPermanence(); majFiltres();
  if (!$("viewReg").hidden) renderReg();
}

// Les autres pages ouvertes se mettent à jour toutes seules
let tCat = null, tHist = null, tReg = null;
const majReg = () => { clearTimeout(tReg); tReg = setTimeout(chargerReglages, 400); };
function ecouter() { sb.channel("maj")
  .on("postgres_changes", { event: "*", schema: "public", table: "intendants" }, majReg)
  .on("postgres_changes", { event: "*", schema: "public", table: "chatelleries" }, majReg)
  .on("postgres_changes", { event: "*", schema: "public", table: "coffres" }, majReg)
  .on("postgres_changes", { event: "*", schema: "public", table: "articles" }, () => { clearTimeout(tCat); tCat = setTimeout(chargerCatalogue, 400); })
  .on("postgres_changes", { event: "*", schema: "public", table: "permanences" }, () => { clearTimeout(tHist); tHist = setTimeout(chargerHist, 400); })
  .on("postgres_changes", { event: "*", schema: "public", table: "profils" }, () => { if (estAdmin()) chargerComptes(); })
  .on("postgres_changes", { event: "*", schema: "public", table: "brouillon_commandes" }, majZone)
  .on("postgres_changes", { event: "*", schema: "public", table: "brouillons" }, majZone)
  .subscribe(); }
// Filet de sécurité : rechargement quand on revient sur l'onglet
document.addEventListener("visibilitychange", () => { if (!document.hidden && ROLE) { chargerZone(); if (!$("viewCtr").hidden) chargerSuivi(); chargerCatalogue(); chargerHist(); chargerReglages(); if (estAdmin()) chargerComptes(); } });

/* ---------- Confirmation dans la page ---------- */
function confirmer(txt) {
  return new Promise(res => {
    $("modalTxt").textContent = txt; $("modal").hidden = false; $("modalYes").focus();
    const fin = v => { $("modal").hidden = true; $("modalYes").onclick = $("modalNo").onclick = null; res(v); };
    $("modalYes").onclick = () => fin(true);
    $("modalNo").onclick = () => fin(false);
  });
}

/* ---------- Onglets ---------- */
let MODE = "enc";   // vue des permanences : "enc" = commandes en cours, "hist" = historique (tout livré)
function showTab(t) {
  if (!estAdmin() && (t === "cat" || t === "reg" || t === "ctr")) t = "perm";
  const vues = { perm: "viewPerm", enc: "viewHist", hist: "viewHist", stock: "viewStock", ctr: "viewCtr", cat: "viewCat", reg: "viewReg" };
  ["viewPerm", "viewHist", "viewStock", "viewCtr", "viewCat", "viewReg"].forEach(v => $(v).hidden = v !== vues[t]);
  if (t === "ctr") { majLieuxContrats(); chargerCompagnies(); chargerSuivi(); }
  if (t === "stock") renderStock();
  [["perm", "tabPerm"], ["enc", "tabEnc"], ["hist", "tabHist"], ["stock", "tabStock"], ["ctr", "tabCtr"], ["cat", "tabCat"], ["reg", "tabReg"]].forEach(([k, b]) => $(b).classList.toggle("on", t === k));
  if (t === "enc" || t === "hist") { if (MODE !== t) $("hist").innerHTML = ""; MODE = t; $("histMsg").className = "msg"; renderHist(); }
  if (t === "cat") renderCat();
  if (t === "reg") renderReg();
  try { sessionStorage.setItem("tab", t); } catch {}
}
$("tabPerm").onclick = () => showTab("perm");
$("tabHist").onclick = () => showTab("hist");
$("tabEnc").onclick = () => showTab("enc");
$("tabStock").onclick = () => showTab("stock");
$("tabCtr").onclick = () => showTab("ctr");
$("tabCat").onclick = () => showTab("cat");
$("tabReg").onclick = () => showTab("reg");

/* ---------- Permanence ---------- */
INSTITUTIONS.forEach(n => $("institutions").append(new Option(n)));

const remplir = (sel, noms, vide) => { sel.innerHTML = ""; if (!noms.length) sel.add(new Option(vide, "")); noms.forEach(n => sel.add(new Option(n, n))); };
const intendantCourant = () => REG.intendants.find(i => String(i.id) === String(state.intendantId));

const parNom = (a, b) => a.localeCompare(b, "fr");
const lieuxDe = () => REG.chatelleries.map(c => c.nom).sort(parNom);      // admin : toutes
const coffresDe = () => REG.coffres.map(c => c.nom).sort(parNom);
const lieuZone = z => REG.chatelleries.filter(c => c.zone_id === z).map(c => c.nom).sort(parNom)[0] || "";
const coffreZone = z => REG.coffres.filter(c => c.zone_id === z).map(c => c.nom).sort(parNom)[0] || "";
// Listes de la permanence : châtelleries et coffres de l'intendant choisi
function majPermanence() {
  const selI = $("intendant");
  if (estZone()) {
    // Intendant / secrétaire : la permanence de SA zone, rien à choisir
    const zs = (PROFIL?.zones || []).map(Number);
    if (!zs.includes(ZONE)) { let z = null; try { z = Number(localStorage.getItem("zone")); } catch {} ZONE = zs.includes(z) ? z : (zs[0] ?? null); }
    $("zoneWrap").hidden = zs.length < 2;
    $("zone").innerHTML = zs.map(z => `<option value="${z}">Zone ${z}</option>`).join("");
    if (ZONE != null) $("zone").value = ZONE;
    const lieu = lieuZone(ZONE), cof = coffreZone(ZONE);
    const nomI = estSecretaire() ? "L'intendant de la zone" : (REG.intendants.find(i => String(i.id) === String(PROFIL?.intendant_id))?.nom || "");
    state.intendantId = estSecretaire() ? "" : String(PROFIL?.intendant_id ?? "");
    remplir(selI, nomI ? [nomI] : [], "— intendant pas encore créé —");
    remplir($("lieu"), lieu ? [lieu] : [], "— aucune châtellerie —");
    remplir($("coffre"), cof ? [cof] : [], "— aucun coffre —");
    selI.disabled = $("lieu").disabled = $("coffre").disabled = true;
    state.lieu = lieu; state.coffre = cof;
    const bandeau = ZONE == null ? "Aucune zone sur ton compte Discord : reconnecte-toi."
      : !estSecretaire() && !nomI ? "Ton intendant n'a pas encore été créé : déconnecte-toi puis reconnecte-toi avec Discord."
      : !lieu || !cof ? `Aucune ${!lieu ? "châtellerie" : ""}${!lieu && !cof ? " ni aucun " : ""}${!cof ? "coffre" : ""} n'est réglé pour la zone ${ZONE} : un administrateur doit le faire dans Réglages. En attendant, vous pouvez préparer les commandes mais pas les transmettre.`
      : "";
    $("nonLie").textContent = bandeau;
    $("nonLie").style.display = bandeau ? "block" : "none";
    render();
    return;
  }
  // Administrateur : choix libre
  selI.innerHTML = "";
  if (!REG.intendants.length) selI.add(new Option("— aucun intendant (voir Réglages) —", ""));
  REG.intendants.forEach(i => selI.add(new Option(i.nom, i.id)));
  if (!intendantCourant() && REG.intendants.length) state.intendantId = String(REG.intendants[0].id);
  selI.value = state.intendantId;
  selI.disabled = $("lieu").disabled = $("coffre").disabled = false;
  $("zoneWrap").hidden = true;
  $("nonLie").style.display = "none";
  const lieux = lieuxDe(), coffres = coffresDe();
  remplir($("lieu"), lieux, "— aucune châtellerie —");
  remplir($("coffre"), coffres, "— aucun coffre —");
  if (lieux.includes(state.lieu)) $("lieu").value = state.lieu;
  if (coffres.includes(state.coffre)) $("coffre").value = state.coffre;
  state.lieu = $("lieu").value; state.coffre = $("coffre").value; save();
  render();
}

/* ---------- Permanence partagée de la zone (intendant + secrétaire, en temps réel) ---------- */
let tZone = null;
const majZone = () => { clearTimeout(tZone); tZone = setTimeout(chargerZone, 250); };
async function chargerZone() {
  if (!estZone() || ZONE == null) return;
  const z = ZONE;
  const [c, b] = await Promise.all([
    sb.from("brouillon_commandes").select("id, commande, cree_le").eq("zone_id", z).order("cree_le"),
    sb.from("brouillons").select("date").eq("zone_id", z).maybeSingle(),
  ]);
  if (z !== ZONE) return;
  if (c.error) return flash($("sendMsg"), "Permanence partagée indisponible : " + c.error.message + " (as-tu lancé 19_secretaires.sql ?)", false);
  state.orders = c.data.map(r => r.commande);
  if (b.data?.date) { state.date = b.data.date; $("date").value = state.date; }
  if (editId && !state.orders.some(o => o.id === editId)) resetForm();     // supprimée par l'autre personne
  save(); render();
}
$("zone").onchange = () => {
  ZONE = Number($("zone").value); try { localStorage.setItem("zone", ZONE); } catch {}
  state.orders = []; resetForm(); majPermanence(); chargerZone();
};
$("date").value = state.date || today();
$("intendant").onchange = () => { state.intendantId = $("intendant").value; majPermanence(); };
$("lieu").onchange = () => { state.lieu = $("lieu").value; save(); };
$("coffre").onchange = () => { state.coffre = $("coffre").value; save(); render(); };
$("date").onchange = async () => {
  state.date = $("date").value; save();
  if (estZone() && ZONE != null) {
    const { error } = await sb.from("brouillons").upsert({ zone_id: ZONE, date: state.date || null, maj_le: new Date().toISOString() });
    if (error) flash($("sendMsg"), "Date non partagée : " + error.message, false);
  }
};

/* ---------- Saisie d'une commande ---------- */
function remplirSelect(sel, garder, nomGarde) {
  sel.innerHTML = "";
  sel.add(new Option(CATALOGUE.length ? "— choisir un article —" : "Chargement du catalogue…", ""));
  let cur = null, g = null;
  CATALOGUE.forEach(a => {
    if (a.cat !== cur) { g = document.createElement("optgroup"); g.label = a.cat; sel.append(g); cur = a.cat; }
    g.append(new Option(a.nom, a.k));
  });
  if (garder && ITEM[garder]) sel.value = garder;
  else if (garder) { sel.add(new Option((catCharge ? "⚠ retiré du catalogue : " : "… ") + (nomGarde || garder), garder)); sel.value = garder; }
  sel.dataset.nom = ITEM[sel.value]?.nom || nomGarde || "";
}

function majVariante(tr, garder) {
  const a = ITEM[tr.querySelector(".item").value], v = tr.querySelector(".var");
  v.innerHTML = "";
  if (!a || !a.variantes) { v.hidden = true; return; }
  v.hidden = false;
  v.add(new Option("— variante —", ""));
  a.variantes.forEach(x => v.add(new Option(x, x)));
  if (garder && a.variantes.includes(garder)) v.value = garder;
}

// Catalogue rechargé : on garde ce qui est choisi dans la saisie en cours
function rafraichirLignes() {
  restoring = true;
  document.querySelectorAll("#lines tbody tr").forEach(tr => {
    const sel = tr.querySelector(".item"), v = tr.querySelector(".var").value;
    remplirSelect(sel, cle({ k: sel.value, nom: sel.dataset.nom }), sel.dataset.nom); majVariante(tr, v);
    tr._majTexte?.();
  });
  restoring = false;
}

function ajouterLigne(x) {
  x = x || {};
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><div class="combo"><input class="search" placeholder="Rechercher un article…" autocomplete="off" spellcheck="false"><div class="combo-list" hidden></div></div>
    <select class="item" hidden></select><select class="var" hidden style="margin-top:6px"></select></td>
    <td class="qty"><input type="number" class="q" min="1" value="${x.qte || 1}"></td>
    <td class="cost"></td>
    <td class="del"><button type="button" class="x" title="Retirer">×</button></td>`;
  remplirSelect(tr.querySelector(".item"), cle(x), x.nom);
  majVariante(tr, x.var);
  tr.querySelector(".var").onchange = calcForm;
  tr.querySelector(".x").onclick = () => { tr.remove(); if (!$("lines").tBodies[0].children.length) ajouterLigne(); calcForm(); };
  tr.querySelector(".item").onchange = e => { e.target.dataset.nom = ITEM[e.target.value]?.nom || ""; majVariante(tr); calcForm(); };
  tr.querySelector(".q").oninput = calcForm;
  comboArticle(tr);
  $("lines").tBodies[0].append(tr);
  calcForm();
}

/* ---------- Recherche d'article (remplace la longue liste déroulante) ---------- */
const sansAccent = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function comboArticle(tr) {
  const sel = tr.querySelector(".item"), inp = tr.querySelector(".search"), list = tr.querySelector(".combo-list");
  let res = [], idx = -1;
  const majTexte = () => { inp.value = ITEM[sel.value]?.nom || (sel.value ? sel.dataset.nom || "" : ""); inp.classList.toggle("absent", !!sel.value && !ITEM[sel.value]); };
  tr._majTexte = majTexte;
  majTexte();

  function afficher(q) {
    const mots = sansAccent(q.trim()).split(/\s+/).filter(Boolean);
    res = CATALOGUE.filter(a => { const t = sansAccent(a.nom + " " + a.cat); return mots.every(m => t.includes(m)); });
    idx = res.length ? 0 : -1;
    let cur = null, html = "";
    res.forEach((a, i) => {
      if (a.cat !== cur) { html += `<div class="combo-cat">${esc(a.cat)}</div>`; cur = a.cat; }
      html += `<div class="combo-opt${i === idx ? " on" : ""}" data-i="${i}"><span>${esc(a.nom)}</span><span class="hint">${fmt(a.prix)}${a.variantes ? " · " + a.variantes.length + " variantes" : ""}</span></div>`;
    });
    list.innerHTML = html || `<div class="combo-vide">${CATALOGUE.length ? "Aucun article ne correspond." : "Chargement du catalogue…"}</div>`;
    list.hidden = false;
  }
  function surligner(n) {
    if (!res.length) return;
    idx = (n + res.length) % res.length;
    list.querySelectorAll(".combo-opt").forEach(o => o.classList.toggle("on", +o.dataset.i === idx));
    list.querySelector(".combo-opt.on")?.scrollIntoView({ block: "nearest" });
  }
  function choisir(a) {
    sel.value = a.k; sel.dataset.nom = a.nom;
    list.hidden = true; majTexte();
    sel.dispatchEvent(new Event("change"));
    const v = tr.querySelector(".var");
    (v.hidden ? tr.querySelector(".q") : v).focus();
  }
  inp.onfocus = () => { inp.select(); afficher(""); };
  inp.oninput = () => afficher(inp.value);
  inp.onkeydown = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) afficher(inp.value); else surligner(idx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); surligner(idx - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (!list.hidden && res[idx]) choisir(res[idx]); }
    else if (e.key === "Escape") { list.hidden = true; majTexte(); }
  };
  inp.onblur = () => setTimeout(() => { list.hidden = true; majTexte(); }, 150);
  list.onmousedown = e => e.preventDefault();          // garde le focus dans le champ
  list.onclick = e => { const o = e.target.closest(".combo-opt"); if (o) choisir(res[+o.dataset.i]); };
}
$("addLine").onclick = () => ajouterLigne();

function lignesBrutes() {
  return [...document.querySelectorAll("#lines tbody tr")].map(tr => {
    const sel = tr.querySelector(".item"), k = sel.value;
    return { k, nom: ITEM[k]?.nom || sel.dataset.nom || "", var: tr.querySelector(".var").value, qte: parseInt(tr.querySelector(".q").value, 10) || 1 };
  });
}
function lignesForm() {
  const m = new Map();
  lignesBrutes().forEach(x => {
    if (!x.k || !(x.qte > 0)) return;
    const k = x.k + "|" + (x.var || "");
    if (m.has(k)) m.get(k).qte += x.qte; else m.set(k, Object.assign({}, x));
  });
  return [...m.values()].map(x => { if (!x.var) delete x.var; return x; });
}

function coutTexte(a, q) {
  const parts = [];
  if (a.fourni) parts.push(q > 1 ? `${q}× (${a.fourni})` : a.fourni);
  parts.push(fmt(a.prix * q));
  return parts.join(" + ") + (a.note ? " — ⚠ " + a.note : "");
}

function saveDraft() {
  if (restoring) return;
  state.draft = { editId, client: $("client").value, type: $("clientType").value, notes: $("notes").value, lines: lignesBrutes() };
  save();
}

function calcForm() {
  let tot = 0;
  document.querySelectorAll("#lines tbody tr").forEach(tr => {
    const a = ITEM[tr.querySelector(".item").value], q = parseInt(tr.querySelector(".q").value, 10) || 0;
    tr.querySelector(".cost").textContent = a ? coutTexte(a, q) : "";
    if (a) tot += a.prix * q;
  });
  $("orderTotal").textContent = tot ? "Total : " + fmt(tot) : "";
  saveDraft();
}
$("client").oninput = saveDraft;
$("clientType").onchange = saveDraft;
$("notes").oninput = saveDraft;

function modeEdition(o) {
  $("formTitle").textContent = o ? "Modifier la commande de " + o.client : "Nouvelle commande";
  $("saveOrder").textContent = o ? "Enregistrer la modification" : "Ajouter à la permanence";
  $("cancelEdit").style.display = o ? "" : "none";
  $("formCard").classList.toggle("editing", !!o);
}

function chargerForm(d) {
  restoring = true;
  $("client").value = d?.client || ""; $("clientType").value = d?.type || "Particulier"; $("notes").value = d?.notes || "";
  $("lines").tBodies[0].innerHTML = "";
  const ls = d?.lines?.length ? d.lines : [{ qte: 1 }];
  ls.forEach(x => ajouterLigne(x));
  restoring = false;
  modeEdition(editId ? state.orders.find(o => o.id === editId) : null);
  saveDraft();
}

function resetForm() { editId = null; chargerForm(null); }
$("cancelEdit").onclick = resetForm;

function flash(el, t, ok) { el.className = "msg " + (ok ? "ok" : "err"); el.textContent = t; if (ok) setTimeout(() => { el.className = "msg"; }, 3000); }

$("saveOrder").onclick = async () => {
  const client = $("client").value.trim(), items = lignesForm();
  if (!client) return flash($("formMsg"), "Renseigne le nom du client.", false);
  if (!items.length) return flash($("formMsg"), "Ajoute au moins un article.", false);
  const absent = items.find(x => !ITEM[x.k]);
  if (absent) return flash($("formMsg"), `« ${absent.nom || "article"} » n'est pas (ou plus) dans le catalogue : retire la ligne.`, false);
  const sansVar = items.find(x => ITEM[x.k].variantes && !x.var);
  if (sansVar) return flash($("formMsg"), `Choisis la variante pour « ${sansVar.nom} ».`, false);
  const fig = items.map(x => { const a = ITEM[x.k]; return Object.assign(x, { nom: a.nom, prix: a.prix, fourni: a.fourni || "", cat: a.cat }); });
  const o = { id: editId || Date.now().toString(36) + Math.random().toString(36).slice(2, 5), client, type: $("clientType").value, notes: $("notes").value.trim(), items: fig };
  const edit = !!editId;
  if (estZone()) {
    if (ZONE == null) return flash($("formMsg"), "Aucune zone sur ton compte.", false);
    const maj = { commande: o, maj_le: new Date().toISOString(), maj_par: PROFIL?.nom || null };
    const { error } = edit ? await sb.from("brouillon_commandes").update(maj).eq("id", o.id)
                           : await sb.from("brouillon_commandes").insert({ id: o.id, zone_id: ZONE, ...maj });
    if (error) return flash($("formMsg"), "Commande non enregistrée : " + error.message, false);
  }
  if (edit) state.orders = state.orders.map(x => x.id === editId ? o : x);
  else state.orders.push(o);
  save();
  flash($("formMsg"), `Commande de ${client} ${edit ? "modifiée" : "ajoutée"}.`, true);
  resetForm(); render();
  $("client").focus();
};

/* ---------- Calculs ---------- */
const totalOrder = o => o.items.reduce((s, x) => s + infos(x).prix * x.qte, 0);
const totalPerm = orders => orders.reduce((s, o) => s + totalOrder(o), 0);
function agreger(orders) {
  const m = new Map();
  orders.forEach(o => o.items.forEach(x => {
    const k = cle(x) + "|" + (x.var || "");
    if (!m.has(k)) m.set(k, { nom: lib(x), base: cle(x), var: x.var || "", qte: 0, cat: infos(x).cat, id: idOf(x) });
    m.get(k).qte += x.qte;
  }));
  const ordre = k => { const i = CATALOGUE.findIndex(a => a.k === k); return i < 0 ? 1e9 : i; };
  return [...m.values()].sort((a, b) => ordre(a.base) - ordre(b.base) || a.var.localeCompare(b.var, "fr", { numeric: true }));
}

/* ---------- Rendu (partagé avec l'historique) ---------- */
function htmlCommandes(orders, actions, permId) {
  return orders.map((o, i) => `<div class="order${permId ? (o.payeLe ? " payee" : o.livreLe ? " livree" : "") : ""}">
    <div class="order-head"><b>${i + 1}. ${esc(o.client)}</b><span class="hint">${esc(o.type)}</span>
      <span class="total" style="font-size:.9rem">${fmt(totalOrder(o))}</span></div>
    <ul>${o.items.map(x => { const a = infos(x); return `<li>${x.qte} × ${esc(lib(x))}${a.fourni ? ` <span class="hint">— fournit : ${esc(a.fourni)}${x.qte > 1 ? " (×" + x.qte + ")" : ""}</span>` : ""}</li>`; }).join("")}</ul>
    ${o.notes ? `<div class="meta">📝 ${esc(o.notes)}</div>` : ""}
    ${permId ? `<div class="row etats" style="margin-top:8px">
      <label class="liv" title="${!estAdmin() ? "Coché par un administrateur quand il te remet les items" : o.payeLe ? "Déjà payé : décoche d'abord « Payé »" : "Items remis à l'intendant (entrent dans son stock) : il sera pingé sur Discord"}"><input type="checkbox" data-etat="livre|${esc(permId)}|${esc(o.id)}" ${o.livreLe ? "checked" : ""} ${o.payeLe || !estAdmin() ? "disabled" : ""}> Livré</label>
      ${o.livreLe ? `<span class="hint">le ${new Date(o.livreLe).toLocaleString("fr-FR")}</span>` : ""}
      <label class="liv pay" title="${o.livreLe ? "Remis au client et encaissé (sort du stock)" : "Coche d'abord « Livré »"}"><input type="checkbox" data-etat="paye|${esc(permId)}|${esc(o.id)}" ${o.payeLe ? "checked" : ""} ${o.livreLe ? "" : "disabled"}> Payé</label>
      ${o.payeLe ? `<span class="hint">le ${new Date(o.payeLe).toLocaleString("fr-FR")}</span>` : ""}</div>` : ""}
    ${actions ? `<div class="row" style="margin-top:8px"><button class="btn small" data-e="${o.id}">Modifier</button><button class="btn small" data-d="${o.id}">Supprimer</button></div>` : ""}
  </div>`).join("");
}
function htmlRecap(orders, coffre) {
  const ag = agreger(orders), nb = ag.reduce((s, x) => s + x.qte, 0);
  return `<table><thead><tr><th style="text-align:right">Qté</th><th>Article</th><th>Catégorie</th></tr></thead><tbody>
    ${ag.map(x => `<tr><td class="n">${x.qte}</td><td>${esc(x.nom)}</td><td class="hint">${esc(x.cat)}</td></tr>`).join("")}
    </tbody></table>
    <div class="row" style="margin-top:10px"><span class="hint">${orders.length} client(s) — ${nb} article(s) — coffre : ${esc(coffre)}</span>
    <span class="total">Encaissé : ${fmt(totalPerm(orders))}</span></div>`;
}

function render() {
  $("nbOrders").textContent = state.orders.length;
  const box = $("orders");
  box.innerHTML = state.orders.length ? htmlCommandes(state.orders, true) : '<p class="empty">Aucune commande enregistrée pour l\'instant.</p>';
  box.querySelectorAll("[data-d]").forEach(b => b.onclick = async () => {
    const o = state.orders.find(x => x.id === b.dataset.d);
    if (!await confirmer(`Supprimer la commande de ${o.client} ?`)) return;
    if (estZone()) {
      const { error } = await sb.from("brouillon_commandes").delete().eq("id", o.id);
      if (error) return flash($("sendMsg"), "Suppression impossible : " + error.message, false);
    }
    state.orders = state.orders.filter(x => x.id !== b.dataset.d); save();
    if (editId === b.dataset.d) resetForm();
    render();
  });
  box.querySelectorAll("[data-e]").forEach(b => b.onclick = () => {
    const o = state.orders.find(x => x.id === b.dataset.e);
    editId = o.id;
    chargerForm({ client: o.client, type: o.type, notes: o.notes, lines: o.items });
    $("formCard").scrollIntoView({ behavior: "smooth" });
  });
  $("recap").innerHTML = state.orders.length ? htmlRecap(state.orders, state.coffre || "—") : '<p class="empty">Le récapitulatif apparaîtra ici.</p>';
}

/* ---------- Transmission (la base poste le message Discord) ---------- */
function recapTexte(p) {
  return `📦 **Commande à l'administration — Permanence ${p.lieu} — ${dateFR(p.date)}** (${p.intendant})
À déposer dans : **${p.coffre}**

${agreger(p.orders).map(x => `• ${x.qte} × ${x.nom}` + (estAdmin() ? ` — ID : ${x.id || "⚠ manquant"}` : "")).join("\n")}

Clients : ${p.orders.map(o => o.client).join(", ")}
Encaissé : ${fmt(totalPerm(p.orders))}`;
}

function snapshot() {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), intendant: estZone() ? $("intendant").selectedOptions[0]?.text || "" : intendantCourant()?.nom || "", coffre: state.coffre, lieu: state.lieu, date: state.date,
           orders: JSON.parse(JSON.stringify(state.orders)), clotureLe: new Date().toISOString(), discord: false };
}
// Les ID de give ne partent jamais du navigateur : la base les retrouve dans le catalogue
const sansIds = orders => orders.map(o => Object.assign({}, o, { items: o.items.map(({ id, ...x }) => x) }));

$("send").onclick = async () => {
  if (!state.orders.length) return flash($("sendMsg"), "Aucune commande dans cette permanence.", false);
  if (!state.date) return flash($("sendMsg"), "Renseigne la date.", false);
  if (estSecretaire()) return;
  if (estZone()) {
    if (!state.lieu || !state.coffre) return flash($("sendMsg"), `La châtellerie ou le coffre de la zone ${ZONE} n'est pas réglé : demande à un administrateur (Réglages).`, false);
    if (!await confirmer(`Clôturer la permanence de la zone ${ZONE} (${state.orders.length} client(s)) et commander aux administrateurs impériaux ?`)) return;
    $("send").disabled = true;
    const { data, error } = await sb.rpc("cloturer_zone", { zone: ZONE, date_: state.date });
    $("send").disabled = false;
    if (error) return flash($("sendMsg"), "Impossible de clôturer (" + error.message + "). Rien n'a été envoyé ni effacé, réessaie.", false);
    editId = null; state.draft = null; resetForm(); await chargerZone(); chargerHist();
    if (data.discord) flash($("sendMsg"), "Commande transmise aux administrateurs impériaux ✔ Elle est maintenant dans « Commandes en cours ».", true);
    else flash($("sendMsg"), `Permanence clôturée et archivée, mais pas transmise sur Discord (${data.erreur}). Tu pourras la renvoyer depuis l'onglet Commandes en cours.`, false);
    return;
  }
  if (!intendantCourant()) return flash($("sendMsg"), "Choisis l'intendant (à créer dans Réglages s'il n'existe pas).", false);
  if (!state.lieu) return flash($("sendMsg"), "Choisis la châtellerie (à créer dans Réglages).", false);
  if (!state.coffre) return flash($("sendMsg"), "Choisis le coffre (à créer dans Réglages).", false);
  if (!await confirmer(`Clôturer la permanence (${state.orders.length} client(s)) et commander aux administrateurs impériaux ?`)) return;

  const p = snapshot();
  $("send").disabled = true;
  const { data, error } = await sb.rpc("cloturer_permanence", { p: { id: p.id, intendant: p.intendant, coffre: p.coffre, lieu: p.lieu, date: p.date, orders: sansIds(p.orders) } });
  $("send").disabled = false;
  if (error) return flash($("sendMsg"), "Impossible de clôturer (" + error.message + "). Rien n'a été envoyé ni effacé, réessaie.", false);
  // archivée : on vide la permanence
  state.orders = []; editId = null; state.draft = null; save();
  resetForm(); render(); chargerHist();
  if (data.discord) flash($("sendMsg"), "Commande transmise aux administrateurs impériaux ✔ Elle est maintenant dans « Commandes en cours ».", true);
  else flash($("sendMsg"), `Permanence clôturée et archivée, mais pas transmise sur Discord (${data.erreur}). Tu pourras la renvoyer depuis l'onglet Commandes en cours.`, false);
};

async function copier(txt, el) {
  try { await navigator.clipboard.writeText(txt); flash(el, "Récap copié.", true); }
  catch { flash(el, "Copie impossible sur ce navigateur.", false); }
}
$("copy").onclick = () => {
  if (!state.orders.length) return flash($("sendMsg"), "Aucune commande dans cette permanence.", false);
  copier(recapTexte(snapshot()), $("sendMsg"));
};

$("reset").onclick = async () => {
  if (!state.orders.length && !$("client").value && !lignesForm().length) return;
  if (!await confirmer(estZone() ? `Effacer toutes les commandes de la permanence de la zone ${ZONE} (pour toi et ta zone) sans rien envoyer ?` : "Effacer toutes les commandes de cette permanence sans rien envoyer ?")) return;
  if (estZone() && state.orders.length) {
    const { error } = await sb.from("brouillon_commandes").delete().eq("zone_id", ZONE);
    if (error) return flash($("sendMsg"), "Impossible de vider : " + error.message, false);
  }
  state.orders = []; state.draft = null; editId = null; save(); resetForm(); render();
};

/* ---------- Historique (Supabase) ---------- */
// Filtres : intendants / châtelleries actuels + ceux présents dans l'historique
function majFiltres() {
  [["fInt", REG.intendants.map(i => i.nom), hist.map(p => p.intendant), "Tous"],
   ["fLieu", REG.chatelleries.map(c => c.nom), hist.map(p => p.lieu), "Toutes"],
   ["sInt", REG.intendants.map(i => i.nom), hist.map(p => p.intendant), "Tous"],
   ["sLieu", estAdmin() ? REG.chatelleries.map(c => c.nom) : [], hist.map(p => p.lieu), "Toutes"]].forEach(([id, a, b, tous]) => {
    const sel = $(id), garde = sel.value;
    sel.innerHTML = `<option value="">${tous}</option>`;
    [...new Set([...a, ...b].filter(Boolean))].sort((x, y) => x.localeCompare(y, "fr")).forEach(n => sel.add(new Option(n, n)));
    sel.value = garde;
  });
}
$("fInt").onchange = $("fLieu").onchange = $("fClient").oninput = $("fItem").oninput = renderHist;

const toutPaye = p => p.orders.length > 0 && p.orders.every(o => o.payeLe);
function renderHist() {
  const enCours = hist.filter(p => !toutPaye(p));
  $("nbEnc").textContent = enCours.length; $("nbEnc").hidden = !enCours.length;
  if ($("viewHist").hidden) return;
  const base = MODE === "enc" ? enCours : hist.filter(toutPaye);
  $("histIntro").textContent = (MODE === "enc"
    ? (estAdmin()
      ? "Transmise → Livré (tu as remis les items à l'intendant : il est pingé sur Discord, ils entrent dans son stock) → Payé (remis au client par l'intendant). Quand tous les clients ont payé, la permanence passe dans l'historique."
      : "Transmise → Livré (coché par un administrateur quand il te remet les items, tu es pingé sur Discord) → Payé (à cocher quand tu as remis au client). Quand tous les clients ont payé, la permanence passe dans l'historique.")
    : "Permanences entièrement livrées et payées.") + (estAdmin() ? " Tu vois celles de tous les intendants." : " Tu vois celles de ta zone.");
  const fi = estAdmin() ? $("fInt").value : "", fl = estAdmin() ? $("fLieu").value : "";
  const fc = sansAccent($("fClient").value.trim()), fa = sansAccent($("fItem").value.trim());
  const list = base.filter(p => (!fi || p.intendant === fi) && (!fl || p.lieu === fl) &&
    (!fc || p.orders.some(o => sansAccent(o.client).includes(fc))) &&
    (!fa || p.orders.some(o => o.items.some(x => sansAccent(lib(x)).includes(fa)))));
  const box = $("hist");
  if (!base.length) { box.innerHTML = `<p class="empty">${MODE === "enc" ? "Aucune commande en cours : tout a été payé." : "Aucune permanence entièrement payée pour l'instant."}</p>`; return; }
  if (!list.length) { box.innerHTML = '<p class="empty">Aucune permanence ne correspond aux filtres.</p>'; return; }
  const ouverts = new Set([...box.querySelectorAll("details[open]")].map(d => d.dataset.id));
  box.innerHTML = list.map(p => {
    const nb = p.orders.reduce((s, o) => s + o.items.reduce((t, x) => t + x.qte, 0), 0);
    const liv = p.orders.filter(o => o.livreLe).length, pay = p.orders.filter(o => o.payeLe).length, n = p.orders.length;
    const fini = pay === n, etat = fini ? "done" : liv ? "partiel" : "pending";
    return `<details class="perm ${etat}" data-id="${esc(p.id)}" ${ouverts.has(p.id) ? "open" : ""}>
      <summary><b>${esc(p.lieu)} — ${dateFR(p.date)}</b><span class="hint">${esc(p.intendant)} · ${p.orders.length} client(s) · ${nb} article(s)</span>
        ${p.discord ? '<span class="tag ok">Transmise</span>' : '<span class="tag err">Non transmise</span>'}
        ${fini ? '<span class="tag ok">✔ Tout payé</span>' : `<span class="tag ${liv ? "orange" : ""}">Livré ${liv}/${n}</span><span class="tag ${pay ? "ok" : ""}">Payé ${pay}/${n}</span>`}
        <span class="total" style="font-size:.9rem">${fmt(totalPerm(p.orders))}</span></summary>
      <div class="body">
        <div class="hint">Clôturée le ${new Date(p.clotureLe).toLocaleString("fr-FR")}${p.cloturePar ? " par " + esc(p.cloturePar) : ""}${p.discord && p.envoyeLe ? " — transmise le " + new Date(p.envoyeLe).toLocaleString("fr-FR") : ""}</div>
        <h3>Commandé à l'administration</h3>${htmlRecap(p.orders, p.coffre)}
        <h3>Commandes détaillées</h3>${htmlCommandes(p.orders, false, p.id)}
        <div class="row" style="margin-top:8px">${p.discord || estSecretaire() ? "" : `<button class="btn small primary" data-hs="${esc(p.id)}">Transmettre aux administrateurs</button>`}<button class="btn small" data-hc="${esc(p.id)}">Copier le récap</button>${estAdmin() ? `<button class="btn small" data-hd="${esc(p.id)}">Supprimer</button>` : ""}</div>
        <div class="msg" id="hm-${esc(p.id)}"></div>
      </div></details>`;
  }).join("");
  box.querySelectorAll("[data-etat]").forEach(c => c.onchange = () => changerEtat(c));
  box.querySelectorAll("[data-hc]").forEach(b => b.onclick = () => copier(recapTexte(hist.find(p => p.id === b.dataset.hc)), $("hm-" + b.dataset.hc)));
  box.querySelectorAll("[data-hs]").forEach(b => b.onclick = async () => {
    const p = hist.find(x => x.id === b.dataset.hs);
    b.disabled = true;
    const { error } = await sb.rpc("renvoyer_permanence", { pid: p.id });
    if (error) { b.disabled = false; return flash($("hm-" + p.id), "Échec de l'envoi (" + error.message + ").", false); }
    p.discord = true; p.envoyeLe = new Date().toISOString(); renderHist();
  });
  box.querySelectorAll("[data-hd]").forEach(b => b.onclick = async () => {
    if (!await confirmer("Supprimer définitivement cette permanence (pour tout le monde) ?")) return;
    const { error } = await sb.rpc("supprimer_permanence", { pid: b.dataset.hd });
    if (error) return flash($("histMsg"), "Suppression impossible : " + error.message, false);
    hist = hist.filter(p => p.id !== b.dataset.hd); renderHist(); renderStock();
    flash($("histMsg"), "Permanence supprimée.", true);
  });
}

/* ---------- Gestion du catalogue (Supabase) ---------- */
let catEdit = null;   // clé de l'article en cours de modification

function resetCatForm() {
  catEdit = null;
  ["cCat", "cNom", "cPrix", "cId", "cFourni", "cNote"].forEach(id => $(id).value = "");
  $("cVars").innerHTML = ""; majChampId();
  $("catFormTitle").textContent = "Ajouter un article";
  $("cSave").textContent = "Ajouter au catalogue";
  $("cCancel").style.display = "none";
  $("catFormCard").classList.remove("editing");
}
$("cCancel").onclick = resetCatForm;

// Éditeur de variantes du formulaire catalogue
function ajouterVariante(nom, id) {
  const d = document.createElement("div");
  d.className = "var-ligne";
  d.innerHTML = `<input class="v-nom" placeholder="Nom (ex. Blanc)" autocomplete="off"><input class="v-id mono" placeholder="ID (facultatif)" autocomplete="off">
    <button type="button" class="x" title="Retirer cette variante">×</button>`;
  d.querySelector(".v-nom").value = nom || ""; d.querySelector(".v-id").value = id || "";
  d.querySelector(".x").onclick = () => { d.remove(); majChampId(); };
  d.querySelector(".v-nom").oninput = majChampId;
  $("cVars").append(d);
  majChampId();
  return d;
}
const lignesVariantes = () => [...document.querySelectorAll("#cVars .var-ligne")].map(d => ({ nom: d.querySelector(".v-nom").value.trim(), id: d.querySelector(".v-id").value.trim() }));
// Avec des variantes, l'ID se met sur chaque variante : le champ ID général est désactivé
function majChampId() {
  const avec = lignesVariantes().some(l => l.nom);
  $("cId").disabled = avec;
  $("cId").placeholder = avec ? "ID par variante, ci-dessous" : "ex. 0001396B";
}
$("cVarAdd").onclick = () => ajouterVariante().querySelector(".v-nom").focus();

// Ordre d'un nouvel article : juste après le dernier de sa catégorie (ou à la fin)
function ordreApres(cat, sauf) {
  const liste = CATALOGUE.filter(x => x.k !== sauf);
  let i = -1;
  liste.forEach((x, n) => { if (x.cat === cat) i = n; });
  if (i < 0) return (liste.length ? liste[liste.length - 1].ordre : 0) + 10;
  const suivant = liste[i + 1];
  return suivant ? (liste[i].ordre + suivant.ordre) / 2 : liste[i].ordre + 10;
}

$("cSave").onclick = async () => {
  const cat = $("cCat").value.trim(), nom = $("cNom").value.trim(), prixTxt = $("cPrix").value.trim();
  const prix = Number(prixTxt);
  if (!catCharge) return flash($("cMsg"), "Le catalogue n'est pas encore chargé.", false);
  if (!cat) return flash($("cMsg"), "Renseigne la catégorie.", false);
  if (!nom) return flash($("cMsg"), "Renseigne le nom de l'article.", false);
  if (prixTxt === "" || !Number.isFinite(prix) || prix < 0) return flash($("cMsg"), "Renseigne un prix valide.", false);
  if (CATALOGUE.some(x => x.cat === cat && x.nom === nom && x.k !== catEdit)) return flash($("cMsg"), `« ${nom} » existe déjà dans cette catégorie.`, false);
  const a = { cat, nom, fourni: $("cFourni").value.trim(), prix: Math.round(prix), note: $("cNote").value.trim(), id: $("cId").value.trim() };
  // Variantes : une ligne = un nom + son ID (facultatif)
  const ancien = catEdit ? ITEM[catEdit] : null;
  const vars = [], varIds = {};
  for (const l of lignesVariantes()) {
    if (!l.nom) { if (l.id) return flash($("cMsg"), `Donne un nom à la variante qui a l'ID ${l.id}.`, false); continue; }
    if (vars.includes(l.nom)) return flash($("cMsg"), `La variante « ${l.nom} » est en double.`, false);
    vars.push(l.nom);
    if (l.id) varIds[l.nom] = l.id;
  }
  if (vars.length) { a.variantes = vars; a.varIds = varIds; }

  const ligne = versLigne(a);
  $("cSave").disabled = true;
  let res;
  if (ancien) {
    if (ancien.cat !== cat) ligne.ordre = ordreApres(cat, ancien.k);
    res = await sb.from("articles").update(ligne).eq("id", ancien.k);
  } else {
    ligne.ordre = ordreApres(cat);
    res = await sb.from("articles").insert(ligne);
  }
  $("cSave").disabled = false;
  if (res.error) return flash($("cMsg"), "Non enregistré : " + res.error.message, false);
  resetCatForm();
  flash($("cMsg"), ancien ? `« ${nom} » modifié.` : `« ${nom} » ajouté au catalogue.`, true);
  await chargerCatalogue();
};

function renderCat() {
  $("nbArticles").textContent = CATALOGUE.length;
  const cats = [...new Set(CATALOGUE.map(a => a.cat))];
  $("catList").innerHTML = ""; cats.forEach(c => $("catList").append(new Option(c)));
  const q = $("cSearch").value.trim().toLowerCase(), seulSansId = $("cMissing").checked;
  majCompteurId();
  const list = CATALOGUE.filter(a => (!q || (a.nom + " " + a.cat + " " + (a.fourni || "") + " " + (a.id || "") + " " + Object.values(a.varIds || {}).join(" ")).toLowerCase().includes(q))
    && (!seulSansId || manqueId(a)));
  if (!list.length) { $("catTable").innerHTML = `<p class="empty">${CATALOGUE.length ? "Aucun article." : "Chargement du catalogue…"}</p>`; return; }
  let cur = null, rows = "";
  list.forEach(a => {
    if (a.cat !== cur) { rows += `<tr class="cat-head"><td colspan="5">${esc(a.cat)}</td></tr>`; cur = a.cat; }
    const idCell = a.variantes
      ? a.variantes.map(v => `<div class="id-var">${esc(v)} <input class="id-input${a.varIds?.[v] ? "" : " missing"}" data-idk="${a.k}" data-idvar="${esc(v)}" value="${esc(a.varIds?.[v] || "")}" placeholder="ID"></div>`).join("")
      : `<input class="id-input${a.id ? "" : " missing"}" data-idk="${a.k}" value="${esc(a.id || "")}" placeholder="ID">`;
    rows += `<tr class="cat-row"><td><b>${esc(a.nom)}</b>${a.variantes ? `<br><span class="hint">${a.variantes.length} variantes</span>` : ""}${a.note ? `<br><span class="hint">⚠ ${esc(a.note)}</span>` : ""}</td>
      <td class="f hint">${a.fourni ? "Fournit : " + esc(a.fourni) : ""}</td>
      <td class="p">${fmt(a.prix)}</td>
      <td class="idc">${idCell}</td>
      <td class="act"><button class="btn small" data-ce="${a.k}">Modifier</button> <button class="btn small" data-cd="${a.k}">Supprimer</button></td></tr>`;
  });
  $("catTable").innerHTML = `<table><thead><tr><th>Article</th><th>À fournir</th><th style="text-align:right">Prix</th><th style="text-align:right">ID Item</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  $("catTable").querySelectorAll("[data-ce]").forEach(b => b.onclick = () => {
    const a = ITEM[b.dataset.ce];
    catEdit = a.k;
    $("cCat").value = a.cat; $("cNom").value = a.nom; $("cPrix").value = a.prix;
    $("cId").value = a.id || "";
    $("cFourni").value = a.fourni || ""; $("cNote").value = a.note || "";
    $("cVars").innerHTML = ""; (a.variantes || []).forEach(v => ajouterVariante(v, a.varIds?.[v] || "")); majChampId();
    $("catFormTitle").textContent = "Modifier « " + a.nom + " »";
    $("cSave").textContent = "Enregistrer la modification";
    $("cCancel").style.display = "";
    $("catFormCard").classList.add("editing");
    $("catFormCard").scrollIntoView({ behavior: "smooth" });
  });
  // ID modifié dans le tableau -> enregistré tout de suite pour tout le monde
  $("catTable").querySelectorAll("[data-idk]").forEach(inp => inp.onchange = async () => {
    const a = ITEM[inp.dataset.idk]; if (!a) return;
    const val = inp.value.trim(), v = inp.dataset.idvar;
    let maj;
    if (v !== undefined) {
      const varIds = Object.assign({}, a.varIds);
      if (val) varIds[v] = val; else delete varIds[v];
      a.varIds = varIds;
      maj = { var_ids: Object.keys(varIds).length ? varIds : null };
    } else { a.id = val; maj = { item_id: val }; }
    inp.classList.toggle("missing", !val);
    majCompteurId();
    const { error } = await sb.from("articles").update(Object.assign(maj, { maj_le: new Date().toISOString() })).eq("id", a.k);
    if (error) { flash($("cIdMsg"), `ID de « ${a.nom} » non enregistré : ${error.message}`, false); chargerCatalogue(); }
    else { flash($("cIdMsg"), `ID de « ${a.nom} » enregistré.`, true); try { localStorage.setItem("catalogue_cache", JSON.stringify(CATALOGUE)); } catch {} }
  });
  $("catTable").querySelectorAll("[data-cd]").forEach(b => b.onclick = async () => {
    const a = ITEM[b.dataset.cd];
    if (!await confirmer(`Retirer « ${a.nom} » du catalogue (pour tout le monde) ? Les commandes déjà enregistrées ne sont pas modifiées.`)) return;
    const { error } = await sb.from("articles").delete().eq("id", a.k);
    if (error) return flash($("cIdMsg"), "Suppression impossible : " + error.message, false);
    if (catEdit === a.k) resetCatForm();
    flash($("cIdMsg"), `« ${a.nom} » retiré du catalogue.`, true);
    await chargerCatalogue();
  });
}
$("cSearch").oninput = renderCat;
$("cMissing").onchange = renderCat;

const manqueId = a => a.variantes ? a.variantes.some(v => !a.varIds?.[v]) : !a.id;
function majCompteurId() {
  const n = CATALOGUE.filter(manqueId).length;
  $("nbMissing").textContent = n ? `${n} article(s) sans ID complet` : "✔ Tous les articles ont un ID";
}

// Sauvegarde de secours
$("cExport").onclick = () => {
  const data = CATALOGUE.map(({ k, ordre, ...a }) => a);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "catalogue-" + today() + ".json";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ---------- Réglages : zones (châtellerie + coffre + membres automatiques) ---------- */
function renderZones() {
  if (!$("regZones")) return;
  const membres = (fonction, z) => COMPTES.filter(c => c.role === fonction && (c.zones || []).includes(z)).map(c => {
    const manuel = c.role_admin === fonction && (c.zones_admin || []).includes(z);
    const discord = (c.zones_discord || []).includes(z) && c.role_discord === fonction;
    return `<span class="puce${manuel ? " manuel" : ""}" title="${manuel ? "Ajouté(e) à la main" : "Via ses rôles Discord"}">${esc(c.nom || "?")}${discord && !manuel ? ' <small>Discord</small>' : ""}${manuel ? ` <button type="button" class="puce-x" data-affect="${c.id}|${fonction}|${z}|0" title="Retirer de la zone ${z}">✕</button>` : ""}</span>`;
  }).join("");
  const ajout = (fonction, z) => {
    const dispo = COMPTES.filter(c => c.role_discord !== "admin" && c.role !== "admin" && !(c.role === fonction && (c.zones || []).includes(z)));
    return dispo.length ? `<select class="puce-ajout" data-ajout="${fonction}|${z}"><option value="">+ ajouter…</option>${dispo.map(c => `<option value="${c.id}">${esc(c.nom || "?")}</option>`).join("")}</select>` : "";
  };
  $("regZones").innerHTML = `<table class="zones"><thead><tr><th>Zone</th><th>Coffre</th><th>Intendant</th><th>Secrétaire</th></tr></thead><tbody>${
    [1, 2, 3, 4, 5, 6, 7].map(z => {
      const k = REG.coffres.filter(c => c.zone_id === z);
      return `<tr><td><b>Zone ${z}</b></td>
        <td><input data-zone-nom="coffres|${z}|${k[0]?.id ?? ""}" value="${esc(k[0]?.nom || "")}" placeholder="Nom du coffre">${k.length > 1 ? `<span class="hint">+ ${k.slice(1).map(x => esc(x.nom)).join(", ")}</span>` : ""}</td>
        <td><div class="puces">${membres("intendant", z)}${ajout("intendant", z)}</div></td>
        <td><div class="puces">${membres("secretaire", z)}${ajout("secretaire", z)}</div></td></tr>`;
    }).join("")}</tbody></table>`;
  $("regZones").querySelectorAll("[data-zone-nom]").forEach(inp => inp.onchange = async () => {
    const [table, z, id] = inp.dataset.zoneNom.split("|"), nom = inp.value.trim();
    if (!nom) { renderZones(); return flash($("zonesMsg"), "Le nom du coffre ne peut pas être vide.", false); }
    if (REG[table].some(x => x.nom.toLowerCase() === nom.toLowerCase() && String(x.id) !== id)) { renderZones(); return flash($("zonesMsg"), `« ${nom} » existe déjà.`, false); }
    const { error } = id ? await sb.from(table).update({ nom }).eq("id", id)
                         : await sb.from(table).insert({ nom, zone_id: Number(z) });
    if (error) flash($("zonesMsg"), "Non enregistré : " + error.message, false);
    else flash($("zonesMsg"), `Zone ${z} : coffre « ${nom} » enregistré.`, true);
    await chargerReglages();
  });
  const affecter = async (compte, fonction, z, ajouter) => {
    const c = COMPTES.find(x => x.id === compte), lib = fonction === "intendant" ? "intendant" : "secrétaire";
    if (ajouter && c?.role && c.role !== fonction
        && !await confirmer(`${c.nom} est actuellement ${c.role === "intendant" ? "intendant" : "secrétaire"}. Une personne n'a qu'une fonction : la passer ${lib} (dans toutes ses zones) ?`)) return renderZones();
    const { error } = await sb.rpc("affecter_compte", { compte, fonction, zone: Number(z), ajouter });
    if (error) flash($("zonesMsg"), "Non enregistré : " + error.message + (/affecter_compte/.test(error.message) ? " (as-tu lancé 21_affectations.sql ?)" : ""), false);
    else flash($("zonesMsg"), `${c?.nom || "?"} ${ajouter ? "ajouté(e) en" : "retiré(e) de la"} zone ${z}${ajouter ? " comme " + lib : ""}.`, true);
    await chargerComptes(); await chargerReglages();
  };
  $("regZones").querySelectorAll("[data-ajout]").forEach(sel => sel.onchange = () => {
    if (!sel.value) return;
    const [fonction, z] = sel.dataset.ajout.split("|");
    affecter(sel.value, fonction, z, true);
  });
  $("regZones").querySelectorAll("[data-affect]").forEach(b => b.onclick = async () => {
    const [compte, fonction, z] = b.dataset.affect.split("|");
    const c = COMPTES.find(x => x.id === compte);
    if (!await confirmer(`Retirer ${c?.nom || "?"} de la zone ${z} ?`)) return;
    affecter(compte, fonction, z, false);
  });
}

/* ---------- Réglages : intendants ---------- */
const TABLES = {
  intendants:   { nom: "intendant",   liste: "regInt",  champ: "rInt",  msg: "rIntMsg" },
};
const nomIntendant = id => REG.intendants.find(i => String(i.id) === String(id))?.nom;
const optionsZones = choisi => `<option value="">— aucune zone —</option>` +
  [1, 2, 3, 4, 5, 6, 7].map(z => `<option value="${z}" ${String(z) === String(choisi ?? "") ? "selected" : ""}>Zone ${z}</option>`).join("");
const optionsIntendants = choisi => `<option value="">— aucun —</option>` +
  REG.intendants.map(i => `<option value="${i.id}" ${String(i.id) === String(choisi ?? "") ? "selected" : ""}>${esc(i.nom)}</option>`).join("");

function renderReg() {
  renderComptes();
  renderCompagnies();
  // listes "rattaché à" des formulaires d'ajout
  renderZones();
  Object.entries(TABLES).forEach(([table, t]) => {
    const rows = REG[table];
    if (!rows.length) { $(t.liste).innerHTML = `<p class="empty">Aucun(e) ${t.nom}.</p>`; return; }
    $(t.liste).innerHTML = `<table><tbody>${rows.map(r => {
      let info = "";
      if (table === "intendants") {
        const comptes = COMPTES.filter(c => String(c.intendant_id) === String(r.id));
        const zs = [...new Set(comptes.flatMap(c => c.zones || []))];
        if (zs.length) info = `<span class="hint">Zone ${zs.join(", ")}</span>`;
      }
      return `<tr class="reg-row"><td><b>${esc(r.nom)}</b>${info ? "<br>" + info : ""}</td>
        ${t.lien ? `<td class="reg-lien"><select data-lien="${table}|${r.id}">${optionsZones(r.zone_id)}</select></td>` : ""}
        <td class="act"><button class="btn small" data-rdel="${table}|${r.id}">Supprimer</button></td></tr>`;
    }).join("")}</tbody></table>`;
  });
  $("viewReg").querySelectorAll("[data-lien]").forEach(sel => sel.onchange = async () => {
    const [table, id] = sel.dataset.lien.split("|");
    const { error } = await sb.from(table).update({ zone_id: sel.value ? Number(sel.value) : null }).eq("id", id);
    if (error) return flash($(TABLES[table].msg), "Non enregistré : " + error.message + " (as-tu lancé 19_secretaires.sql ?)", false);
    flash($(TABLES[table].msg), "Zone enregistrée.", true);
    await chargerReglages();
  });
  $("viewReg").querySelectorAll("[data-rdel]").forEach(b => b.onclick = async () => {
    const [table, id] = b.dataset.rdel.split("|"), t = TABLES[table];
    const r = REG[table].find(x => String(x.id) === id);
    const suite = "";
    if (!await confirmer(`Supprimer ${t.nom === "intendant" ? "l'intendant" : t.nom === "coffre" ? "le coffre" : "la châtellerie"} « ${r.nom} » (pour tout le monde) ?${suite} L'historique n'est pas modifié.`)) return;
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) return flash($(t.msg), "Suppression impossible : " + error.message, false);
    flash($(t.msg), `« ${r.nom} » supprimé.`, true);
    await chargerReglages();
  });
}

Object.entries(TABLES).forEach(([table, t]) => {
  const ajouter = async () => {
    const nom = $(t.champ).value.trim();
    if (!nom) return flash($(t.msg), "Renseigne le nom.", false);
    if (REG[table].some(x => x.nom.toLowerCase() === nom.toLowerCase())) return flash($(t.msg), `« ${nom} » existe déjà.`, false);
    const ligne = { nom };
    if (t.lien) ligne.zone_id = $(t.lien).value ? Number($(t.lien).value) : null;
    const { error } = await sb.from(table).insert(ligne);
    if (error) return flash($(t.msg), "Non enregistré : " + error.message, false);
    $(t.champ).value = "";
    flash($(t.msg), `« ${nom} » ajouté.`, true);
    await chargerReglages();
  };
  $(t.champ + "Add").onclick = ajouter;
  $(t.champ).onkeydown = e => { if (e.key === "Enter") ajouter(); };
});

/* ---------- États Livré / Payé (règles vérifiées aussi par la base) ---------- */
async function changerEtat(c) {
  const [etat, pid, oid] = c.dataset.etat.split("|");
  const p = hist.find(x => x.id === pid), o = p?.orders.find(x => x.id === oid);
  if (!o) return;
  const val = c.checked, champ = etat === "paye" ? "payeLe" : "livreLe";
  const avant = toutPaye(p), dansHist = !!c.closest("#viewHist"), msg = $(dansHist ? "histMsg" : "stockMsg");
  o[champ] = val ? new Date().toISOString() : null;
  renderHist(); renderStock();
  if (avant !== toutPaye(p) && dansHist) flash(msg, avant
    ? `Permanence ${p.lieu} du ${dateFR(p.date)} remise dans les commandes en cours.`
    : `Permanence ${p.lieu} du ${dateFR(p.date)} entièrement payée : elle passe dans l'historique.`, true);
  const { error } = await sb.rpc(etat === "paye" ? "marquer_paye" : "marquer_livre", { pid, oid, [etat === "paye" ? "paye" : "livre"]: val });
  if (error) { flash(msg, "Non enregistré : " + error.message, false); chargerHist(); }
}

/* ---------- Stock : livré par l'administration, pas encore payé par le client ---------- */
function renderStock() {
  if ($("viewStock").hidden) return;
  const fi = $("sInt").value, fl = $("sLieu").value;
  const fc = sansAccent($("sClient").value.trim()), fa = sansAccent($("sItem").value.trim());
  const lignes = [];
  hist.forEach(p => p.orders.forEach(o => {
    if (!o.livreLe || o.payeLe) return;
    if ((fi && p.intendant !== fi) || (fl && p.lieu !== fl) || (fc && !sansAccent(o.client).includes(fc))) return;
    const items = o.items.filter(x => !fa || sansAccent(lib(x)).includes(fa));
    if (items.length) lignes.push({ p, o, items });
  }));
  // total par article
  const tot = new Map();
  lignes.forEach(l => l.items.forEach(x => { const k = lib(x); tot.set(k, (tot.get(k) || 0) + x.qte); }));
  const triee = [...tot].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  $("stockNb").textContent = triee.reduce((s, [, q]) => s + q, 0);
  $("stockTotal").innerHTML = triee.length
    ? `<table><thead><tr><th style="text-align:right">Qté</th><th>Article</th></tr></thead><tbody>${triee.map(([k, q]) => `<tr><td class="n">${q}</td><td>${esc(k)}</td></tr>`).join("")}</tbody></table>`
    : '<p class="empty">Rien en stock.</p>';
  // détail par châtellerie puis client
  lignes.sort((a, b) => a.p.lieu.localeCompare(b.p.lieu, "fr") || a.o.client.localeCompare(b.o.client, "fr"));
  let cur = null, html = "";
  lignes.forEach(({ p, o, items }) => {
    if (p.lieu !== cur) { html += `<h3 class="stock-lieu">${esc(p.lieu || "—")}</h3>`; cur = p.lieu; }
    html += `<div class="order livree"><div class="order-head"><b>${esc(o.client)}</b><span class="hint">${esc(o.type || "")} · permanence du ${dateFR(p.date)} · ${esc(p.intendant)}</span>
      <span class="total" style="font-size:.9rem">${fmt(totalOrder(o))}</span></div>
      <ul>${items.map(x => `<li>${x.qte} × ${esc(lib(x))}</li>`).join("")}</ul>
      <div class="row etats" style="margin-top:6px"><span class="hint">Livré le ${new Date(o.livreLe).toLocaleString("fr-FR")}</span>
      <label class="liv pay"><input type="checkbox" data-etat="paye|${esc(p.id)}|${esc(o.id)}"> Payé (remis au client)</label></div></div>`;
  });
  $("stockDetail").innerHTML = html || '<p class="empty">Aucun article en stock pour ces filtres.</p>';
  $("stockDetail").querySelectorAll("[data-etat]").forEach(c => c.onchange = () => changerEtat(c));
}
["sInt", "sLieu"].forEach(id => $(id).onchange = renderStock);
["sClient", "sItem"].forEach(id => $(id).oninput = renderStock);

/* ---------- Contrats d'exportation (admin) ---------- */
// Images : dossiers du site (GitHub) — contrats/<slug>-<taille>.jpg et sceaux/<ville>.png
const imgContrat = c => {
  const k = COMPAGNIES.find(x => x.slug === c.slug);
  const surSite = k ? k.images === "site" : SLUGS_SITE.includes(c.slug);
  return surSite ? `contrats/${c.slug}-${c.taille}.jpg`
    : `${SUPABASE_URL}/storage/v1/object/public/contrats/modeles/${c.slug}-${c.taille}.jpg` + (k ? "?v=" + Date.parse(k.maj_le) : "");
};
const imgSceau = v => `sceaux/${SCEAUX[cleVille(v)]}.png`;
// Compagnies : table Supabase « compagnies » (Réglages > Compagnies d'exportation, admin)
let COMPAGNIES = [];
// les 26 premières ont leurs images dans le dossier contrats/ du site ; les autres dans Supabase
const SLUGS_SITE = ["brasserie", "marchands", "leyawiin", "corberoc", "cote-dor", "chendinhal", "garnison-bruma", "gilane",
  "clairetoison", "val-boise", "tourbevase", "aubeneuve", "cyrodiil", "senchal", "elegance", "miniere-bruma", "scorpion",
  "alinor", "sentinelle", "redoran", "telvanni", "chornol", "dhalmora", "necrom", "rihad", "daguefilante"];
async function chargerCompagnies() {
  const { data, error } = await sb.from("compagnies").select("*").order("ordre").order("nom");
  if (error) { flash($("ctrMsg"), "Compagnies indisponibles : " + error.message + " (as-tu lancé 18_compagnies.sql ?)", false); return; }
  COMPAGNIES = data || [];
  if (!$("viewReg").hidden) renderCompagnies();
}
const TIRAGE = ["gros", "moyen", "moyen", "petit", "petit", "petit"];
const LIB_TAILLE = { gros: "Gros contrat", moyen: "Contrat moyen", petit: "Petit contrat" };
let tirage = null;

// Villes = table chatellerie_discord (une ville = un salon Discord avec son webhook)
async function majLieuxContrats() {
  const sel = $("ctrLieu"), garde = sel.value;
  const { data, error } = await sb.rpc("villes_contrats");
  if (error) return flash($("ctrMsg"), "Liste des villes indisponible : " + error.message + " (as-tu lancé 17_contrats.sql ?)", false);
  sel.innerHTML = data.map(v => `<option value="${esc(v.ville)}"${v.pret ? "" : " disabled"}>${esc(v.ville)}${v.pret ? "" : " — pas de webhook"}</option>`).join("");
  const prete = data.find(v => v.ville === garde && v.pret) || data.find(v => v.pret);
  if (prete) sel.value = prete.ville;
}
function genererContrats() {
  // une compagnie différente par contrat, tirée au hasard
  const melange = COMPAGNIES.filter(c => c.actif);
  if (melange.length < TIRAGE.length) { flash($("ctrMsg"), `Il faut au moins ${TIRAGE.length} compagnies actives (Réglages) : il y en a ${melange.length}.`, false); return false; }
  for (let i = melange.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [melange[i], melange[j]] = [melange[j], melange[i]]; }
  tirage = { lieu: $("ctrLieu").value, contrats: TIRAGE.map((taille, i) => {
    const c = melange[i % melange.length];
    return { slug: c.slug, taille, nom: c.nom, prix: c.contrats[taille].prix, lignes: c.contrats[taille].lignes };
  }) };
  $("ctrTitre").textContent = `Aperçu — ${tirage.lieu}`;
  $("ctrListe").innerHTML = tirage.contrats.map(c => `<figure class="ctr ctr-${c.taille}">
      <figcaption><b>${LIB_TAILLE[c.taille]}</b><span class="hint">${esc(c.nom)}</span><span class="ctr-prix">${fmt(c.prix)}</span></figcaption>
      <img src="${imgContrat(c)}" alt="${esc(c.nom)} — ${LIB_TAILLE[c.taille]}" loading="lazy">
    </figure>`).join("");
  $("ctrApercu").hidden = false;
  $("ctrMsg").className = "msg";
}
$("ctrGen").onclick = () => { if (!$("ctrLieu").value) return flash($("ctrMsg"), "Aucune ville n'a de webhook : renseigne-le dans la table chatellerie_discord.", false); if (genererContrats() !== false) $("ctrApercu").scrollIntoView({ behavior: "smooth" }); };
$("ctrRegen").onclick = genererContrats;
// Sceaux des villes (dossier sceaux/ du site : <ville sans accent>.png)
// ville (sans accent ni tiret) -> nom du fichier dans sceaux/
const SCEAUX = {
  aubetoile: "aubetoile", blancherive: "blancherive", bruma: "bruma", epervine: "epervine",
  faillaise: "faillaise", forthiver: "fortdhiver", markarth: "markarth", morthal: "morthal",
  solitude: "solitude", vendeaume: "vendeaume",
};
const cleVille = v => sansAccent(v).replace(/[^a-z0-9]/g, "");
const aSceau = v => cleVille(v) in SCEAUX;
const ANGLES = [-8, 6, -4, 9, -10, 5];          // inclinaison du sceau, comme un vrai cachet
const SCEAU_Y = 0.835, SCEAU_L = 0.62;          // centre (hauteur) et largeur du sceau dans un contrat
const chargerImage = src => new Promise((ok, ko) => {
  const im = new Image();
  im.crossOrigin = "anonymous";            // images Supabase : nécessaire pour assembler l'image
  im.onload = () => ok(im);
  im.onerror = () => ko(new Error("image introuvable : " + src.split("/").pop() + ""));
  im.src = src;
});

// Les contrats assemblés côte à côte dans une seule image (même ordre que l'aperçu),
// avec le sceau de la ville sur ceux réalisés (realises = { "3": {…}, … })
async function imageContrats(contrats, realises = {}, ville = "") {
  const imgs = await Promise.all(contrats.map(c => chargerImage(imgContrat(c))));
  const sceaux = await Promise.all(contrats.map((c, i) => {
    return realises[String(i + 1)] && aSceau(ville) ? chargerImage(imgSceau(ville)) : null;
  }));
  const h = Math.min(900, Math.max(...imgs.map(i => i.naturalHeight))), ecart = 12, marge = 12;   // image allégée pour Discord
  const largeurs = imgs.map(i => Math.round(i.naturalWidth * h / i.naturalHeight));
  const cv = document.createElement("canvas");
  cv.width = largeurs.reduce((s, w) => s + w, 0) + ecart * (imgs.length - 1) + marge * 2;
  cv.height = h + marge * 2;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#1b1a22"; ctx.fillRect(0, 0, cv.width, cv.height);
  let x = marge;
  imgs.forEach((im, i) => {
    ctx.drawImage(im, x, marge, largeurs[i], h);
    const s = sceaux[i];
    if (s) {
      const k = largeurs[i] * SCEAU_L / Math.max(s.naturalWidth, s.naturalHeight);
      const sw = s.naturalWidth * k, sh = s.naturalHeight * k;
      ctx.save();
      ctx.translate(x + largeurs[i] / 2, marge + h * SCEAU_Y);
      ctx.rotate(ANGLES[i % ANGLES.length] * Math.PI / 180);
      ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
      ctx.drawImage(s, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }
    x += largeurs[i] + ecart;
  });
  return new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.78));
}
// Envoi à la fonction Supabase « contrats » : elle poste sur Discord avec l'image en pièce jointe
async function appelContrats(champs, blob) {
  const fd = new FormData();
  Object.entries(champs).forEach(([k, v]) => fd.append(k, typeof v === "string" ? v : JSON.stringify(v)));
  fd.append("image", blob, "contrats.jpg");
  const { data, error } = await sb.functions.invoke("contrats", { body: fd });
  if (error) {
    let m = error.message;
    try { const j = await error.context.json(); if (j?.error) m = j.error; } catch {}
    if (/Failed to send|404|not found/i.test(m)) m += " (la fonction « contrats » est-elle déployée dans Supabase ?)";
    throw new Error(m);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

$("ctrEnvoi").onclick = async () => {
  if (!tirage) return;
  if (!await confirmer(`Envoyer ces ${tirage.contrats.length} contrats d'exportation dans le salon de ${tirage.lieu} ?`)) return;
  $("ctrEnvoi").disabled = true;
  try {
    await appelContrats({
      action: "envoyer", lieu: tirage.lieu,
      contrats: tirage.contrats.map(({ slug, taille, nom, prix }) => ({ slug, taille, nom, prix })),
    }, await imageContrats(tirage.contrats));
    flash($("ctrMsg"), `Contrats envoyés sur Discord pour ${tirage.lieu} ✔`, true);
    $("ctrApercu").hidden = true; tirage = null;
    chargerSuivi();
    $("ctrMsg").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    flash($("ctrMsg"), "Envoi impossible : " + e.message, false);
  } finally {
    $("ctrEnvoi").disabled = false;
  }
};

/* ---------- Contrats envoyés, par ville (admin : toutes ; intendant : sa zone) ---------- */
// Cocher = réalisé (sceau de la ville sur le contrat). Tout coché = accompli, retiré 7 jours après.
let ENVOIS = [];
const VILLES_OUVERTES = new Set();
const contratsDe = e => (e.contrats || []).filter(c => c.slug);
const JOUR = 864e5;
async function chargerSuivi() {
  const depuis = new Date(Date.now() - 7 * JOUR).toISOString();
  const { data, error } = await sb.from("contrats_envois").select("id, lieu, contrats, envoye_le, realises, version, accompli_le")
    .not("message_id", "is", null).or(`accompli_le.is.null,accompli_le.gt.${depuis}`)
    .order("envoye_le", { ascending: false }).limit(200);
  if (error) return flash($("suiviMsg"), "Contrats indisponibles : " + error.message + " (as-tu lancé 17_contrats.sql ?)", false);
  ENVOIS = data || [];
  renderSuivi();
}
function sceauHtml(ville, i) {
  return aSceau(ville) ? `<img class="sceau" src="${imgSceau(ville)}" alt="Sceau de ${esc(ville)}" style="--a:${ANGLES[i % ANGLES.length]}deg">` : "";
}
function renderSuivi() {
  $("ctrSuivi").querySelectorAll("details").forEach(d => d.open ? VILLES_OUVERTES.add(d.dataset.ville) : VILLES_OUVERTES.delete(d.dataset.ville));
  if (!ENVOIS.length) { $("ctrSuivi").innerHTML = `<p class="hint">Aucun contrat en cours.</p>`; return; }
  const villes = [...new Set(ENVOIS.map(e => e.lieu))].sort((a, b) => a.localeCompare(b, "fr"));
  if (villes.length === 1) VILLES_OUVERTES.add(villes[0]);
  const dateCourte = d => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  $("ctrSuivi").innerHTML = villes.map(v => {
    const envois = ENVOIS.filter(e => e.lieu === v).sort((a, b) => !!a.accompli_le - !!b.accompli_le);   // accomplis en dernier
    const enCours = envois.filter(e => !e.accompli_le).length, finis = envois.length - enCours;
    const restants = envois.reduce((s, e) => s + contratsDe(e).length - Object.keys(e.realises || {}).length, 0);
    return `<details class="ville-suivi" data-ville="${esc(v)}" ${VILLES_OUVERTES.has(v) ? "open" : ""}>
      <summary><b>${esc(v)}</b><span class="hint">${enCours} envoi${enCours > 1 ? "s" : ""} en cours · ${restants} contrat${restants > 1 ? "s" : ""} à remplir${finis ? ` · ${finis} accompli${finis > 1 ? "s" : ""}` : ""}</span></summary>
      ${envois.map(e => {
        const cs = contratsDe(e), rea = e.realises || {}, nb = Object.keys(rea).length;
        return `<div class="suivi${e.accompli_le ? " accompli" : ""}" data-envoi="${e.id}">
          <div class="suivi-tete"><span>Envoyé le ${dateCourte(e.envoye_le)}</span>
            <span class="tag ${e.accompli_le ? "ok" : ""}">${e.accompli_le ? "✅ Accompli" : `${nb} / ${cs.length} réalisé${nb > 1 ? "s" : ""}`}</span>
            ${e.accompli_le ? `<span class="hint">disparaît le ${new Date(new Date(e.accompli_le).getTime() + 7 * JOUR).toLocaleDateString("fr-FR")}</span>` : ""}</div>
          <div class="ctr-grille">${cs.map((c, i) => {
            const n = i + 1, fait = !!rea[String(n)];
            return `<label class="ctr suivi-ctr${fait ? " fait" : ""}">
              <span class="suivi-cap"><input type="checkbox" value="${n}" ${fait ? "checked" : ""}> <b>${n}.</b> ${esc(c.nom)}
                <span class="hint">${fmt(c.prix)}</span></span>
              <span class="ctr-img"><img src="${imgContrat(c)}" alt="${esc(c.nom)}" loading="lazy">${fait ? sceauHtml(e.lieu, i) : ""}</span>
            </label>`;
          }).join("")}</div>
          <div class="row suivi-actions" hidden>
            <button type="button" class="btn primary small" data-enr>Enregistrer et mettre à jour Discord</button>
            <button type="button" class="btn small" data-annul>Annuler</button>
          </div>
          ${estAdmin() ? `<div class="row suivi-suppr"><button type="button" class="btn small" data-suppr>Supprimer cet envoi (site + message Discord)</button></div>` : ""}
        </div>`;
      }).join("")}
    </details>`;
  }).join("");
  const box = $("ctrSuivi");
  box.querySelectorAll("details").forEach(d => d.ontoggle = () => d.open ? VILLES_OUVERTES.add(d.dataset.ville) : VILLES_OUVERTES.delete(d.dataset.ville));
  box.querySelectorAll(".suivi").forEach(bloc => {
    const e = ENVOIS.find(x => String(x.id) === bloc.dataset.envoi);
    const modifie = () => bloc.querySelectorAll("input[type=checkbox]").length && [...bloc.querySelectorAll("input[type=checkbox]")].some(c => c.checked !== !!(e.realises || {})[c.value]);
    bloc.querySelectorAll("input[type=checkbox]").forEach(c => c.onchange = () => {
      // aperçu immédiat du sceau
      const lab = c.closest(".suivi-ctr"), img = lab.querySelector(".ctr-img");
      lab.classList.toggle("fait", c.checked);
      img.querySelector(".sceau")?.remove();
      if (c.checked) img.insertAdjacentHTML("beforeend", sceauHtml(e.lieu, Number(c.value) - 1));
      bloc.querySelector(".suivi-actions").hidden = !modifie();
    });
    bloc.querySelector("[data-annul]").onclick = renderSuivi;
    bloc.querySelector("[data-enr]").onclick = () => enregistrerSuivi(bloc, e);
    const suppr = bloc.querySelector("[data-suppr]");
    if (suppr) suppr.onclick = async () => {
      if (!await confirmer(`Supprimer cet envoi de ${e.lieu} ? Le message Discord sera supprimé aussi.`)) return;
      suppr.disabled = true;
      const { error } = await sb.rpc("supprimer_contrats", { envoi: e.id });
      flash($("suiviMsg"), error ? "Suppression impossible : " + error.message : "Envoi supprimé ✔", !error);
      await chargerSuivi();
    };
  });
}
async function enregistrerSuivi(bloc, e) {
  const faits = [...bloc.querySelectorAll("input[type=checkbox]:checked")].map(c => Number(c.value));
  bloc.querySelectorAll("button, input").forEach(b => b.disabled = true);
  const btn = bloc.querySelector("[data-enr]"); btn.textContent = "Mise à jour de Discord… (quelques secondes)";
  try {
    const rea = Object.fromEntries(faits.map(n => [String(n), true]));
    await appelContrats({ action: "maj", envoi: String(e.id), version_vue: String(e.version), faits }, await imageContrats(contratsDe(e), rea, e.lieu));
    flash($("suiviMsg"), faits.length === contratsDe(e).length ? `Contrats de ${e.lieu} accomplis ✔ (ils disparaîtront dans 7 jours)` : "Enregistré, message Discord mis à jour ✔", true);
  } catch (err) {
    flash($("suiviMsg"), "Impossible : " + err.message, false);
  } finally {
    await chargerSuivi();
  }
}

/* ---------- Compagnies d'exportation (Réglages, admin) ---------- */
// Planche complète (colonnes côte à côte sur fond transparent) -> 3 contrats : petit, moyen, gros
const TAILLES = ["petit", "moyen", "gros"];
let PLANCHE = null;          // { petit: Blob, moyen: Blob, gros: Blob } découpés
let CIE_EDIT = null;         // slug de la compagnie en cours de modification
const slugDe = nom => sansAccent(nom).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
async function decouperPlanche(fichier) {
  const url = URL.createObjectURL(fichier);
  try {
    const im = await chargerImage(url);
    const W = im.naturalWidth, H = im.naturalHeight;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"); ctx.drawImage(im, 0, 0);
    const px = ctx.getImageData(0, 0, W, H).data;
    // une colonne de pixels appartient à un contrat si elle est opaque sur plus de la moitié de sa hauteur
    const pleine = x => { let n = 0; for (let y = 0; y < H; y += 2) if (px[(y * W + x) * 4 + 3] > 200) n++; return n > H / 4; };
    const bandes = []; let debut = null;
    for (let x = 0; x <= W; x++) {
      const p = x < W && pleine(x);
      if (p && debut === null) debut = x;
      if (!p && debut !== null) { if (x - debut > W / 20) bandes.push([debut, x]); debut = null; }
    }
    if (bandes.length < 3) throw new Error(`je ne trouve que ${bandes.length} contrat(s) sur la planche (il en faut 3 : petit, moyen, gros, de gauche à droite)`);
    const res = {};
    await Promise.all(bandes.slice(0, 3).map(([x0, x1], i) => {
      const c = document.createElement("canvas"); c.width = x1 - x0; c.height = H;
      const k = c.getContext("2d"); k.fillStyle = "#1b1a22"; k.fillRect(0, 0, c.width, H);
      k.drawImage(cv, x0, 0, x1 - x0, H, 0, 0, x1 - x0, H);
      return new Promise(ok => c.toBlob(b => { res[TAILLES[i]] = b; ok(); }, "image/jpeg", 0.88));
    }));
    return res;
  } finally { URL.revokeObjectURL(url); }
}
function renderCompagnies() {
  if (!$("regCie")) return;
  $("regCie").innerHTML = COMPAGNIES.length ? `<table><tbody>${COMPAGNIES.map(c => `<tr class="reg-row${c.actif ? "" : " cie-off"}">
      <td><img class="cie-mini" src="${imgContrat({ slug: c.slug, taille: "petit" })}" alt="" loading="lazy"></td>
      <td><b>${esc(c.nom)}</b><br><span class="hint">${TAILLES.map(t => fmt(c.contrats?.[t]?.prix)).join(" · ")}${c.actif ? "" : " — désactivée"}</span></td>
      <td class="reg-act"><label class="liv"><input type="checkbox" data-cie-actif="${esc(c.slug)}" ${c.actif ? "checked" : ""}> Au tirage</label>
        <button type="button" class="btn small" data-cie-edit="${esc(c.slug)}">Modifier</button>
        <button type="button" class="btn small" data-cie-suppr="${esc(c.slug)}">Supprimer</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="empty">Aucune compagnie.</p>';
  $("cieNb").textContent = `${COMPAGNIES.filter(c => c.actif).length} au tirage sur ${COMPAGNIES.length}`;
  $("regCie").querySelectorAll("[data-cie-actif]").forEach(c => c.onchange = async () => {
    const { error } = await sb.from("compagnies").update({ actif: c.checked, maj_le: new Date().toISOString() }).eq("slug", c.dataset.cieActif);
    if (error) flash($("cieMsg"), "Impossible : " + error.message, false);
    chargerCompagnies();
  });
  $("regCie").querySelectorAll("[data-cie-edit]").forEach(b => b.onclick = () => editerCompagnie(b.dataset.cieEdit));
  $("regCie").querySelectorAll("[data-cie-suppr]").forEach(b => b.onclick = async () => {
    const c = COMPAGNIES.find(x => x.slug === b.dataset.cieSuppr);
    if (!await confirmer(`Supprimer la compagnie « ${c.nom} » ? Elle ne sortira plus au tirage (les contrats déjà envoyés restent visibles).`)) return;
    const { error } = await sb.from("compagnies").delete().eq("slug", c.slug);
    flash($("cieMsg"), error ? "Impossible : " + error.message : `${c.nom} supprimée ✔`, !error);
    chargerCompagnies();
  });
}
function viderFormCie() {
  CIE_EDIT = null; PLANCHE = null;
  $("cieNom").value = ""; $("ciePlanche").value = ""; $("cieApercu").innerHTML = "";
  TAILLES.forEach(t => { $("ciePrix-" + t).value = ""; });
  $("cieTitre").textContent = "Ajouter une compagnie"; $("cieAnnul").hidden = true;
  $("ciePlancheAide").textContent = "Planche complète (les contrats petit, moyen et gros côte à côte, de gauche à droite)";
}
function editerCompagnie(slug) {
  const c = COMPAGNIES.find(x => x.slug === slug); if (!c) return;
  viderFormCie(); CIE_EDIT = slug;
  $("cieNom").value = c.nom;
  TAILLES.forEach(t => { $("ciePrix-" + t).value = c.contrats?.[t]?.prix ?? ""; });
  $("cieApercu").innerHTML = TAILLES.map(t => `<figure class="ctr"><figcaption><b>${t}</b></figcaption><img src="${imgContrat({ slug, taille: t })}" alt=""></figure>`).join("");
  $("cieTitre").textContent = "Modifier : " + c.nom; $("cieAnnul").hidden = false;
  $("ciePlancheAide").textContent = "Nouvelle planche (facultatif : laisse vide pour garder les images actuelles)";
  $("cieForm").scrollIntoView({ behavior: "smooth" });
}
$("cieAnnul").onclick = viderFormCie;
$("ciePlanche").onchange = async () => {
  const f = $("ciePlanche").files[0]; PLANCHE = null; $("cieApercu").innerHTML = "";
  if (!f) return;
  try {
    PLANCHE = await decouperPlanche(f);
    $("cieApercu").innerHTML = TAILLES.map(t => `<figure class="ctr"><figcaption><b>${t}</b></figcaption><img src="${URL.createObjectURL(PLANCHE[t])}" alt=""></figure>`).join("");
  } catch (e) { flash($("cieMsg"), "Découpage impossible : " + e.message, false); $("ciePlanche").value = ""; }
};
$("cieSave").onclick = async () => {
  const nom = $("cieNom").value.trim();
  if (!nom) return flash($("cieMsg"), "Donne un nom à la compagnie.", false);
  const contrats = {};
  for (const t of TAILLES) {
    const prix = Math.round(Number($("ciePrix-" + t).value));
    if (!(prix > 0)) return flash($("cieMsg"), `Prix du contrat ${t} manquant.`, false);
    // les articles sont lus sur l'image : on garde ceux déjà connus pour les anciennes compagnies
    contrats[t] = { prix, lignes: COMPAGNIES.find(c => c.slug === CIE_EDIT)?.contrats?.[t]?.lignes || [] };
  }
  let slug = CIE_EDIT;
  if (!slug) {
    slug = slugDe(nom) || "compagnie";
    let n = 2, base = slug; while (COMPAGNIES.some(c => c.slug === slug)) slug = `${base}-${n++}`;
    if (!PLANCHE) return flash($("cieMsg"), "Ajoute la planche des contrats.", false);
  }
  $("cieSave").disabled = true;
  try {
    const ligne = { slug, nom, contrats, maj_le: new Date().toISOString() };
    if (PLANCHE) {
      for (const t of TAILLES) {
        const { error } = await sb.storage.from("contrats").upload(`modeles/${slug}-${t}.jpg`, PLANCHE[t], { contentType: "image/jpeg", upsert: true, cacheControl: "60" });
        if (error) throw new Error("dépôt de l'image " + t + " impossible (" + error.message + ")");
      }
      ligne.images = "supabase";
    }
    const { error } = CIE_EDIT
      ? await sb.from("compagnies").update(ligne).eq("slug", slug)
      : await sb.from("compagnies").insert({ ...ligne, images: "supabase", actif: true, ordre: 1000 + COMPAGNIES.length });
    if (error) throw new Error(error.message);
    flash($("cieMsg"), `${nom} ${CIE_EDIT ? "modifiée" : "ajoutée"} ✔`, true);
    viderFormCie();
    await chargerCompagnies();
  } catch (e) {
    flash($("cieMsg"), "Enregistrement impossible : " + e.message, false);
  } finally { $("cieSave").disabled = false; }
};

/* ---------- Comptes (Réglages, admin) ---------- */
let COMPTES = [];
async function chargerComptes() {
  const { data, error } = await sb.from("profils").select("*").order("verifie_le", { ascending: false });
  if (!error) COMPTES = data;
  if (!$("viewReg").hidden) renderZones();
  if (!$("viewReg").hidden) renderComptes();
}
function renderComptes() {
  const libRole = { admin: "Administrateur", intendant: "Intendant", secretaire: "Secrétaire" };
  $("regComptes").innerHTML = COMPTES.length ? `<table><tbody>${COMPTES.map(c => `<tr class="reg-row"><td><b>${esc(c.nom || "?")}</b><br>
    <span class="hint">${c.role ? libRole[c.role] : "Aucun rôle (accès refusé)"}${c.role && c.role !== "admin" && c.zones?.length ? " · zone " + c.zones.join(", ") : ""} · vérifié le ${c.verifie_le ? new Date(c.verifie_le).toLocaleString("fr-FR") : "—"}</span></td>
    <td class="reg-lien hint">${c.intendant_id ? "Intendant : <b>" + esc(nomIntendant(c.intendant_id) || "?") + "</b>" : (c.role === "intendant" ? "⚠ pas encore d'intendant (reconnexion)" : "")}</td></tr>`).join("")}</tbody></table>`
    : '<p class="empty">Personne ne s\'est encore connecté.</p>';
}

/* ---------- Connexion Discord ---------- */
function ecranConnexion(msg, connecte) {
  $("app").hidden = true; $("login").hidden = false;
  $("loginMsg").textContent = msg || "";
  $("loginMsg").hidden = !msg;
  $("loginBtn").textContent = connecte ? "Se reconnecter avec Discord" : "Se connecter avec Discord";
  $("loginOut").hidden = !connecte;
}
$("loginBtn").onclick = async () => {
  await sb.auth.signOut();
  const { error } = await sb.auth.signInWithOAuth({ provider: "discord",
    options: { scopes: "identify guilds.members.read", redirectTo: SITE_URL + "/" } });
  if (error) ecranConnexion("Connexion impossible : " + error.message, false);
};
const deconnexion = async () => {
  try { ["catalogue_cache", "reglages_cache"].forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem("sync"); } catch {}
  await sb.auth.signOut(); location.reload();
};
$("loginOut").onclick = deconnexion;
$("logout").onclick = deconnexion;

let enCours = false, demarre = false;
async function verifierAcces(session) {
  if (enCours) return; enCours = true;
  try {
    if (!session) return ecranConnexion("", false);
    // Juste après la connexion, Supabase fournit le jeton Discord : la base vérifie les rôles sur le serveur
    const marque = session.provider_token ? session.provider_token.slice(-16) : null;
    if (marque && sessionStorage.getItem("sync") !== marque) {
      const { error } = await sb.rpc("synchroniser_role", { jeton: session.provider_token });
      if (error) return ecranConnexion("Vérification Discord impossible : " + error.message, true);
      try { sessionStorage.setItem("sync", marque); } catch {}
    }
    const [{ data: role }, { data: prof }] = await Promise.all([
      sb.rpc("mon_role"),
      sb.from("profils").select("nom, avatar, role, intendant_id, zones").eq("id", session.user.id).maybeSingle(),
    ]);
    if (!role) return ecranConnexion(prof
      ? `Connecté en tant que ${prof.nom || "?"}, mais sans accès : il faut le rôle Intendant ou Secrétaire avec un rôle de zone (Zone 1 à 7), ou le rôle Administrateur, sur le serveur Discord (ou ta dernière vérification date de plus de 7 jours : reconnecte-toi).`
      : "Reconnecte-toi avec Discord pour vérifier tes rôles.", true);
    ROLE = role; PROFIL = prof;
    demarrer();
  } finally { enCours = false; }
}
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "INITIAL_SESSION" || ev === "SIGNED_IN") setTimeout(() => verifierAcces(session), 0);
  if (ev === "SIGNED_OUT") ecranConnexion("", false);
});

function demarrer() {
  $("login").hidden = true; $("app").hidden = false;
  if (location.hash || location.search.includes("code=")) history.replaceState(null, "", location.pathname);
  $("userName").textContent = PROFIL?.nom || "";
  $("userRole").textContent = estAdmin() ? "Administrateur" : estSecretaire() ? "Secrétaire" : "Intendant";
  $("send").hidden = estSecretaire();
  $("secHint").hidden = !estSecretaire();
  if (PROFIL?.avatar) { $("userAvatar").src = PROFIL.avatar; $("userAvatar").hidden = false; }
  $("tabCat").hidden = $("tabReg").hidden = $("tabCtr").hidden = !estAdmin();
  $("sIntWrap").hidden = !estAdmin();
  $("fIntWrap").hidden = $("fLieuWrap").hidden = !estAdmin();
  if (demarre) return; demarre = true;
  if (estZone()) state.orders = [];        // la permanence vient de la base (partagée avec la zone)
  majPermanence(); majFiltres();
  chargerForm(state.draft);
  chargerZone();
  render();
  let t0 = "perm"; try { t0 = sessionStorage.getItem("tab") || "perm"; } catch {}
  showTab(t0);
  ecouter();
  chargerReglages(); chargerCatalogue(); chargerHist();
  if (estAdmin()) { chargerComptes(); chargerCompagnies(); }
}

/* ---------- Démarrage ---------- */
if (SUPABASE_URL.includes("XXXXXXXX")) ecranConnexion("⚠ Renseigne SUPABASE_URL et SUPABASE_KEY en haut de script.js.", false);