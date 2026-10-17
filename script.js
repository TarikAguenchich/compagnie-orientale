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
  id: r.item_id || "", variantes: r.variantes?.length ? r.variantes : null, varIds: r.var_ids || null, ordre: r.ordre, catalogue: r.catalogue_id ?? null });
const versLigne = a => ({ cat: a.cat, nom: a.nom, prix: a.prix, fourni: a.fourni || "", note: a.note || "", item_id: a.id || "",
  variantes: a.variantes?.length ? a.variantes : null, var_ids: a.varIds && Object.keys(a.varIds).length ? a.varIds : null, catalogue_id: a.catalogue ?? null, maj_le: new Date().toISOString() });

let CATALOGUE = [], ITEM = {}, catCharge = false, CATALOGUES = [];   // CATALOGUES : catalogues en plus du principal [{id, nom, zones}]
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
let REG = { intendants: [], secretaires: [], chatelleries: [], coffres: [] };
let ZAFF = [];   // intendant / secrétaire de chaque zone (admin)
try { const r = JSON.parse(localStorage.getItem("reglages_cache")); if (r && Array.isArray(r.intendants)) REG = r; } catch {}

let state = { intendantId: "", lieu: "", coffre: "", date: today(), orders: [], draft: null, onglets: [], onglet: "Principale" };
let hist = [];
try { const s = JSON.parse(localStorage.getItem("perm_state")); if (s && Array.isArray(s.orders)) state = Object.assign(state, s); } catch {}
const save = () => { try { localStorage.setItem("perm_state", JSON.stringify(state)); } catch {} };
/* ---------- Onglets de la permanence (ex. « Urgent Faillaise ») : on n'envoie que l'onglet affiché ---------- */
const PRINCIPAL = "Principale";
let ONGLETS_Z = [], ONG_CAT_Z = {};                         // zone : onglets créés (table brouillon_onglets) et leur catalogue
const catOnglet = n => ((estZone() ? ONG_CAT_Z : state.ongCat) || {})[n] ?? null;      // null = catalogue principal
const nomCatalogue = id => id == null ? "Principal" : (CATALOGUES.find(c => String(c.id) === String(id))?.nom || "?");
const ongletDe = o => o.onglet || PRINCIPAL;
const ordresOnglet = () => state.orders.filter(o => ongletDe(o) === state.onglet);
function listeOnglets() {
  const l = [PRINCIPAL, ...(estZone() ? ONGLETS_Z : state.onglets || []), ...state.orders.map(ongletDe)];
  return [...new Set(l)];
}
let editId = state.draft?.editId || null;
let restoring = false;

function statut(t) { $("dbStatus").textContent = t; }
let ROLE = null, PROFIL = null;
const estAdmin = () => ROLE === "admin";
const estSecretaire = () => ROLE === "secretaire";
const estZone = () => ROLE === "intendant" || ROLE === "secretaire";   // permanence partagée de la zone
const estFrappeur = () => estAdmin() || (ROLE === "intendant" && (PROFIL?.zones || []).map(Number).includes(1));   // frappe : admin + intendant zone 1
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
  const cg = estAdmin() ? await sb.from("catalogues").select("*").order("ordre").order("nom") : await sb.rpc("catalogues_visibles");
  CATALOGUES = cg.error ? [] : cg.data || [];
  majSelectsCatalogue(); if (typeof renderOnglets === "function" && !$("viewPerm").hidden) renderOnglets();
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
  const sec = await sb.from("secretaires").select("*").order("nom");
  REG = { intendants: i.data, secretaires: sec.error ? [] : sec.data, chatelleries: c.data, coffres: k.data };
  if (estAdmin()) { const z = await sb.rpc("zones_affectations"); ZAFF = z.error ? [] : z.data; }
  try { localStorage.setItem("reglages_cache", JSON.stringify(REG)); } catch {}
  majPermanence(); majFiltres();
  if (!$("viewReg").hidden) renderReg();
  if (!$("viewCpt").hidden && KJ) renderCompta();
}

// Les autres pages ouvertes se mettent à jour toutes seules
let tCat = null, tHist = null, tReg = null;
const majReg = () => { clearTimeout(tReg); tReg = setTimeout(chargerReglages, 400); };
function ecouter() { sb.channel("maj")
  .on("postgres_changes", { event: "*", schema: "public", table: "intendants" }, majReg)
  .on("postgres_changes", { event: "*", schema: "public", table: "chatelleries" }, majReg)
  .on("postgres_changes", { event: "*", schema: "public", table: "coffres" }, majReg)
  .on("postgres_changes", { event: "*", schema: "public", table: "secretaires" }, majReg)
  .on("postgres_changes", { event: "*", schema: "public", table: "articles" }, () => { clearTimeout(tCat); tCat = setTimeout(chargerCatalogue, 400); })
  .on("postgres_changes", { event: "*", schema: "public", table: "permanences" }, () => { clearTimeout(tHist); tHist = setTimeout(chargerHist, 400); })
  .on("postgres_changes", { event: "*", schema: "public", table: "profils" }, () => { if (estAdmin()) chargerComptes(); })
  .on("postgres_changes", { event: "*", schema: "public", table: "brouillon_commandes" }, majZone)
  .on("postgres_changes", { event: "*", schema: "public", table: "brouillons" }, majZone)
  .on("postgres_changes", { event: "*", schema: "public", table: "brouillon_onglets" }, majZone)
  .subscribe(); }
// Filet de sécurité : rechargement quand on revient sur l'onglet
document.addEventListener("visibilitychange", () => { if (!document.hidden && ROLE) { chargerZone(); if (!$("viewCtr").hidden) chargerSuivi(); if (!$("viewFrp").hidden) chargerFrappes(); if (!$("viewCpt").hidden) chargerCompta(); chargerCatalogue(); chargerHist(); chargerReglages(); if (estAdmin()) chargerComptes(); } });

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
  if (!estAdmin() && (t === "cat" || t === "reg" || t === "ctr" || t === "cpt")) t = "perm";
  if (t === "frp" && !(estFrappeur() || estZone())) t = "perm";
  const vues = { perm: "viewPerm", enc: "viewHist", hist: "viewHist", stock: "viewStock", frp: "viewFrp", aud: "viewAud", ctr: "viewCtr", cpt: "viewCpt", cat: "viewCat", reg: "viewReg" };
  ["viewPerm", "viewHist", "viewStock", "viewFrp", "viewAud", "viewCtr", "viewCpt", "viewCat", "viewReg"].forEach(v => $(v).hidden = v !== vues[t]);
  if (t === "ctr") { majLieuxContrats(); chargerCompagnies(); chargerSuivi(); }
  if (t === "stock") renderStock();
  if (t === "cpt") chargerCompta();
  if (t === "frp") chargerFrappes();
  if (t === "aud") ouvrirAudit();
  [["perm", "tabPerm"], ["enc", "tabEnc"], ["hist", "tabHist"], ["stock", "tabStock"], ["frp", "tabFrp"], ["aud", "tabAud"], ["ctr", "tabCtr"], ["cpt", "tabCpt"], ["cat", "tabCat"], ["reg", "tabReg"]].forEach(([k, b]) => $(b).classList.toggle("on", t === k));
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
$("tabCpt").onclick = () => showTab("cpt");
$("tabFrp").onclick = () => showTab("frp");
$("tabAud").onclick = () => showTab("aud");
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
  const [c, b, og] = await Promise.all([
    sb.from("brouillon_commandes").select("id, commande, cree_le, onglet").eq("zone_id", z).order("cree_le"),
    sb.from("brouillons").select("date").eq("zone_id", z).maybeSingle(),
    sb.from("brouillon_onglets").select("*").eq("zone_id", z).order("cree_le"),
  ]);
  if (z !== ZONE) return;
  if (c.error) return flash($("sendMsg"), "Permanence partagée indisponible : " + c.error.message + " (as-tu lancé 19_secretaires.sql ?)", false);
  state.orders = c.data.map(r => ({ ...r.commande, onglet: r.onglet || PRINCIPAL }));
  ONGLETS_Z = og.error ? [] : og.data.map(x => x.nom);
  ONG_CAT_Z = {}; if (!og.error) og.data.forEach(x => { if (x.catalogue_id != null) ONG_CAT_Z[x.nom] = x.catalogue_id; });
  if (!listeOnglets().includes(state.onglet)) state.onglet = PRINCIPAL;
  if (b.data?.date) { state.date = b.data.date; $("date").value = state.date; }
  if (editId && !state.orders.some(o => o.id === editId)) resetForm();     // supprimée par l'autre personne
  save(); render();
}
$("zone").onchange = () => {
  ZONE = Number($("zone").value); try { localStorage.setItem("zone", ZONE); } catch {}
  state.orders = []; ONGLETS_Z = []; state.onglet = PRINCIPAL; resetForm(); majPermanence(); chargerZone();
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
    // on cherche aussi dans les variantes (ex. « casque blancherive » → Casque léger, variante Blancherive)
    res = [];
    const catTab = catOnglet(state.onglet);
    CATALOGUE.forEach(a => {
      if ((a.catalogue ?? null) !== catTab) return;               // seulement le catalogue de l'onglet
      const t = sansAccent(a.nom + " " + a.cat);
      if (mots.every(m => t.includes(m))) { res.push({ a, v: "" }); return; }
      (a.variantes || []).forEach(v => { const tv = t + " " + sansAccent(v); if (mots.every(m => tv.includes(m))) res.push({ a, v }); });
    });
    idx = res.length ? 0 : -1;
    let cur = null, html = "";
    res.forEach(({ a, v }, i) => {
      if (a.cat !== cur) { html += `<div class="combo-cat">${esc(a.cat)}</div>`; cur = a.cat; }
      html += `<div class="combo-opt${i === idx ? " on" : ""}" data-i="${i}"><span>${esc(a.nom)}${v ? ` <span class="hint">— ${esc(v)}</span>` : ""}</span><span class="hint">${fmt(a.prix)}${a.variantes && !v ? " · " + a.variantes.length + " variantes" : ""}</span></div>`;
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
  function choisir({ a, v: variante }) {
    sel.value = a.k; sel.dataset.nom = a.nom;
    list.hidden = true; majTexte();
    sel.dispatchEvent(new Event("change"));
    const v = tr.querySelector(".var");
    if (variante && !v.hidden) { v.value = variante; calcForm(); }
    (v.hidden || variante ? tr.querySelector(".q") : v).focus();
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
  const edit = !!editId, ong = edit ? ongletDe(state.orders.find(x => x.id === editId) || {}) : state.onglet;
  if (estZone()) {
    if (ZONE == null) return flash($("formMsg"), "Aucune zone sur ton compte.", false);
    const maj = { commande: o, maj_le: new Date().toISOString(), maj_par: PROFIL?.nom || null };
    const { error } = edit ? await sb.from("brouillon_commandes").update(maj).eq("id", o.id)
                           : await sb.from("brouillon_commandes").insert({ id: o.id, zone_id: ZONE, onglet: ong, ...maj });
    if (error) return flash($("formMsg"), "Commande non enregistrée : " + error.message, false);
  }
  o.onglet = ong;
  if (edit) state.orders = state.orders.map(x => x.id === editId ? o : x);
  else state.orders.push(o);
  save();
  flash($("formMsg"), `Commande de ${client} ${edit ? "modifiée" : "ajoutée"}.`, true);
  resetForm(); render();
  $("client").focus();
};

/* ---------- Calculs ---------- */
const totalOrder = o => o.items.reduce((s, x) => s + infos(x).prix * x.qte, 0);
const actives = orders => orders.filter(o => !o.annuleLe);              // commandes non annulées
const totalPerm = orders => orders.reduce((s, o) => s + totalOrder(o), 0);
function agreger(orders) {
  const m = new Map();
  orders.forEach(o => o.items.forEach(x => {
    const k = cle(x) + "|" + (x.var || "");
    if (!m.has(k)) m.set(k, { cle: k, nom: lib(x), base: cle(x), var: x.var || "", qte: 0, cat: infos(x).cat, id: idOf(x) });
    m.get(k).qte += x.qte;
  }));
  const ordre = k => { const i = CATALOGUE.findIndex(a => a.k === k); return i < 0 ? 1e9 : i; };
  return [...m.values()].sort((a, b) => ordre(a.base) - ordre(b.base) || a.var.localeCompare(b.var, "fr", { numeric: true }));
}

/* ---------- Rendu (partagé avec l'historique) ---------- */
function htmlCommandes(orders, actions, permId) {
  return orders.map((o, i) => `<div class="order${permId ? (o.annuleLe ? " annulee" : o.payeLe ? " payee" : o.livreLe ? " livree" : "") : ""}">
    <div class="order-head"><b>${i + 1}. ${esc(o.client)}</b><span class="hint">${esc(o.type)}</span>
      <span class="total" style="font-size:.9rem">${fmt(totalOrder(o))}</span></div>
    <ul>${o.items.map((x, j) => { const a = infos(x); return `<li>${x.qte} × ${esc(lib(x))}${a.fourni ? ` <span class="hint">— fournit : ${esc(a.fourni)}${x.qte > 1 ? " (×" + x.qte + ")" : ""}</span>` : ""}${
      permId && !o.payeLe && !o.annuleLe ? ` <button type="button" class="k-ico ret-art" title="Retirer cet article (pas vendu)" data-ret-art="${esc(permId)}|${esc(o.id)}|${j}">−</button>` : ""}</li>`; }).join("")}${
      permId ? (o.retires || []).map((r, j) => `<li class="raye"><s>${r.qte} × ${esc(lib(r))}</s> <span class="hint">— retiré (pas vendu) par ${esc(r.retirePar || "?")} le ${new Date(r.retireLe).toLocaleDateString("fr-FR")}</span>${
        !o.payeLe && !o.annuleLe ? ` <button type="button" class="btn small" data-retab="${esc(permId)}|${esc(o.id)}|${j}">Rétablir</button>` : ""}</li>`).join("") : ""}</ul>
    ${o.notes ? `<div class="meta">📝 ${esc(o.notes)}</div>` : ""}
    ${permId ? (o.annuleLe
      ? `<div class="row etats" style="margin-top:8px"><span class="tag err">Annulée</span><span class="hint">le ${new Date(o.annuleLe).toLocaleString("fr-FR")}${o.annulePar ? " par " + esc(o.annulePar) : ""}</span>
         <button class="btn small" data-ann="0|${esc(permId)}|${esc(o.id)}" style="margin-left:auto">Rétablir</button></div>`
      : `<div class="row etats" style="margin-top:8px">
      <span class="hint">${o.livreLe ? "Livré le " + new Date(o.livreLe).toLocaleString("fr-FR") : "Pas encore livré"}</span>
      <label class="liv pay" title="${o.livreLe ? "Remis au client et encaissé (sort du stock)" : "La permanence doit d'abord être livrée"}"><input type="checkbox" data-etat="paye|${esc(permId)}|${esc(o.id)}" ${o.payeLe ? "checked" : ""} ${o.livreLe ? "" : "disabled"}> Payé</label>
      ${o.payeLe ? `<span class="hint">le ${new Date(o.payeLe).toLocaleString("fr-FR")}</span>` : `<button class="btn small" data-ann="1|${esc(permId)}|${esc(o.id)}" style="margin-left:auto">Annuler la commande</button>`}</div>`) : ""}
    ${actions ? `<div class="row" style="margin-top:8px"><button class="btn small" data-e="${o.id}">Modifier</button><button class="btn small" data-d="${o.id}">Supprimer</button>${listeOnglets().length > 1
      ? `<select class="mv-ong" data-mv="${o.id}"><option value="">Déplacer vers…</option>${listeOnglets().filter(n => n !== ongletDe(o)).map(n => `<option>${esc(n)}</option>`).join("")}</select>` : ""}</div>` : ""}
  </div>`).join("");
}
function htmlRecap(orders, coffre, p) {
  orders = actives(orders);
  const ag = agreger(orders), nb = ag.reduce((s, x) => s + x.qte, 0);
  const retirable = p && orders.some(o => !o.payeLe);
  const ret = new Map();                                     // articles retirés (pas vendus), barrés
  if (p) orders.forEach(o => (o.retires || []).forEach(r => { const k = cle(r) + "|" + (r.var || ""); const e = ret.get(k) || { nom: lib(r), cat: infos(r).cat, qte: 0 }; e.qte += r.qte; ret.set(k, e); }));
  const colVide = retirable ? "<td></td>" : "";
  return `<table><thead><tr><th style="text-align:right">Qté</th><th>Article</th><th>Catégorie</th>${retirable ? "<th></th>" : ""}</tr></thead><tbody>
    ${ag.map(x => `<tr><td class="n">${x.qte}</td><td>${esc(x.nom)}${ret.has(x.cle) ? ` <span class="hint">· <s>${ret.get(x.cle).qte}</s> retiré(s)</span>` : ""}</td><td class="hint">${esc(x.cat)}</td>${retirable
      ? `<td class="del">${orders.some(o => !o.payeLe && o.items.some(it => cle(it) + "|" + (it.var || "") === x.cle)) ? `<button type="button" class="k-ico ret-art" title="Retirer (pas vendu)" data-agg="${esc(p.id)}" data-cle="${esc(x.cle)}">−</button>` : ""}</td>` : ""}</tr>`).join("")}${[...ret].filter(([k]) => !ag.some(x => x.cle === k)).map(([, e]) => `<tr class="raye"><td class="n"><s>${e.qte}</s></td><td><s>${esc(e.nom)}</s> <span class="hint">retiré (pas vendu)</span></td><td class="hint">${esc(e.cat)}</td>${colVide}</tr>`).join("")}
    </tbody></table>
    <div class="row" style="margin-top:10px"><span class="hint">${orders.length} client(s) — ${nb} article(s) — coffre : ${esc(coffre)}</span>
    <span class="total">Encaissé : ${fmt(totalPerm(orders))}</span></div>${p ? htmlLivraison(p) : ""}`;
}
// Livré : toute la permanence d'un coup (admin) ; les autres voient l'état
function htmlLivraison(p) {
  const a = actives(p.orders), livre = a.length > 0 && a.every(o => o.livreLe), quand = livre ? a.map(o => o.livreLe).sort().pop() : null;
  const paye = a.some(o => o.payeLe);
  return `<div class="row livraison${livre ? " fait" : ""}">
    <label class="liv" title="${!estAdmin() ? "Coché par un administrateur quand il dépose tous les items dans le coffre" : livre && paye ? "Des commandes sont déjà payées : décoche d'abord leur « Payé »" : "Tous les items remis dans le coffre : l'intendant est pingé sur Discord"}">
      <input type="checkbox" data-livre="${esc(p.id)}" ${livre ? "checked" : ""} ${!estAdmin() || (livre && paye) || !a.length ? "disabled" : ""}> Livré${estAdmin() ? " (toute la permanence)" : ""}</label>
    <span class="hint">${livre ? "le " + new Date(quand).toLocaleString("fr-FR") : estAdmin() ? "Coche quand tu as tout déposé dans le coffre " + esc(p.coffre || "") : "En attente de livraison par l'administration"}</span></div>`;
}

function render() {
  renderOnglets();
  const liste = ordresOnglet();
  $("nbOrders").textContent = liste.length;
  $("ongletNom").textContent = listeOnglets().length > 1 ? "— " + state.onglet : "";
  const box = $("orders");
  box.innerHTML = liste.length ? htmlCommandes(liste, true) : '<p class="empty">Aucune commande dans cet onglet pour l\'instant.</p>';
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
  box.querySelectorAll("[data-mv]").forEach(sel => sel.onchange = () => deplacerCommande(sel.dataset.mv, sel.value));
  $("recap").innerHTML = liste.length ? htmlRecap(liste, state.coffre || "—") : '<p class="empty">Le récapitulatif apparaîtra ici.</p>';
}
function renderOnglets() {
  const l = listeOnglets(), nb = n => state.orders.filter(o => ongletDe(o) === n).length;
  $("permOnglets").innerHTML = l.map(n => `<button type="button" class="ong${n === state.onglet ? " on" : ""}" data-ong="${esc(n)}" title="Catalogue : ${esc(nomCatalogue(catOnglet(n)))}">${catOnglet(n) != null ? "📖 " : ""}${esc(n)} <span class="badge">${nb(n)}</span></button>`).join("")
    + `<button type="button" class="ong ong-add" id="ongAdd" title="Créer un onglet (ex. commande urgente d'une châtellerie)">+ Onglet</button>`
    + (state.onglet !== PRINCIPAL ? `<button type="button" class="ong ong-del" id="ongDel" title="Supprimer cet onglet (ses commandes reviennent dans « ${PRINCIPAL} »)">Supprimer l'onglet</button>` : "");
  $("permOnglets").querySelectorAll("[data-ong]").forEach(b => b.onclick = () => {
    if (b.dataset.ong === state.onglet) return;
    state.onglet = b.dataset.ong; save(); if (editId) resetForm(); render();
  });
  $("ongAdd").onclick = creerOnglet;
  if ($("ongDel")) $("ongDel").onclick = supprimerOnglet;
}
function creerOnglet() {
  if (!CATALOGUES.length) { const nom = (prompt("Nom du nouvel onglet (ex. Urgent Faillaise) :") || "").trim().slice(0, 40); if (nom) creerOngletAvec(nom, null); return; }
  if ($("ongForm")) { $("ongForm").remove(); return; }
  $("permOnglets").insertAdjacentHTML("afterend", `<div class="ong-form" id="ongForm">
    <div><label>Catalogue</label><select id="ongCat"><option value="">Principal</option>${CATALOGUES.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("")}</select></div>
    <div><label>Nom de l'onglet</label><input id="ongNom" placeholder="ex. Urgent Faillaise" maxlength="40"></div>
    <div class="row"><button type="button" class="btn primary small" id="ongOk">Créer</button><button type="button" class="btn small" id="ongNon">Annuler</button></div></div>`);
  $("ongCat").onchange = () => { const c = CATALOGUES.find(x => String(x.id) === $("ongCat").value); if (c && !$("ongNom").value.trim()) $("ongNom").value = c.nom; };
  $("ongNon").onclick = () => $("ongForm").remove();
  $("ongOk").onclick = () => { const nom = ($("ongNom").value.trim() || nomCatalogue($("ongCat").value || null)).slice(0, 40), cat = $("ongCat").value ? Number($("ongCat").value) : null;
    $("ongForm").remove(); creerOngletAvec(nom, cat); };
  $("ongNom").focus();
}
async function creerOngletAvec(nom, cat) {
  if (!nom) return;
  if (listeOnglets().some(n => n.toLowerCase() === nom.toLowerCase())) return flash($("sendMsg"), `L'onglet « ${nom} » existe déjà.`, false);
  if (estZone()) {
    const { error } = await sb.from("brouillon_onglets").insert(cat != null ? { zone_id: ZONE, nom, catalogue_id: cat } : { zone_id: ZONE, nom });
    if (error) return flash($("sendMsg"), "Onglet non créé : " + error.message + (/catalogue_id/.test(error.message) ? " (as-tu lancé 46_catalogues.sql ?)" : /brouillon_onglets/.test(error.message) ? " (as-tu lancé 36_onglets_permanence.sql ?)" : ""), false);
    ONGLETS_Z.push(nom); if (cat != null) ONG_CAT_Z[nom] = cat;
  } else { state.onglets = [...(state.onglets || []), nom]; if (cat != null) state.ongCat = { ...(state.ongCat || {}), [nom]: cat }; }
  state.onglet = nom; save(); if (editId) resetForm(); render();
}
async function supprimerOnglet() {
  const nom = state.onglet, n = ordresOnglet().length;
  if (nom === PRINCIPAL) return;
  if (!await confirmer(`Supprimer l'onglet « ${nom} » ?${n ? ` Ses ${n} commande(s) reviennent dans « ${PRINCIPAL} ».` : ""}`)) return;
  if (estZone()) {
    if (n) { const { error } = await sb.from("brouillon_commandes").update({ onglet: PRINCIPAL }).eq("zone_id", ZONE).eq("onglet", nom); if (error) return flash($("sendMsg"), "Impossible : " + error.message, false); }
    const { error } = await sb.from("brouillon_onglets").delete().eq("zone_id", ZONE).eq("nom", nom);
    if (error) return flash($("sendMsg"), "Impossible : " + error.message, false);
    ONGLETS_Z = ONGLETS_Z.filter(x => x !== nom);
  } else state.onglets = (state.onglets || []).filter(x => x !== nom);
  state.orders.forEach(o => { if (ongletDe(o) === nom) o.onglet = PRINCIPAL; });
  state.onglet = PRINCIPAL; save(); render();
}
async function deplacerCommande(id, vers) {
  const o = state.orders.find(x => x.id === id); if (!o || !vers) return;
  if (estZone()) {
    const { error } = await sb.from("brouillon_commandes").update({ onglet: vers }).eq("id", id);
    if (error) { render(); return flash($("sendMsg"), "Déplacement impossible : " + error.message, false); }
  }
  o.onglet = vers; if (editId === id) resetForm(); save(); render();
  flash($("sendMsg"), `Commande de ${o.client} déplacée dans « ${vers} ».`, true);
}

/* ---------- Transmission (la base poste le message Discord) ---------- */
function recapTexte(p) {
  return `📦 **Commande à l'administration — Permanence ${p.lieu} — ${dateFR(p.date)}** (${p.intendant})
À déposer dans : **${p.coffre}**

${agreger(actives(p.orders)).map(x => `• ${x.qte} × ${x.nom}` + (estAdmin() ? ` — ID : ${x.id || "⚠ manquant"}` : "")).join("\n")}

Clients : ${actives(p.orders).map(o => o.client).join(", ")}
Encaissé : ${fmt(totalPerm(actives(p.orders)))}`;
}

function snapshot() {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), intendant: estZone() ? $("intendant").selectedOptions[0]?.text || "" : intendantCourant()?.nom || "", coffre: state.coffre, lieu: state.lieu, date: state.date,
           orders: JSON.parse(JSON.stringify(ordresOnglet().map(({ onglet, ...o }) => o))), clotureLe: new Date().toISOString(), discord: false };
}
// Les ID de give ne partent jamais du navigateur : la base les retrouve dans le catalogue
const sansIds = orders => orders.map(o => Object.assign({}, o, { items: o.items.map(({ id, ...x }) => x) }));

$("send").onclick = async () => {
  const nOng = ordresOnglet().length, dansOng = listeOnglets().length > 1 ? ` de l'onglet « ${state.onglet} »` : "";
  if (!nOng) return flash($("sendMsg"), "Aucune commande dans cet onglet.", false);
  if (!state.date) return flash($("sendMsg"), "Renseigne la date.", false);
  if (estSecretaire()) return;
  if (estZone()) {
    if (!state.lieu || !state.coffre) return flash($("sendMsg"), `La châtellerie ou le coffre de la zone ${ZONE} n'est pas réglé : demande à un administrateur (Réglages).`, false);
    if (!await confirmer(`Commander aux administrateurs impériaux les ${nOng} commande(s)${dansOng} (zone ${ZONE}) ?${dansOng ? " Les autres onglets restent dans la permanence." : ""}`)) return;
    $("send").disabled = true;
    const envoye = state.onglet;
    const { data, error } = await sb.rpc("cloturer_zone", { zone: ZONE, date_: state.date, onglet_: envoye });
    $("send").disabled = false;
    if (error) return flash($("sendMsg"), "Impossible de clôturer (" + error.message + "). Rien n'a été envoyé ni effacé, réessaie.", false);
    editId = null; state.draft = null; resetForm();
    if (envoye !== PRINCIPAL) { ONGLETS_Z = ONGLETS_Z.filter(x => x !== envoye); state.onglet = PRINCIPAL; }
    await chargerZone(); chargerHist();
    if (data.discord) flash($("sendMsg"), "Commande transmise aux administrateurs impériaux ✔ Elle est maintenant dans « Commandes en cours ».", true);
    else flash($("sendMsg"), `Permanence clôturée et archivée, mais pas transmise sur Discord (${data.erreur}). Tu pourras la renvoyer depuis l'onglet Commandes en cours.`, false);
    return;
  }
  if (!intendantCourant()) return flash($("sendMsg"), "Choisis l'intendant (à créer dans Réglages s'il n'existe pas).", false);
  if (!state.lieu) return flash($("sendMsg"), "Choisis la châtellerie (à créer dans Réglages).", false);
  if (!state.coffre) return flash($("sendMsg"), "Choisis le coffre (à créer dans Réglages).", false);
  if (!await confirmer(`Commander aux administrateurs impériaux les ${nOng} commande(s)${dansOng} ?`)) return;

  const p = snapshot();
  $("send").disabled = true;
  const { data, error } = await sb.rpc("cloturer_permanence", { p: { id: p.id, intendant: p.intendant, coffre: p.coffre, lieu: p.lieu, date: p.date, orders: sansIds(p.orders) } });
  $("send").disabled = false;
  if (error) return flash($("sendMsg"), "Impossible de clôturer (" + error.message + "). Rien n'a été envoyé ni effacé, réessaie.", false);
  // archivée : on vide la permanence
  const envoye = state.onglet;
  state.orders = state.orders.filter(o => ongletDe(o) !== envoye); editId = null; state.draft = null;
  if (envoye !== PRINCIPAL) { state.onglets = (state.onglets || []).filter(x => x !== envoye); state.onglet = PRINCIPAL; }
  save(); resetForm(); render(); chargerHist();
  if (data.discord) flash($("sendMsg"), "Commande transmise aux administrateurs impériaux ✔ Elle est maintenant dans « Commandes en cours ».", true);
  else flash($("sendMsg"), `Permanence clôturée et archivée, mais pas transmise sur Discord (${data.erreur}). Tu pourras la renvoyer depuis l'onglet Commandes en cours.`, false);
};

async function copier(txt, el) {
  try { await navigator.clipboard.writeText(txt); flash(el, "Récap copié.", true); }
  catch { flash(el, "Copie impossible sur ce navigateur.", false); }
}
$("copy").onclick = () => {
  if (!ordresOnglet().length) return flash($("sendMsg"), "Aucune commande dans cet onglet.", false);
  copier(recapTexte(snapshot()), $("sendMsg"));
};

$("reset").onclick = async () => {
  const n = ordresOnglet().length, ong = state.onglet;
  if (!n && !$("client").value && !lignesForm().length) return;
  if (!await confirmer(`Effacer les ${n} commande(s) de l'onglet « ${ong} »${estZone() ? ` (pour toi et ta zone ${ZONE})` : ""} sans rien envoyer ?`)) return;
  if (estZone() && n) {
    const { error } = await sb.from("brouillon_commandes").delete().eq("zone_id", ZONE).eq("onglet", ong);
    if (error) return flash($("sendMsg"), "Impossible de vider : " + error.message, false);
  }
  state.orders = state.orders.filter(o => ongletDe(o) !== ong); state.draft = null; editId = null; save(); resetForm(); render();
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

const toutPaye = p => p.orders.length > 0 && actives(p.orders).every(o => o.payeLe);
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
    const a = actives(p.orders), nbAnn = p.orders.length - a.length;
    const nb = a.reduce((s, o) => s + o.items.reduce((t, x) => t + x.qte, 0), 0);
    const livre = a.length > 0 && a.every(o => o.livreLe), pay = a.filter(o => o.payeLe).length, n = a.length;
    const fini = pay === n, etat = fini ? "done" : livre ? "partiel" : "pending";
    return `<details class="perm ${etat}" data-id="${esc(p.id)}" ${ouverts.has(p.id) ? "open" : ""}>
      <summary><b>${esc(p.lieu)} — ${dateFR(p.date)}</b><span class="hint">${esc(p.intendant)} · ${n} client(s) · ${nb} article(s)${nbAnn ? ` · ${nbAnn} annulée(s)` : ""}</span>
        ${p.discord ? '<span class="tag ok">Transmise</span>' : '<span class="tag err">Non transmise</span>'}
        ${fini ? '<span class="tag ok">✔ Tout payé</span>' : `<span class="tag ${livre ? "orange" : ""}">${livre ? "Livré" : "À livrer"}</span><span class="tag ${pay ? "ok" : ""}">Payé ${pay}/${n}</span>`}
        <span class="total" style="font-size:.9rem">${fmt(totalPerm(a))}</span></summary>
      <div class="body">
        <div class="hint">Clôturée le ${new Date(p.clotureLe).toLocaleString("fr-FR")}${p.cloturePar ? " par " + esc(p.cloturePar) : ""}${p.discord && p.envoyeLe ? " — transmise le " + new Date(p.envoyeLe).toLocaleString("fr-FR") : ""}</div>
        <h3>Commandé à l'administration</h3>${htmlRecap(p.orders, p.coffre, p)}
        <h3>Commandes détaillées</h3>${htmlCommandes(p.orders, false, p.id)}
        <div class="row" style="margin-top:8px">${p.discord || estSecretaire() ? "" : `<button class="btn small primary" data-hs="${esc(p.id)}">Transmettre aux administrateurs</button>`}<button class="btn small" data-hc="${esc(p.id)}">Copier le récap</button>${estAdmin() ? `<button class="btn small" data-hd="${esc(p.id)}">Supprimer</button>` : ""}</div>
        <div class="msg" id="hm-${esc(p.id)}"></div>
      </div></details>`;
  }).join("");
  box.querySelectorAll("[data-etat]").forEach(c => c.onchange = () => changerEtat(c));
  box.querySelectorAll("[data-livre]").forEach(c => c.onchange = () => livrerPermanence(c));
  box.querySelectorAll("[data-ann]").forEach(b => b.onclick = () => annulerCommande(b));
  box.querySelectorAll("[data-ret-art]").forEach(b => b.onclick = () => retirerArticle(b));
  box.querySelectorAll("[data-agg]").forEach(b => b.onclick = () => panneauRetrait(b));
  box.querySelectorAll("[data-retab]").forEach(b => b.onclick = () => retablirArticle(b));
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
  const ctgF = $("cCatalogue").value ? Number($("cCatalogue").value) : null;
  if (CATALOGUE.some(x => x.cat === cat && x.nom === nom && x.k !== catEdit && (x.catalogue ?? null) === ctgF)) return flash($("cMsg"), `« ${nom} » existe déjà dans cette catégorie de ce catalogue.`, false);
  const a = { cat, nom, fourni: $("cFourni").value.trim(), prix: Math.round(prix), note: $("cNote").value.trim(), id: $("cId").value.trim(), catalogue: $("cCatalogue").value ? Number($("cCatalogue").value) : null };
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
  const fCtg = $("cFiltreCatalogue").value;
  const list = CATALOGUE.filter(a => (fCtg === "" || (fCtg === "0" ? a.catalogue == null : String(a.catalogue) === fCtg)) && (!q || (a.nom + " " + a.cat + " " + (a.fourni || "") + " " + (a.id || "") + " " + Object.values(a.varIds || {}).join(" ")).toLowerCase().includes(q))
    && (!seulSansId || manqueId(a)));
  if (!list.length) { $("catTable").innerHTML = `<p class="empty">${CATALOGUE.length ? "Aucun article." : "Chargement du catalogue…"}</p>`; return; }
  let cur = null, rows = "";
  list.forEach(a => {
    const tete = (fCtg === "" && a.catalogue != null ? "📖 " + nomCatalogue(a.catalogue) + " — " : "") + a.cat;
    if (tete !== cur) { rows += `<tr class="cat-head"><td colspan="5">${esc(tete)}</td></tr>`; cur = tete; }
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
    $("cCat").value = a.cat; $("cNom").value = a.nom; $("cPrix").value = a.prix; $("cCatalogue").value = a.catalogue ?? "";
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
  const liste = (fonction, z, choisi) => {
    const fiches = fonction === "intendant" ? REG.intendants : REG.secretaires;
    return `<select data-aff="${fonction}|${z}"><option value="">— aucun${fonction === "secretaire" ? "e" : ""} —</option>${
      fiches.map(f => `<option value="${f.id}" ${String(f.id) === String(choisi ?? "") ? "selected" : ""}>${esc(f.nom)}</option>`).join("")}</select>`;
  };
  $("regZones").innerHTML = `<table class="zones"><thead><tr><th>Zone</th><th>Coffre</th><th>Intendant</th><th>Secrétaire</th></tr></thead><tbody>${
    [1, 2, 3, 4, 5, 6, 7].map(z => {
      const k = REG.coffres.filter(c => c.zone_id === z), a = ZAFF.find(x => x.zone === z) || {};
      return `<tr><td><b>Zone ${z}</b></td>
        <td><input data-zone-nom="coffres|${z}|${k[0]?.id ?? ""}" value="${esc(k[0]?.nom || "")}" placeholder="Nom du coffre">${k.length > 1 ? `<span class="hint">+ ${k.slice(1).map(x => esc(x.nom)).join(", ")}</span>` : ""}</td>
        <td>${liste("intendant", z, a.intendant_id)}</td>
        <td>${liste("secretaire", z, a.secretaire_id)}</td></tr>`;
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
  $("regZones").querySelectorAll("[data-aff]").forEach(sel => sel.onchange = async () => {
    const [fonction, z] = sel.dataset.aff.split("|"), lib = fonction === "intendant" ? "Intendant" : "Secrétaire";
    const { error } = await sb.rpc("affecter_zone", { zone: Number(z), fonction, fiche: sel.value ? Number(sel.value) : null });
    if (error) flash($("zonesMsg"), "Non enregistré : " + error.message + (/affecter_zone/.test(error.message) ? " (as-tu lancé 22_zones_affectation.sql ?)" : ""), false);
    else flash($("zonesMsg"), `Zone ${z} : ${lib.toLowerCase()} ${sel.value ? "« " + sel.selectedOptions[0].text + " »" : "retiré(e)"}.`, true);
    await chargerReglages(); if (estAdmin()) chargerComptes();
  });
}

/* ---------- Réglages : intendants ---------- */
const TABLES = {
  intendants:   { nom: "intendant",   liste: "regInt",  champ: "rInt",  msg: "rIntMsg" },
  secretaires:  { nom: "secrétaire",  liste: "regSec",  champ: "rSec",  msg: "rSecMsg" },
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
      if (table === "intendants" || table === "secretaires") {
        const champ = table === "intendants" ? "intendant_id" : "secretaire_id";
        const zs = ZAFF.filter(z => String(z[champ]) === String(r.id)).map(z => z.zone);
        const compte = COMPTES.some(c => String(c[champ]) === String(r.id));
        info = `<span class="hint">${zs.length ? "Zone " + zs.join(", ") : "aucune zone"}${compte ? "" : " · ne s'est pas encore connecté(e)"}</span>`;
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
    if (!await confirmer(`Supprimer ${t.nom === "intendant" ? "l'intendant" : "la secrétaire"} « ${r.nom} » ? ${t.nom === "intendant" ? "Il" : "Elle"} sera retiré(e) de sa zone. L'historique n'est pas modifié.`)) return;
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

async function livrerPermanence(c) {
  const p = hist.find(x => x.id === c.dataset.livre); if (!p) return;
  const val = c.checked;
  if (!await confirmer(val ? `Marquer toute la permanence ${p.lieu} du ${dateFR(p.date)} comme livrée ? L'intendant sera pingé sur Discord.` : `Annuler la livraison de la permanence ${p.lieu} du ${dateFR(p.date)} ?`)) { c.checked = !val; return; }
  c.disabled = true;
  const { data, error } = await sb.rpc("livrer_permanence", { pid: p.id, livre: val });
  if (error) { c.checked = !val; c.disabled = false; return flash($("histMsg"), "Non enregistré : " + error.message + (/livrer_permanence/.test(error.message) ? " (as-tu lancé 32_livraison_annulation.sql ?)" : ""), false); }
  p.orders = data; renderHist(); renderStock();
  flash($("histMsg"), val ? `Permanence ${p.lieu} du ${dateFR(p.date)} livrée ✔` : "Livraison annulée.", true);
}
// Retirer un article pas vendu (ou une partie de la quantité) : total, stock et compta suivent
async function retirerArticle(b) {
  const [pid, oid, j] = b.dataset.retArt.split("|"), p = hist.find(x => x.id === pid), o = p?.orders.find(x => x.id === oid), x = o?.items[+j];
  if (!x) return;
  let q = x.qte;
  if (x.qte > 1) {
    const r = prompt(`Combien de « ${lib(x)} » retirer de la commande de ${o.client} ? (1 à ${x.qte})`, String(x.qte));
    if (r === null) return;
    q = parseInt(r, 10);
    if (!(q >= 1 && q <= x.qte)) return flash($("histMsg"), `Quantité invalide : entre 1 et ${x.qte}.`, false);
  } else if (!await confirmer(`Retirer « ${lib(x)} » de la commande de ${o.client} ?`)) return;
  b.disabled = true;
  const { data, error } = await sb.rpc("retirer_article", { pid, oid, idx: +j, qte_: q });
  if (error) { b.disabled = false; return flash($("histMsg"), "Non retiré : " + error.message + (/retirer_article/.test(error.message) ? " (as-tu lancé 37_retirer_article.sql ?)" : ""), false); }
  p.orders = data; renderHist(); renderStock();
  flash($("histMsg"), `${q} × ${lib(x)} retiré(s) de la commande de ${o.client}.`, true);
}
// Depuis « Commandé à l'administration » : choisir chez quel(s) client(s) retirer l'article
function panneauRetrait(b) {
  const tr = b.closest("tr"), suiv = tr.nextElementSibling;
  if (suiv?.classList.contains("agg-pan")) { suiv.remove(); return; }
  tr.parentElement.querySelectorAll(".agg-pan").forEach(x => x.remove());
  const p = hist.find(x => x.id === b.dataset.agg), cleA = b.dataset.cle;
  const cand = [];
  actives(p.orders).filter(o => !o.payeLe).forEach(o => o.items.forEach((it, j) => { if (cle(it) + "|" + (it.var || "") === cleA) cand.push({ o, it, j }); }));
  if (!cand.length) return;
  const pan = document.createElement("tr"); pan.className = "agg-pan";
  pan.innerHTML = `<td colspan="${tr.children.length}"><div class="agg-box"><b>Retirer « ${esc(lib(cand[0].it))} » (pas vendu) :</b>${cand.map((c, n) => `
    <div class="agg-l"><span>${esc(c.o.client)} <span class="hint">· ${c.it.qte} commandé(s)</span></span>
      <input type="number" min="1" max="${c.it.qte}" value="${c.it.qte}" data-n="${n}">
      <button type="button" class="btn small" data-n="${n}">Retirer</button></div>`).join("")}</div></td>`;
  tr.after(pan);
  pan.querySelectorAll("button[data-n]").forEach(btn => btn.onclick = async () => {
    const c = cand[+btn.dataset.n], q = parseInt(pan.querySelector(`input[data-n="${btn.dataset.n}"]`).value, 10);
    if (!(q >= 1 && q <= c.it.qte)) return flash($("histMsg"), `Quantité invalide : entre 1 et ${c.it.qte}.`, false);
    btn.disabled = true;
    const { data, error } = await sb.rpc("retirer_article", { pid: p.id, oid: c.o.id, idx: c.j, qte_: q });
    if (error) { btn.disabled = false; return flash($("histMsg"), "Non retiré : " + error.message + (/retirer_article/.test(error.message) ? " (as-tu lancé 37_retirer_article.sql ?)" : ""), false); }
    p.orders = data; renderHist(); renderStock();
    flash($("histMsg"), `${q} × ${lib(c.it)} retiré(s) de la commande de ${c.o.client}.`, true);
  });
}
async function retablirArticle(b) {
  const [pid, oid, j] = b.dataset.retab.split("|"), p = hist.find(x => x.id === pid), o = p?.orders.find(x => x.id === oid), r = o?.retires?.[+j];
  if (!r) return;
  b.disabled = true;
  const { data, error } = await sb.rpc("retablir_article", { pid, oid, ridx: +j });
  if (error) { b.disabled = false; return flash($("histMsg"), "Non rétabli : " + error.message, false); }
  p.orders = data; renderHist(); renderStock();
  flash($("histMsg"), `${r.qte} × ${lib(r)} remis dans la commande de ${o.client}.`, true);
}
async function annulerCommande(b) {
  const [v, pid, oid] = b.dataset.ann.split("|"), annuler = v === "1";
  const p = hist.find(x => x.id === pid), o = p?.orders.find(x => x.id === oid); if (!o) return;
  if (!await confirmer(annuler
    ? `Annuler la commande de ${o.client} (${fmt(totalOrder(o))}) ? Elle sort des totaux, du stock et de la compta${p.discord ? ", et les administrateurs sont prévenus sur Discord" : ""}.`
    : `Rétablir la commande de ${o.client} ?`)) return;
  b.disabled = true;
  const { data, error } = await sb.rpc("annuler_commande", { pid, oid, annuler });
  if (error) { b.disabled = false; return flash($("histMsg"), "Non enregistré : " + error.message + (/annuler_commande/.test(error.message) ? " (as-tu lancé 32_livraison_annulation.sql ?)" : ""), false); }
  const avant = toutPaye(p);
  p.orders = data; renderHist(); renderStock();
  flash($("histMsg"), (annuler ? `Commande de ${o.client} annulée.` : `Commande de ${o.client} rétablie.`)
    + (avant !== toutPaye(p) ? (avant ? " La permanence revient dans les commandes en cours." : " Tout le reste est payé : la permanence passe dans l'historique.") : ""), true);
}

/* ---------- Stock : livré par l'administration, pas encore payé par le client ---------- */
function renderStock() {
  if ($("viewStock").hidden) return;
  const fi = $("sInt").value, fl = $("sLieu").value;
  const fc = sansAccent($("sClient").value.trim()), fa = sansAccent($("sItem").value.trim());
  const lignes = [];
  hist.forEach(p => p.orders.forEach(o => {
    if (!o.livreLe || o.payeLe || o.annuleLe) return;
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
  if (k?.images === "genere") return parchemin(k.nom, k.contrats[c.taille] || { prix: c.prix, lignes: c.lignes || [] });
  if (!k && String(c.slug).startsWith("gen-")) return parchemin(c.nom || "Contrat", { prix: c.prix, lignes: c.lignes || [] });
  const surSite = k ? k.images === "site" : SLUGS_SITE.includes(c.slug);
  return surSite ? `contrats/${c.slug}-${c.taille}.jpg`
    : `${SUPABASE_URL}/storage/v1/object/public/contrats/modeles/${c.slug}-${c.taille}.jpg` + (k ? "?v=" + Date.parse(k.maj_le) : "");
};
const SCEAUX_V = "3";                              // à augmenter quand on remplace les images de sceaux/
const imgSceau = v => `sceaux/${SCEAUX[cleVille(v)]}.png?v=${SCEAUX_V}`;
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
  // une compagnie différente par contrat, tirée au hasard ; les contrats construits pour une ville ne sortent que pour elle
  const ville = $("ctrLieu").value, melange = COMPAGNIES.filter(c => c.actif && (!c.ville || cleVille(c.ville) === cleVille(ville)));
  if (melange.length < TIRAGE.length) { flash($("ctrMsg"), `Il faut au moins ${TIRAGE.length} compagnies actives pour ${ville} (Réglages) : il y en a ${melange.length}.`, false); return false; }
  for (let i = melange.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [melange[i], melange[j]] = [melange[j], melange[i]]; }
  tirage = { lieu: ville, contrats: TIRAGE.map((taille, i) => {
    const c = melange[i];
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
  const h = Math.min(1600, Math.max(...imgs.map(i => i.naturalHeight))), ecart = 12, marge = 12;   // pleine résolution (sceaux nets)
  const largeurs = imgs.map(i => Math.round(i.naturalWidth * h / i.naturalHeight));
  const cv = document.createElement("canvas");
  cv.width = largeurs.reduce((s, w) => s + w, 0) + ecart * (imgs.length - 1) + marge * 2;
  cv.height = h + marge * 2;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
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
  return new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.92));
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
      contrats: tirage.contrats.map(({ slug, taille, nom, prix, lignes }) => ({ slug, taille, nom, prix, lignes: lignes || [] })),   // lignes : ressources perçues (compta)
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
      <td><b>${esc(c.nom)}</b>${c.images === "genere" ? ` <span class="tag">construit · ${esc(c.ville || "")}</span>` : ""}<br><span class="hint">${TAILLES.map(t => fmt(c.contrats?.[t]?.prix)).join(" · ")}${c.actif ? "" : " — désactivée"}</span></td>
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
  $("tabCat").hidden = $("tabReg").hidden = $("tabCtr").hidden = $("tabCpt").hidden = !estAdmin();
  $("tabFrp").hidden = !(estFrappeur() || estZone());
  $("tabAud").hidden = !(estAdmin() || estZone());
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

/* ---------- Compta des coffres (admin) : entrées / sorties, soldes, inventaire, frappe, stats, loyers ---------- */
var KJ = null, KJR = [], KLOY = [];   // KJR : mouvements retirés de la compta
            // journal complet (rpc compta_journal) et loyers actuels
const ZONES_K = [1, 2, 3, 4, 5, 6, 7];
const TYPES_K = { commande: "Commande", contrat: "Contrat", loyer: "Loyer", frappe: "Frappe", manuel: "Manuel" };
const septimsSigne = n => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
const septimsNeg = n => (n < 0 ? "−" : "") + fmt(Math.abs(n));
const cleObjet = n => sansAccent(n).replace(/s\b/g, "").replace(/\s+/g, " ").trim();   // « Lingots d'or » = « lingot d'or »
function nomZone(z, court) {
  if (z == null) return "Sans zone";
  const k = REG.coffres.find(c => c.zone_id === z), a = ZAFF.find(x => x.zone === z) || {};
  const i = REG.intendants.find(x => String(x.id) === String(a.intendant_id ?? ""));
  return court ? `Zone ${z}` : `Zone ${z}${k ? " · " + k.nom : ""}${i ? " · " + i.nom : ""}`;
}
const lundiDe = d => { const l = new Date(d.getFullYear(), d.getMonth(), d.getDate()); l.setDate(l.getDate() - ((l.getDay() + 6) % 7)); return l; };
// période choisie -> [début, fin[ en dates locales (null = sans limite)
function periodeK() {
  const v = $("kPer").value, d = new Date();
  $("kDuWrap").hidden = $("kAuWrap").hidden = v !== "perso";
  if (v === "semaine") return [lundiDe(d), null, "cette semaine"];
  if (v === "mois") return [new Date(d.getFullYear(), d.getMonth(), 1), null, "ce mois-ci"];
  if (v === "moisPrec") { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); return [a, new Date(d.getFullYear(), d.getMonth(), 1), a.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })]; }
  if (v === "perso") {
    const du = $("kDu").value ? new Date($("kDu").value + "T00:00") : null;
    const au = $("kAu").value ? new Date($("kAu").value + "T00:00") : null; if (au) au.setDate(au.getDate() + 1);
    return [du, au, `du ${du ? du.toLocaleDateString("fr-FR") : "début"} au ${$("kAu").value ? new Date($("kAu").value + "T00:00").toLocaleDateString("fr-FR") : "aujourd'hui"}`];
  }
  return [null, null, "depuis le début"];
}
// inventaire : somme des objets (nom affiché = la 1re écriture rencontrée)
function inventaire(lignes) {
  const m = new Map();
  lignes.forEach(r => (r.ressources || []).forEach(x => {
    const k = cleObjet(x.nom), e = m.get(k) || { nom: x.nom, q: 0 }; e.q += Number(x.qte) || 0; m.set(k, e);
  }));
  return [...m.values()].filter(e => e.q !== 0).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}
// septims frappés par une zone sur la semaine en cours
function frappeSemaine(z) {
  const l = lundiDe(new Date());
  return (KJ || []).filter(r => r.type === "frappe" && r.zone_id === z && r.t >= l).reduce((s, r) => s - r.montant, 0);
}
async function chargerCompta() {
  if (!estAdmin()) return;
  if ($("kZone").options.length === 1) ZONES_K.forEach(z => ["kZone", "mZone"].forEach(id => $(id).add(new Option("Zone " + z, z))));
  if (!$("mObjets").children.length) ajouterObjet();
  const [j, l] = await Promise.all([sb.rpc("compta_journal"), sb.rpc("loyers_actuels")]);
  if (j.error || l.error) {
    const m = (j.error || l.error).message;
    return flash($("kMsg"), "Compta non chargée : " + m + (/compta_journal|loyers_actuels|function/i.test(m) ? " (as-tu lancé 29_compta.sql et 30_compta_frappe.sql ?)" : ""), false);
  }
  const tout = (j.data || []).map(r => ({ ...r, montant: Number(r.montant) || 0, t: new Date(r.le) })).sort((a, b) => b.t - a.t);
  KJ = tout.filter(r => !r.retire); KJR = tout.filter(r => r.retire);
  KLOY = l.data || [];
  renderCompta();
}
function renderCompta() {
  if (!KJ) return;
  const [du, au, libPer] = periodeK(), zf = $("kZone").value ? Number($("kZone").value) : null;
  const per = KJ.filter(r => (!du || r.t >= du) && (!au || r.t < au));
  const zonesVues = [...ZONES_K, ...(KJ.some(r => r.zone_id == null) ? [null] : [])].filter(z => zf == null || z === zf);

  // 1. Coffres : solde et inventaire (tout l'historique), entrées / sorties (période), frappe de la semaine
  $("kCoffres").innerHTML = zonesVues.map(z => {
    const tout = KJ.filter(r => r.zone_id === z), p = per.filter(r => r.zone_id === z);
    const solde = tout.reduce((s, r) => s + r.montant, 0);
    const ent = p.filter(r => r.montant > 0).reduce((s, r) => s + r.montant, 0), sor = p.filter(r => r.montant < 0).reduce((s, r) => s - r.montant, 0);
    const inv = inventaire(tout), loy = KLOY.find(x => x.zone_id === z);
    return `<div class="k-coffre"><div class="k-z">${esc(nomZone(z))}</div>
      <div class="k-solde${solde < 0 ? " neg" : ""}">${septimsNeg(solde)}</div>
      <div class="k-es"><span class="pos">▲ ${fmt(ent)}</span><span class="neg">▼ ${fmt(sor)}</span><span class="hint">${esc(libPer)}</span></div>
      ${z != null ? `<div class="hint">Loyer : ${loy && loy.montant ? fmt(loy.montant) + " / semaine" : "aucun"}</div>
`
        : `<div class="hint">Permanences dont la zone est introuvable (coffre / châtellerie sans zone)</div>`}
      <div class="k-inv"><div class="k-invt">Objets dans le coffre</div>${inv.length
        ? inv.map(e => `<div><span>${esc(e.nom)}</span><b${e.q < 0 ? ' class="neg"' : ""}>${e.q < 0 ? "−" : ""}${Math.abs(e.q).toLocaleString("fr-FR")}</b></div>`).join("")
        : '<span class="hint">Aucun</span>'}</div>
    </div>`;
  }).join("");

  // 2. Statistiques de la période (limitées à la zone choisie)
  $("kStatPer").textContent = "— " + libPer + (zf ? " · zone " + zf : "");
  $("kStats").innerHTML = statsCompta(per.filter(r => zf == null || r.zone_id === zf), zf);

  // 3. Journal
  const ty = $("kType").value;
  const voirRetires = $("kRetires").checked;
  const lignes = (voirRetires ? [...per, ...KJR.filter(r => (!du || r.t >= du) && (!au || r.t < au))].sort((a, b) => b.t - a.t) : per)
    .filter(r => (zf == null || r.zone_id === zf) && (!ty || r.type === ty));
  $("kRetNb").textContent = KJR.length ? `(${KJR.length})` : "";
  let solde = zf != null ? KJ.filter(r => r.zone_id === zf && (!au || r.t < au)).reduce((s, r) => s + r.montant, 0) : null;
  const MAX = 300, avecSolde = zf != null && !ty;
  $("kNb").textContent = lignes.length;
  $("kJournal").innerHTML = lignes.length ? `<div class="k-table"><table class="k-jr"><thead><tr><th>Date</th>${zf == null ? "<th>Zone</th>" : ""}<th>Mouvement</th><th class="r">Septims</th>${avecSolde ? '<th class="r">Solde</th>' : ""}<th></th></tr></thead><tbody>${
    lignes.slice(0, MAX).map(r => {
      const s = solde; if (solde != null && !r.retire) solde -= r.montant;
      const res = (r.ressources || []).filter(x => Number(x.qte)).map(x => `${Number(x.qte) > 0 ? "+" : "−"}${Math.abs(Number(x.qte)).toLocaleString("fr-FR")} ${esc(x.nom)}`).join(" · ");
      const loyer = r.type === "loyer" && !r.retire;
      return `<tr class="${r.retire ? "k-retire" : ""}"><td class="k-d">${r.t.toLocaleDateString("fr-FR")}<br><span class="hint">${r.t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></td>
        ${zf == null ? `<td>${esc(nomZone(r.zone_id, true))}</td>` : ""}
        <td><span class="k-type">${TYPES_K[r.type] || r.type}</span> ${esc(r.libelle)}${res ? `<br><span class="hint">Objets : ${res}</span>` : ""}${r.type === "loyer" && r.detail?.modifie ? `<br><span class="hint">modifié${r.detail.par ? " par " + esc(r.detail.par) : ""} (prévu : ${fmt(r.detail.prevu)})</span>` : r.detail?.par ? `<br><span class="hint">par ${esc(r.detail.par)}</span>` : ""}${r.retire ? '<br><span class="tag err">Retiré de la compta</span>' : ""}</td>
        <td class="r ${r.retire ? "" : r.montant > 0 ? "pos" : r.montant < 0 ? "neg" : ""}">${loyer ? `<span class="k-loyer-m">${r.montant ? septimsSigne(r.montant) : "—"}</span>` : r.montant ? septimsSigne(r.montant) : "—"}</td>
        ${avecSolde ? `<td class="r">${r.retire ? "" : septimsNeg(s)}</td>` : ""}
        <td class="k-act">${loyer ? `<button type="button" class="k-ico" title="Changer le montant de ce loyer" data-loy="${esc(r.ref)}">✎</button>` : ""}${r.retire
          ? `<button type="button" class="btn small" data-ret="${esc(r.ref)}">Rétablir</button>`
          : `<button type="button" class="x" title="${/^(mvt|frappe)\|/.test(r.ref) ? "Supprimer ce mouvement" : "Retirer de la compta"}" data-sup="${esc(r.ref)}">×</button>`}</td></tr>`;
    }).join("")}</tbody></table></div>${lignes.length > MAX ? `<p class="hint">Les ${MAX} plus récents sont affichés : réduis la période pour voir le reste.</p>` : ""}`
    : '<p class="empty">Aucun mouvement sur cette période.</p>';
  const fin = (error, ok) => { if (error) flash($("kMsg"), "Non enregistré : " + error.message + (/retirer_mouvement|modifier_loyer_semaine/.test(error.message) ? " (as-tu lancé 34_loyer_modifiable.sql ?)" : ""), false); else { flash($("kMsg"), ok, true); chargerCompta(); } };
  $("kJournal").querySelectorAll("[data-sup]").forEach(b => b.onclick = async () => {
    const ref = b.dataset.sup, [genre, id] = ref.split("|"), r = KJ.find(x => x.ref === ref);
    if (genre === "mvt") {                 // mouvement manuel : supprimé pour de bon
      if (!await confirmer(`Supprimer « ${r?.libelle || "ce mouvement"} » ?`)) return;
      const { error } = await sb.from("mouvements").delete().eq("id", id); return fin(error, "Mouvement supprimé.");
    }
    if (genre === "frappe") {              // frappe déclarée : annulée (disparaît aussi de l'onglet Frappe)
      if (!await confirmer(`Annuler « ${r?.libelle || "cette frappe"} » ? Elle disparaît aussi de l'onglet Frappe de septims.`)) return;
      const { error } = await sb.rpc("annuler_frappe", { frappe: Number(id) }); return fin(error, "Frappe annulée.");
    }
    // commande, contrat, loyer : retiré de la compta seulement (la commande / le contrat ne change pas)
    if (!await confirmer(`Retirer « ${r?.libelle || "ce mouvement"} » de la compta ? La ${genre === "loyer" ? "ligne de loyer" : r?.type === "contrat" ? "case du contrat" : "commande"} n'est pas modifiée, et tu pourras le rétablir (case « Voir les mouvements retirés »).`)) return;
    const { error } = await sb.rpc("retirer_mouvement", { ref_: ref, retirer: true }); fin(error, "Mouvement retiré de la compta.");
  });
  $("kJournal").querySelectorAll("[data-ret]").forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc("retirer_mouvement", { ref_: b.dataset.ret, retirer: false }); fin(error, "Mouvement rétabli.");
  });
  $("kJournal").querySelectorAll("[data-loy]").forEach(b => b.onclick = () => {
    const r = KJ.find(x => x.ref === b.dataset.loy), td = b.closest("tr").querySelector(".k-loyer-m"); if (!r || !td) return;
    td.innerHTML = `<input type="number" min="0" step="1" class="k-loy-in" value="${-r.montant}"> <button type="button" class="btn small k-loy-ok">OK</button>${r.detail?.modifie ? ` <button type="button" class="btn small k-loy-raz" title="Revenir au loyer prévu (${fmt(r.detail.prevu)})">Prévu</button>` : ""}`;
    const inp = td.querySelector("input"); inp.focus(); inp.select();
    const envoyer = async montant => {
      const { error } = await sb.rpc("modifier_loyer_semaine", { zone: r.detail.zone, semaine_: r.detail.semaine, montant_: montant });
      fin(error, montant == null ? "Loyer remis au montant prévu." : `Loyer de la semaine du ${new Date(r.detail.semaine + "T00:00").toLocaleDateString("fr-FR")} : ${fmt(montant)}.`);
    };
    td.querySelector(".k-loy-ok").onclick = () => { const m = Math.round(Number(inp.value)); if (m >= 0) envoyer(m); };
    inp.onkeydown = e => { if (e.key === "Enter") td.querySelector(".k-loy-ok").click(); if (e.key === "Escape") renderCompta(); };
    td.querySelector(".k-loy-raz")?.addEventListener("click", () => envoyer(null));
  });
  $("kResList").innerHTML = inventaire(KJ.map(r => ({ ressources: (r.ressources || []).map(x => ({ nom: x.nom, qte: 1 })) })))
    .map(e => `<option value="${esc(e.nom)}">`).join("");

  // 4. Loyers
  $("kLoyers").innerHTML = `<table class="zones k-loy"><thead><tr><th>Zone</th><th>Loyer / semaine</th><th></th></tr></thead><tbody>${
    ZONES_K.map(z => { const l = KLOY.find(x => x.zone_id === z);
      return `<tr><td><b>${esc(nomZone(z))}</b></td><td><input type="number" min="0" step="1" data-loyer="${z}" value="${l ? l.montant : 0}"></td>
        <td class="hint">${l ? `depuis le ${new Date(l.depuis + "T00:00").toLocaleDateString("fr-FR")}${l.fixe_par ? " · par " + esc(l.fixe_par) : ""}` : "jamais fixé"}</td></tr>`; }).join("")}</tbody></table>`;
  $("kLoyers").querySelectorAll("[data-loyer]").forEach(inp => inp.onchange = async () => {
    const z = Number(inp.dataset.loyer), m = Math.round(Number(inp.value));
    if (!(m >= 0)) { inp.value = 0; return; }
    const { error } = await sb.rpc("fixer_loyer", { zone: z, montant_: m });
    if (error) flash($("lMsg"), "Non enregistré : " + error.message, false);
    else { flash($("lMsg"), `Zone ${z} : loyer ${m ? fmt(m) + " par semaine" : "supprimé"}, à partir d'aujourd'hui.`, true); chargerCompta(); }
  });
}

// Barres horizontales (valeur écrite à côté : la couleur n'est jamais seule à porter l'info)
function barresK(lignes, max) {
  return lignes.map(l => `<div class="k-bar" title="${esc(l.titre || "")}"><span class="k-bl">${esc(l.lib)}</span>
    <span class="k-bt"><span class="k-bf ${l.cl || ""}" style="width:${max ? Math.max(l.v ? 1.5 : 0, l.v / max * 100) : 0}%"></span></span><span class="k-bv">${esc(l.txt)}</span></div>`).join("");
}
function statsCompta(per, zf) {
  if (!per.length) return '<p class="empty">Aucun mouvement sur cette période.</p>';
  const parZone = (zf ? [zf] : ZONES_K).map(z => {
    const p = per.filter(r => r.zone_id === z), som = t => p.filter(r => r.type === t).reduce((s, r) => s + r.montant, 0);
    const enc = som("commande"), ctr = -som("contrat"), loy = -som("loyer"), fra = -som("frappe"), man = som("manuel");
    return { z, enc, ctr, loy, fra, man, sorti: ctr + loy + fra + Math.max(0, -man), net: p.reduce((s, r) => s + r.montant, 0),
             nbCtr: p.filter(r => r.type === "contrat").length, nbCmd: p.filter(r => r.type === "commande").length };
  });
  const tuile = (lib, titre, val) => `<div class="k-tuile"><span class="hint">${lib}</span><b>${titre || "—"}</b><span>${titre ? val : ""}</span></div>`;
  let html;
  if (zf) {          // une zone : ses chiffres
    const x = parZone[0];
    html = `<div class="k-tuiles">
      ${tuile("Encaissé", fmt(x.enc), x.nbCmd + " commande(s) payée(s)")}
      ${tuile("Dépensé", fmt(x.sorti), `contrats ${fmt(x.ctr)} · loyers ${fmt(x.loy)}`)}
      ${tuile("Résultat", septimsSigne(x.net), "sur la période")}
      ${tuile("Contrats réalisés", String(x.nbCtr), fmt(x.ctr) + " payés")}
    </div>`;
  } else {           // toutes les zones : classements
    const top = k => [...parZone].sort((a, b) => b[k] - a[k])[0];
    const t = { enc: top("enc"), sorti: top("sorti"), net: top("net"), fra: top("fra"), nbCtr: top("nbCtr") };
    html = `<div class="k-tuiles">
      ${tuile("A le plus encaissé", t.enc.enc ? "Zone " + t.enc.z : "", fmt(t.enc.enc))}
      ${tuile("A le plus dépensé", t.sorti.sorti ? "Zone " + t.sorti.z : "", fmt(t.sorti.sorti))}
      ${tuile("Meilleur résultat", t.net.net ? "Zone " + t.net.z : "", septimsSigne(t.net.net))}
      ${tuile("Le plus de contrats", t.nbCtr.nbCtr ? "Zone " + t.nbCtr.z : "", t.nbCtr.nbCtr + " contrat(s)")}
    </div>`;
  }
  const maxES = Math.max(...parZone.map(x => Math.max(x.enc, x.sorti)), 0);
  html += `<h3 class="k-titre">Encaissé et dépensé${zf ? "" : " par zone"}</h3>
    <p class="k-leg"><span class="k-pt pos"></span> encaissé (commandes payées) <span class="k-pt neg"></span> dépensé (contrats + loyers + retraits)</p>
    ${parZone.map(x => `<div class="k-zbloc"><div class="k-zn">Zone ${x.z} <span class="hint">· résultat ${septimsSigne(x.net)}</span></div>
      ${barresK([{ lib: "Encaissé", v: x.enc, txt: fmt(x.enc), cl: "pos", titre: `${x.nbCmd} commande(s) payée(s)` },
                 { lib: "Dépensé", v: x.sorti, txt: fmt(x.sorti), cl: "neg", titre: `Contrats ${fmt(x.ctr)} · loyers ${fmt(x.loy)}` }], maxES)}</div>`).join("")}`;
  const neg = v => v ? "−" + fmt(v) : "—";
  html += `<div class="k-table"><table class="k-jr k-recap"><thead><tr><th>Zone</th><th class="r">Commandes</th><th class="r">Contrats</th><th class="r">Loyers</th><th class="r">Manuels</th><th class="r">Résultat</th></tr></thead><tbody>${
    parZone.map(x => `<tr><td>Zone ${x.z}</td><td class="r">${fmt(x.enc)}</td><td class="r">${neg(x.ctr)}</td><td class="r">${neg(x.loy)}</td><td class="r">${x.man ? septimsSigne(x.man) : "—"}</td><td class="r ${x.net > 0 ? "pos" : x.net < 0 ? "neg" : ""}">${septimsSigne(x.net)}</td></tr>`).join("")}</tbody></table></div>`;

  // Articles, clients, objets reçus
  const art = new Map(), cli = new Map();
  per.filter(r => r.type === "commande").forEach(r => {
    (r.detail?.items || []).forEach(x => { const a = art.get(x.nom) || { q: 0, s: 0 }; a.q += Number(x.qte) || 0; a.s += (Number(x.qte) || 0) * (Number(x.prix) || 0); art.set(x.nom, a); });
    const c = r.detail?.client || "?", k = cli.get(c) || { n: 0, s: 0 }; k.n++; k.s += r.montant; cli.set(c, k);
  });
  const recus = inventaire(per.map(r => ({ ressources: (r.ressources || []).filter(x => Number(x.qte) > 0) })));
  const tArt = [...art].sort((a, b) => b[1].s - a[1].s || b[1].q - a[1].q).slice(0, 10);
  const tCli = [...cli].sort((a, b) => b[1].s - a[1].s).slice(0, 10);
  const tRec = recus.sort((a, b) => b.q - a.q).slice(0, 10);
  const liste = (titre, rows, vide) => `<div><h3 class="k-titre">${titre}</h3>${rows.length ? `<ol class="k-top">${rows.join("")}</ol>` : `<p class="empty">${vide}</p>`}</div>`;
  html += `<div class="k-tops">
    ${liste("Articles les plus vendus", tArt.map(([n, a]) => `<li><span>${esc(n)}</span><span class="hint">${a.q.toLocaleString("fr-FR")} · ${fmt(a.s)}</span></li>`), "Aucune commande payée.")}
    ${liste("Meilleurs clients", tCli.map(([n, c]) => `<li><span>${esc(n)}</span><span class="hint">${c.n} cmd · ${fmt(c.s)}</span></li>`), "Aucune commande payée.")}
    ${liste("Objets reçus", tRec.map(e => `<li><span>${esc(e.nom)}</span><span class="hint">${e.q.toLocaleString("fr-FR")}</span></li>`), "Aucun objet reçu.")}
  </div>`;
  return html;
}

// Formulaire « mouvement manuel » : lignes d'objets
function ajouterObjet() {
  const d = document.createElement("div"); d.className = "k-obj";
  d.innerHTML = `<input class="o-nom" placeholder="Objet (ex. Armure d'acier)" list="kResList" autocomplete="off"><input class="o-qte" type="number" min="0" step="1" placeholder="Qté"><button type="button" class="x" title="Retirer">×</button>`;
  d.querySelector(".x").onclick = () => { d.remove(); if (!$("mObjets").children.length) ajouterObjet(); };
  $("mObjets").append(d);
}
$("mObjAdd").onclick = () => ajouterObjet();
["kPer", "kDu", "kAu", "kZone", "kType", "kRetires"].forEach(id => $(id).onchange = () => {
  if (id === "kZone" && $("kZone").value) $("mZone").value = $("kZone").value;
  renderCompta();
});
$("kMaj").onclick = () => chargerCompta();
async function mouvement(champs, btn, msg) {
  btn.disabled = true;
  const { error } = await sb.rpc("enregistrer_mouvement", champs);
  btn.disabled = false;
  if (error) { flash(msg, "Non enregistré : " + error.message + (/enregistrer_mouvement/.test(error.message) ? " (as-tu lancé 30_compta_frappe.sql ?)" : ""), false); return false; }
  return true;
}
$("mAdd").onclick = async () => {
  const sens = Number($("mSens").value), m = Math.round(Number($("mMontant").value) || 0), lib = $("mLib").value.trim();
  const objets = [...document.querySelectorAll("#mObjets .k-obj")].map(d => ({ nom: d.querySelector(".o-nom").value.trim(), qte: Math.round(Number(d.querySelector(".o-qte").value) || 0) }));
  if (m < 0 || objets.some(o => o.qte < 0)) return flash($("mMsg"), "Mets des nombres positifs : le sens (entrée / sortie) donne le signe.", false);
  if (objets.some(o => o.nom && !o.qte)) return flash($("mMsg"), "Indique la quantité de chaque objet.", false);
  const ok = objets.filter(o => o.nom && o.qte).map(o => ({ nom: o.nom, qte: sens * o.qte }));
  if (!m && !ok.length) return flash($("mMsg"), "Indique un montant, ou au moins un objet avec sa quantité.", false);
  if (!lib) return flash($("mMsg"), "Indique un libellé (la raison du mouvement).", false);
  if (!await mouvement({ zone: Number($("mZone").value), type_: "manuel", montant_: sens * m, libelle_: lib, ressources_: ok }, $("mAdd"), $("mMsg"))) return;
  ["mMontant", "mLib"].forEach(id => $(id).value = ""); $("mObjets").innerHTML = ""; ajouterObjet();
  flash($("mMsg"), "Mouvement ajouté ✔", true); chargerCompta();
};
/* ---------- Frappe de septims : une par châtellerie et par semaine (intendant, secrétaire, admin) ---------- */
var FRP = { chats: [], liste: [] };
const FRP_MAX = 20000, FRP_PAS = 500;
const lingotsFrappe = s => ({ or: s / 50, arg: s / 100 });            // 500 septims = 10 or + 5 argent
const isoJour = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function semaineFrp() {                                                  // lundi de la semaine affichée
  return estAdmin() && $("frpSem").value ? new Date($("frpSem").value + "T00:00") : lundiDe(new Date());
}
async function chargerFrappes() {
  $("frpSemWrap").style.display = estAdmin() ? "" : "none";
  if (estAdmin() && !$("frpSem").options.length) {          // liste des semaines « du lundi au dimanche », 1 an en arrière
    const l = lundiDe(new Date());
    for (let i = 0; i < 53; i++) {
      const lu = new Date(l); lu.setDate(lu.getDate() - 7 * i); const di = new Date(lu); di.setDate(di.getDate() + 6);
      const f = d => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
      $("frpSem").add(new Option(`${i === 0 ? "Cette semaine — " : i === 1 ? "Semaine dernière — " : ""}du ${f(lu)} au ${f(di)}/${di.getFullYear()}`, isoJour(lu)));
    }
  }
  const [c, l] = await Promise.all([sb.rpc("frappe_chatelleries"), sb.rpc("liste_frappes")]);
  if (c.error || l.error) {
    const m = (c.error || l.error).message;
    return flash($("frpMsg"), "Frappes non chargées : " + m + (/frappe/i.test(m) ? " (as-tu lancé 31_frappe.sql ?)" : ""), false);
  }
  FRP = { chats: c.data || [], liste: l.data || [] };
  const f = $("frpFiltre"), v = f.value;
  f.innerHTML = '<option value="">Toutes</option>' + FRP.chats.map(x => `<option>${esc(x.chatellerie)}</option>`).join("");
  f.value = v;
  renderFrappes();
}
function renderFrappes() {
  const lundi = semaineFrp(), sem = isoJour(lundi), dim = new Date(lundi); dim.setDate(dim.getDate() + 6);
  const courante = sem === isoJour(lundiDe(new Date())), modifiable = courante || estAdmin();
  $("frpSemLib").textContent = `— semaine du ${lundi.toLocaleDateString("fr-FR")} au ${dim.toLocaleDateString("fr-FR")}`;
  const options = sel => Array.from({ length: FRP_MAX / FRP_PAS }, (_, i) => (i + 1) * FRP_PAS)
    .map(n => `<option value="${n}" ${n === sel ? "selected" : ""}>${n.toLocaleString("fr-FR")}</option>`).join("");
  $("frpListe").innerHTML = FRP.chats.length ? `<div class="frp-grille">${FRP.chats.map(c => {
    const d = FRP.liste.find(x => x.chatellerie === c.chatellerie && x.semaine === sem), s = d ? d.septims : FRP_MAX, l = lingotsFrappe(s);
    const faite = !!d?.effectuee_le, saisie = modifiable && (!faite || estAdmin());
    return `<div class="frp-carte${faite ? " faite" : d ? " attente" : ""}" data-ch="${esc(c.chatellerie)}">
      <div class="frp-tete"><b>${esc(c.chatellerie)}</b><span class="hint">Zone ${c.zone_id}</span></div>
      ${d ? `<div class="${faite ? "frp-ok" : "frp-att"}">${faite ? "✔ Frappe effectuée" : "⏳ Lingots déposés, en attente de frappe"} : <b>${fmt(d.septims)}</b><br>
          <span class="hint">${d.lingots_or} lingots d'or · ${d.lingots_argent} lingots d'argent · déclarée par ${esc(d.declare_par || "?")} le ${new Date(d.declare_le).toLocaleString("fr-FR")}${
            faite ? `<br>frappée par ${esc(d.effectuee_par || "?")} le ${new Date(d.effectuee_le).toLocaleString("fr-FR")}` : ""}</span></div>`
          : `<div class="hint">${courante ? "Pas encore de frappe cette semaine." : "Aucune frappe cette semaine-là."}</div>`}
      ${saisie ? `<div class="frp-saisie"><label>Septims à frapper</label><select class="frp-s">${options(s)}</select>
        <div class="frp-besoin">Il faut <b class="frp-or">${l.or}</b> lingots d'or et <b class="frp-arg">${l.arg}</b> lingots d'argent</div></div>` : ""}
      <div class="row">${saisie ? `<button type="button" class="btn ${d ? "" : "primary"} small frp-go">${d ? "Corriger" : "Déclarer la frappe"}</button>` : ""}
        ${d && saisie ? `<button type="button" class="btn small frp-del" data-id="${d.id}">Annuler</button>` : ""}
        ${d && estFrappeur() ? (faite ? `<button type="button" class="btn small frp-fait" data-id="${d.id}" data-v="0">Remettre en attente</button>`
                                      : `<button type="button" class="btn primary small frp-fait" data-id="${d.id}" data-v="1">Frappe effectuée</button>`) : ""}</div>
    </div>`;
  }).join("")}</div>` : '<p class="empty">Aucune châtellerie : tu n\'es affecté(e) à aucune zone.</p>';
  $("frpListe").querySelectorAll(".frp-fait").forEach(b => b.onclick = async () => {
    const card = b.closest(".frp-carte"), faite = b.dataset.v === "1";
    if (faite && !await confirmer(`${card.dataset.ch} : la monnaie a bien été frappée ?`)) return;
    b.disabled = true;
    const { error } = await sb.rpc("frappe_effectuee", { frappe: Number(b.dataset.id), faite });
    if (error) { b.disabled = false; return flash($("frpMsg"), "Non enregistré : " + error.message + (/frappe_effectuee/.test(error.message) ? " (as-tu lancé 43_frappe_declaration.sql ?)" : ""), false); }
    flash($("frpMsg"), `${card.dataset.ch} : ${faite ? "frappe effectuée ✔" : "remise en attente."}`, true); chargerFrappes();
  });
  $("frpListe").querySelectorAll(".frp-carte").forEach(card => {
    const sel = card.querySelector(".frp-s"); if (!sel) return;
    sel.onchange = () => { const l = lingotsFrappe(Number(sel.value)); card.querySelector(".frp-or").textContent = l.or; card.querySelector(".frp-arg").textContent = l.arg; };
    card.querySelector(".frp-go").onclick = async e => {
      const ch = card.dataset.ch, s = Number(sel.value), l = lingotsFrappe(s);
      if (!await confirmer(`${ch} : ${l.or} lingots d'or et ${l.arg} lingots d'argent sont déposés dans le tonneau d'exportation de l'entrepôt, pour frapper ${fmt(s)} ? La zone 1 sera prévenue sur Discord.`)) return;
      e.target.disabled = true;
      const { error } = await sb.rpc("declarer_frappe", { chatellerie_: ch, septims_: s, semaine_: sem });
      e.target.disabled = false;
      if (error) return flash($("frpMsg"), "Non enregistré : " + error.message, false);
      flash($("frpMsg"), `${ch} : frappe de ${fmt(s)} déclarée ✔ La zone 1 est prévenue.`, true); chargerFrappes();
    };
    const del = card.querySelector(".frp-del");
    if (del) del.onclick = async () => {
      if (!await confirmer(`Annuler la frappe de ${card.dataset.ch} pour cette semaine ?`)) return;
      const { error } = await sb.rpc("annuler_frappe", { frappe: Number(del.dataset.id) });
      if (error) return flash($("frpMsg"), "Non annulé : " + error.message, false);
      flash($("frpMsg"), `${card.dataset.ch} : frappe annulée.`, true); chargerFrappes();
    };
  });
  // historique
  const fc = $("frpFiltre").value, h = FRP.liste.filter(x => !fc || x.chatellerie === fc);
  const tot = h.reduce((a, x) => ({ s: a.s + x.septims, o: a.o + x.lingots_or, g: a.g + x.lingots_argent }), { s: 0, o: 0, g: 0 });
  $("frpNb").textContent = h.length;
  $("frpHist").innerHTML = h.length ? `<div class="k-table"><table class="k-jr"><thead><tr><th>Semaine</th><th>Châtellerie</th><th class="r">Septims</th><th class="r">Or</th><th class="r">Argent</th><th>Déclarée par</th><th>État</th>${estAdmin() ? "<th></th>" : ""}</tr></thead><tbody>${
    h.map(x => `<tr><td>${new Date(x.semaine + "T00:00").toLocaleDateString("fr-FR")}</td><td>${esc(x.chatellerie)} <span class="hint">· zone ${x.zone_id}</span></td>
      <td class="r">${fmt(x.septims)}</td><td class="r">${x.lingots_or}</td><td class="r">${x.lingots_argent}</td>
      <td class="hint">${esc(x.declare_par || "?")} · ${new Date(x.declare_le).toLocaleDateString("fr-FR")}</td>
      <td>${x.effectuee_le ? '<span class="tag ok">frappée</span>' : '<span class="tag orange">en attente</span>'}</td>
      ${estAdmin() ? `<td><button type="button" class="x" title="Supprimer cette frappe" data-frp="${x.id}">×</button></td>` : ""}</tr>`).join("")}
    <tr class="frp-tot"><td colspan="2"><b>Total</b></td><td class="r">${fmt(tot.s)}</td><td class="r">${tot.o}</td><td class="r">${tot.g}</td><td></td><td></td>${estAdmin() ? "<td></td>" : ""}</tr></tbody></table></div>`
    : '<p class="empty">Aucune frappe déclarée.</p>';
  $("frpHist").querySelectorAll("[data-frp]").forEach(b => b.onclick = async () => {
    if (!await confirmer("Supprimer cette frappe ?")) return;
    const { error } = await sb.rpc("annuler_frappe", { frappe: Number(b.dataset.frp) });
    if (error) flash($("frpMsg"), "Non supprimé : " + error.message, false); else chargerFrappes();
  });
}
$("frpSem").onchange = () => renderFrappes();
const bougerSemaine = d => { const s = $("frpSem"), i = s.selectedIndex - d; if (i >= 0 && i < s.options.length) { s.selectedIndex = i; renderFrappes(); } };
$("frpPrec").onclick = () => bougerSemaine(-1);
$("frpSuiv").onclick = () => bougerSemaine(1);
$("frpFiltre").onchange = () => renderFrappes();

/* ---------- Audit des prix : relevé par ville, vue nationale, contrats construits à partir des prix ---------- */
var AUD = null;                                                   // { villes, denrees, prix: Map(cle -> Map(ville -> {prix, par, le})) }
const cleDenree = n => sansAccent(n).replace(/[^a-z0-9]/g, "");
const fmtPrix = n => n == null ? "—" : (Math.round(n * 100) / 100).toLocaleString("fr-FR");
const VIEUX_MS = 30 * 24 * 3600 * 1000;                           // un prix de plus d'un mois est « à revérifier »
const vieux = x => x && Date.now() - Date.parse(x.le) > VIEUX_MS;

async function chargerAudit() {
  const [v, d, p, c, cm, cp] = await Promise.all([sb.rpc("audit_villes"), sb.rpc("audit_denrees"), sb.rpc("audit_prix"), sb.rpc("audit_categories"),
    sb.rpc("audit_commerces"), sb.rpc("audit_commerce_prix")]);
  const err = [v, d, p, cm, cp].find(r => r.error);
  if (err) { flash($("audMsg"), "Audit indisponible : " + err.error.message + (/audit_/.test(err.error.message) ? " (as-tu lancé 39, 41 et 44 ?)" : ""), false); return false; }
  const prix = new Map();
  (p.data || []).forEach(r => { if (!prix.has(r.denree)) prix.set(r.denree, new Map()); prix.get(r.denree).set(r.ville, { prix: Number(r.prix), par: r.maj_par, le: r.maj_le }); });
  const toutes = (d.data || []).map(x => ({ cle: x.denree, nom: x.nom, cat: x.categorie || "Autres", catId: x.categorie_id, catOrdre: x.cat_ordre ?? 999, actif: x.actif !== false }));
  const cprix = new Map();
  (cp.data || []).forEach(r => { if (!cprix.has(r.commerce_id)) cprix.set(r.commerce_id, new Map()); cprix.get(r.commerce_id).set(r.denree, { prix: Number(r.prix), par: r.maj_par, le: r.maj_le }); });
  AUD = { villes: v.data || [], toutes, denrees: toutes.filter(x => x.actif), prix, commerces: cm.data || [], cprix, marge: AUD?.marge ?? 20,
          cats: c.error ? [] : c.data,                       // [{id, nom, ordre}] (41_denrees.sql)
          gere: !c.error };
  if (c.error && estAdmin()) flash($("gereMsg"), "Gestion des denrées indisponible : lance 41_denrees.sql.", false);
  return true;
}
const prixDe = (k, v) => AUD?.prix.get(k)?.get(v) || null;
function stats(k) {
  const m = AUD?.prix.get(k); if (!m || !m.size) return { moy: null, n: 0 };
  const l = [...m].map(([ville, x]) => ({ ville, prix: x.prix }));
  const moy = l.reduce((s, x) => s + x.prix, 0) / l.length;
  l.sort((a, b) => a.prix - b.prix);
  return { moy, n: l.length, min: l[0], max: l[l.length - 1] };
}

async function ouvrirAudit() {
  if (!await chargerAudit()) return;
  majFiltresCom();
  $("audNatCard").hidden = !estAdmin();
  $("audGenCard").hidden = !estAdmin();
  $("audGereCard").hidden = !estAdmin() || !AUD.gere;
  if (estAdmin() && AUD.gere) renderGere();
  if (estAdmin()) {
    if (!COMPAGNIES.length) await chargerCompagnies();
    const mg = await sb.rpc("audit_marge"); AUD.marge = mg.error ? 20 : Number(mg.data ?? 20); $("genMarge").value = AUD.marge;
    const gv = $("genVille"), gg = gv.value;
    gv.innerHTML = AUD.villes.map(v => `<option>${esc(v.ville)}</option>`).join(""); if (gg) gv.value = gg;
  }
  renderReleve(); renderNational();
}

// 1. Commerces de ma zone : région → localisation → commerce → produits et prix
const prixCom = (cid, k) => AUD?.cprix.get(cid)?.get(k) || null;
const comsVille = v => (AUD?.commerces || []).filter(c => c.ville === v);
const mesVilles = () => (AUD?.villes || []).filter(v => estAdmin() || v.a_moi).map(v => v.ville);
const locsVille = v => [...new Set(comsVille(v).map(c => c.localisation).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
function recalcVille(k, ville) {
  const l = comsVille(ville).map(c => prixCom(c.id, k)).filter(Boolean);
  if (!AUD.prix.has(k)) AUD.prix.set(k, new Map());
  if (!l.length) { AUD.prix.get(k).delete(ville); return; }
  const der = l.reduce((a, b) => (Date.parse(a.le) > Date.parse(b.le) ? a : b));
  AUD.prix.get(k).set(ville, { prix: l.reduce((s, x) => s + x.prix, 0) / l.length, par: der.par, le: der.le });
}
function pastilleEcart(prix, k) {
  const s = stats(k), e = s.n > 1 && s.moy ? (prix - s.moy) / s.moy : null;
  return e == null ? "" : e <= -0.15 ? '<span class="past bas" title="Nettement moins cher que la moyenne">▼</span> ' : e >= 0.15 ? '<span class="past haut" title="Nettement plus cher que la moyenne">▲</span> ' : "";
}
const NOUVELLE = "__nouvelle__";
function remplirLocs(sel, ville, garde, avecTous) {
  const l = locsVille(ville);
  sel.innerHTML = (avecTous ? '<option value="">Toutes les localisations</option>' : '<option value="">— Région entière / non précisée —</option>')
    + l.map(x => `<option>${esc(x)}</option>`).join("") + (avecTous ? "" : `<option value="${NOUVELLE}">＋ Ajouter une localisation…</option>`);
  sel.value = l.includes(garde) ? garde : "";
}
function majFiltresCom() {
  const villes = mesVilles();
  for (const id of ["audVille", "ncRegion"]) { const s = $(id), g = s.value; s.innerHTML = villes.map(v => `<option>${esc(v)}</option>`).join("") || '<option value="">— aucune région —</option>'; if (villes.includes(g)) s.value = g; }
  const ville = $("audVille").value;
  remplirLocs($("audLoc"), ville, $("audLoc").value, true);
  remplirLocs($("ncLoc"), $("ncRegion").value, $("ncLoc").value, false);
  const loc = $("audLoc").value, sc = $("audCom"), gc = sc.value;
  const cs = comsVille(ville).filter(c => !loc || c.localisation === loc);
  sc.innerHTML = '<option value="">Tous les commerces</option>' + cs.map(c => `<option value="${c.id}">${esc(c.nom)}${!loc && c.localisation ? " — " + esc(c.localisation) : ""}</option>`).join("");
  sc.value = cs.some(c => String(c.id) === gc) ? gc : "";
  const st = $("audType"), gt = st.value, types = [...new Set(AUD.commerces.map(c => c.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  st.innerHTML = '<option value="">Tous les concepts</option>' + types.map(t => `<option>${esc(t)}</option>`).join(""); st.value = types.includes(gt) ? gt : "";
  $("audTypes").innerHTML = types.map(t => `<option value="${esc(t)}">`).join("");
  const sk = $("audCat"), gk = sk.value;
  sk.innerHTML = '<option value="">Toutes les catégories</option>' + AUD.cats.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join(""); sk.value = gk;
  $("audDenList").innerHTML = AUD.denrees.map(d => `<option value="${esc(d.nom)}">`).join("");
}
// liste déroulante de recherche d'un produit, avec « ＋ Ajouter un produit »
function comboProduit(box) {
  const inp = box.querySelector(".ca-nom"), list = box.querySelector(".ca-list"), cat = box.querySelector(".ca-cat");
  let res = [], idx = -1;
  const montrer = () => {
    const q = sansAccent(inp.value.trim()), mots = q.split(/\s+/).filter(Boolean);
    res = AUD.denrees.filter(d => mots.every(m => sansAccent(d.nom + " " + d.cat).includes(m))).slice(0, 40);
    const exact = res.some(d => sansAccent(d.nom) === q);
    idx = res.length ? 0 : -1;
    list.innerHTML = res.map((d, i) => `<div class="combo-opt${i === idx ? " on" : ""}" data-i="${i}"><span>${esc(d.nom)}</span><span class="hint">${esc(d.cat)}</span></div>`).join("")
      + (q && !exact ? `<div class="combo-opt combo-nouveau" data-i="new">＋ Ajouter « ${esc(inp.value.trim())} » comme nouveau produit</div>` : "")
      + (!res.length && !q ? '<div class="combo-vide">Tape le nom du produit…</div>' : "");
    list.hidden = false;
  };
  const choisir = i => {
    if (i === "new") { cat.hidden = false; cat.focus(); inp.dataset.nouveau = "1"; }
    else { inp.value = res[i].nom; cat.hidden = true; delete inp.dataset.nouveau; box.querySelector(".ca-prix").focus(); }
    list.hidden = true;
  };
  inp.onfocus = montrer; inp.oninput = () => { cat.hidden = true; delete inp.dataset.nouveau; montrer(); };
  inp.onkeydown = e => {
    const opts = [...list.querySelectorAll(".combo-opt")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!opts.length) return; idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length; opts.forEach((o, j) => o.classList.toggle("on", j === idx)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = opts[idx]; if (o && !list.hidden) choisir(o.dataset.i === "new" ? "new" : +o.dataset.i); }
    else if (e.key === "Escape") list.hidden = true;
  };
  inp.onblur = () => setTimeout(() => { list.hidden = true; }, 150);
  list.onmousedown = e => e.preventDefault();
  list.onclick = e => { const o = e.target.closest(".combo-opt"); if (o) choisir(o.dataset.i === "new" ? "new" : +o.dataset.i); };
}
function renderReleve() {
  if (!AUD) return;
  const ville = $("audVille").value, loc = $("audLoc").value, fc = $("audCom").value, ft = $("audType").value, fk = $("audCat").value;
  const q = sansAccent($("audCherche").value.trim()), vx = $("audAFaire").checked;
  const N = AUD.denrees.length, faits = AUD.denrees.filter(d => prixDe(d.cle, ville)).length;
  $("audProg").textContent = ville ? `— ${ville} : ${comsVille(ville).length} commerce(s), ${faits} / ${N} produits relevés` : "";
  const coms = comsVille(ville).filter(c => (!loc || c.localisation === loc) && (!fc || String(c.id) === fc) && (!ft || c.type === ft));
  const optsCat = '<option value="">Catégorie du nouveau produit…</option>' + AUD.cats.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("") + `<option value="${NOUVELLE}">＋ Nouvelle catégorie…</option>`;
  $("audReleve").innerHTML = coms.length ? coms.map(c => {
    const arts = [...(AUD.cprix.get(c.id) || new Map())].map(([k, x]) => ({ d: AUD.toutes.find(t => t.cle === k) || { cle: k, nom: k, cat: "Autres", catOrdre: 999 }, x }))
      .filter(a => (!fk || String(a.d.catId) === fk) && (!q || sansAccent(a.d.nom).includes(q)) && (!vx || vieux(a.x)))
      .sort((a, b) => a.d.catOrdre - b.d.catOrdre || a.d.cat.localeCompare(b.d.cat, "fr") || a.d.nom.localeCompare(b.d.nom, "fr"));
    let cur = null, lignes = "";
    arts.forEach(({ d, x }) => {
      if (d.cat !== cur) { lignes += `<div class="com-cat">${esc(d.cat)}</div>`; cur = d.cat; }
      const s = stats(d.cle);
      lignes += `<div class="cl${vieux(x) ? " vieux" : ""}">
        <input class="cl-nom" value="${esc(d.nom)}" list="audDenList" data-cid="${c.id}" data-ancien="${esc(d.nom)}" title="Changer le produit de cette ligne">
        <input class="cl-prix" type="number" min="0" step="0.5" value="${x.prix}" data-cid="${c.id}" data-pd="${esc(d.nom)}" title="Prix d'une unité"><span class="hint">septims</span>
        <span class="rl-moy">${pastilleEcart(x.prix, d.cle)}moy. ${fmtPrix(s.moy)}</span>
        <span class="hint rl-date">${vieux(x) ? '<span class="aud-vieux">à revérifier</span> · ' : ""}${new Date(x.le).toLocaleDateString("fr-FR")}</span>
        <button type="button" class="btn small" data-cx="${c.id}" data-pd="${esc(d.nom)}">Supprimer</button></div>`;
    });
    const nb = AUD.cprix.get(c.id)?.size || 0;
    return `<div class="com" data-cid="${c.id}">
      <div class="com-tete"><b>${esc(c.nom)}</b><span class="hint">${[c.localisation, c.type].filter(Boolean).map(esc).join(" · ")}${c.localisation || c.type ? " · " : ""}${nb} produit(s)</span>
        <span class="com-act"><button type="button" class="btn small" data-com-edit="${c.id}">Modifier</button><button type="button" class="btn small" data-com-sup="${c.id}">Supprimer</button></span></div>
      ${lignes || `<p class="empty">${nb ? "Aucun produit pour ces filtres." : "Aucun produit pour l'instant : ajoute le premier ci-dessous."}</p>`}
      <div class="com-add"><div class="combo"><input class="ca-nom" placeholder="Rechercher un produit… (ex. Alcool)" autocomplete="off"><div class="combo-list ca-list" hidden></div></div>
        <select class="ca-cat" hidden>${optsCat}</select>
        <input type="number" min="0" step="0.5" placeholder="Prix" class="ca-prix"><button type="button" class="btn small primary ca-go">Ajouter le produit</button></div>
    </div>`; }).join("")
    : `<p class="empty">${comsVille(ville).length ? "Aucun commerce pour ces filtres." : `Aucun commerce dans la région ${esc(ville || "?")} : ajoute-le avec le formulaire au-dessus.`}</p>`;

  const apres = (k, msg) => { recalcVille(k, ville); renderReleve(); renderNational(); if (msg) flash($("audMsg"), msg, true); };
  const err = e => flash($("audMsg"), "Non enregistré : " + e.message + (/function|n'existe/.test(e.message) ? " (as-tu lancé 44 et 45 ?)" : ""), false);
  $("audReleve").querySelectorAll(".com").forEach(comboProduit);
  $("audReleve").querySelectorAll(".cl-prix").forEach(inp => inp.onchange = async () => {
    const cid = Number(inp.dataset.cid), p = Number(inp.value.replace(",", "."));
    if (inp.value === "" || !(p >= 0)) return flash($("audMsg"), "Prix invalide (pour enlever le produit, clique sur Supprimer).", false);
    inp.classList.add("envoi");
    const { error } = await sb.rpc("fixer_prix_commerce", { commerce: cid, nom_: inp.dataset.pd, prix_: p, categorie: null });
    inp.classList.remove("envoi");
    if (error) return err(error);
    const k = cleDenree(inp.dataset.pd);
    AUD.cprix.get(cid).set(k, { prix: p, par: PROFIL?.nom, le: new Date().toISOString() }); recalcVille(k, ville);
    const ligne = inp.closest(".cl"); ligne.classList.remove("vieux");
    ligne.querySelector(".rl-moy").innerHTML = `${pastilleEcart(p, k)}moy. ${fmtPrix(stats(k).moy)}`;
    ligne.querySelector(".rl-date").textContent = new Date().toLocaleDateString("fr-FR");
    inp.classList.add("ok"); setTimeout(() => inp.classList.remove("ok"), 900);
    renderNational();
  });
  $("audReleve").querySelectorAll(".cl-nom").forEach(inp => inp.onchange = async () => {
    const cid = Number(inp.dataset.cid), nv = inp.value.trim(), anc = inp.dataset.ancien;
    if (!nv || cleDenree(nv) === cleDenree(anc)) { inp.value = anc; return; }
    const existe = AUD.toutes.find(d => d.cle === cleDenree(nv));
    if (!existe && !await confirmer(`« ${nv} » n'existe pas encore : le créer comme nouveau produit (pour toutes les zones) et l'utiliser ici à la place de « ${anc} » ?`)) { inp.value = anc; return; }
    const { error } = await sb.rpc("changer_produit_commerce", { commerce: cid, ancien: anc, nouveau: existe ? existe.nom : nv, categorie: null });
    if (error) { inp.value = anc; return err(error); }
    await chargerAudit(); majFiltresCom(); renderReleve(); renderNational(); if (estAdmin()) renderGere();
    flash($("audMsg"), `« ${anc} » remplacé par « ${existe ? existe.nom : nv} » dans ce commerce.`, true);
  });
  $("audReleve").querySelectorAll("[data-cx]").forEach(b => b.onclick = async () => {
    const cid = Number(b.dataset.cx);
    if (!await confirmer(`Supprimer « ${b.dataset.pd} » de ce commerce ?`)) return;
    const { error } = await sb.rpc("fixer_prix_commerce", { commerce: cid, nom_: b.dataset.pd, prix_: null, categorie: null });
    if (error) return err(error);
    const k = cleDenree(b.dataset.pd); AUD.cprix.get(cid)?.delete(k); apres(k, `« ${b.dataset.pd} » supprimé du commerce.`);
  });
  $("audReleve").querySelectorAll(".ca-cat").forEach(sel => sel.onchange = async () => {
    if (sel.value !== NOUVELLE) return;
    const nom = (prompt("Nom de la nouvelle catégorie de produits :") || "").trim();
    if (!nom) { sel.value = ""; return; }
    const { data, error } = await sb.rpc("ajouter_categorie", { nom_: nom });
    if (error) { sel.value = ""; return err(error); }
    if (!AUD.cats.some(c => c.id === data)) AUD.cats.push({ id: data, nom, ordre: 900 });
    sel.add(new Option(nom, data), sel.options[sel.options.length - 1]); sel.value = String(data);
  });
  $("audReleve").querySelectorAll(".ca-go").forEach(b => b.onclick = async () => {
    const box = b.closest(".com"), cid = Number(box.dataset.cid), inp = box.querySelector(".ca-nom"), nom = inp.value.trim();
    const pv = box.querySelector(".ca-prix").value, p = Number(String(pv).replace(",", ".")), cat = box.querySelector(".ca-cat").value;
    if (!nom) return flash($("audMsg"), "Choisis ou tape le produit.", false);
    if (pv === "" || !(p >= 0)) return flash($("audMsg"), "Indique le prix.", false);
    const existe = AUD.toutes.find(d => d.cle === cleDenree(nom));
    if (!existe && !inp.dataset.nouveau) { inp.focus(); return flash($("audMsg"), `« ${nom} » n'existe pas : choisis « ＋ Ajouter comme nouveau produit » dans la liste.`, false); }
    if (!existe && (!cat || cat === NOUVELLE)) return flash($("audMsg"), "Choisis la catégorie du nouveau produit.", false);
    b.disabled = true;
    const { error } = await sb.rpc("fixer_prix_commerce", { commerce: cid, nom_: existe ? existe.nom : nom, prix_: p, categorie: existe ? null : Number(cat) });
    b.disabled = false;
    if (error) return err(error);
    if (!existe || !existe.actif) { await chargerAudit(); majFiltresCom(); renderReleve(); renderNational(); if (estAdmin()) renderGere(); return flash($("audMsg"), `« ${nom} » créé et ajouté.`, true); }
    if (!AUD.cprix.has(cid)) AUD.cprix.set(cid, new Map());
    AUD.cprix.get(cid).set(existe.cle, { prix: p, par: PROFIL?.nom, le: new Date().toISOString() });
    apres(existe.cle, `« ${existe.nom} » ajouté.`);
  });
  $("audReleve").querySelectorAll("[data-com-edit]").forEach(b => b.onclick = async () => {
    const c = AUD.commerces.find(x => String(x.id) === b.dataset.comEdit);
    const nom = prompt("Nom du commerce :", c.nom); if (nom === null || !nom.trim()) return;
    const locn = prompt("Localisation dans la région (ex. Fort-Ivar — vide si aucune) :", c.localisation || ""); if (locn === null) return;
    const type = prompt("Concept (ex. Alcool, Forge — facultatif) :", c.type || ""); if (type === null) return;
    const { error } = await sb.rpc("enregistrer_commerce", { id_: c.id, ville_: c.ville, nom_: nom.trim(), type_: type.trim(), localisation_: locn.trim() });
    if (error) return err(error);
    Object.assign(c, { nom: nom.trim(), type: type.trim(), localisation: locn.trim() }); majFiltresCom(); renderReleve(); flash($("audMsg"), "Commerce modifié.", true);
  });
  $("audReleve").querySelectorAll("[data-com-sup]").forEach(b => b.onclick = async () => {
    const c = AUD.commerces.find(x => String(x.id) === b.dataset.comSup), nb = AUD.cprix.get(c.id)?.size || 0;
    if (!await confirmer(`Supprimer le commerce « ${c.nom} »${nb ? ` et ses ${nb} prix` : ""} ? C'est définitif.`)) return;
    const { error } = await sb.rpc("supprimer_commerce", { id_: c.id });
    if (error) return err(error);
    const ks = [...(AUD.cprix.get(c.id)?.keys() || [])];
    AUD.commerces = AUD.commerces.filter(x => x.id !== c.id); AUD.cprix.delete(c.id);
    ks.forEach(k => recalcVille(k, c.ville)); majFiltresCom(); renderReleve(); renderNational(); flash($("audMsg"), "Commerce supprimé.", true);
  });
}
$("ncRegion").onchange = () => remplirLocs($("ncLoc"), $("ncRegion").value, "", false);
$("ncLoc").onchange = () => {
  if ($("ncLoc").value !== NOUVELLE) return;
  const l = (prompt(`Nouvelle localisation dans la région ${$("ncRegion").value} (ex. Fort-Ivar) :`) || "").trim();
  if (!l) { $("ncLoc").value = ""; return; }
  if (![...$("ncLoc").options].some(o => o.value === l)) $("ncLoc").add(new Option(l, l), $("ncLoc").options[$("ncLoc").options.length - 1]);
  $("ncLoc").value = l;
};
$("audComAdd").onclick = async () => {
  const ville = $("ncRegion").value, loc = $("ncLoc").value === NOUVELLE ? "" : $("ncLoc").value, nom = $("ncNom").value.trim(), type = $("ncConcept").value.trim();
  if (!ville) return flash($("ncMsg"), "Choisis la région.", false);
  if (!nom) return flash($("ncMsg"), "Indique le nom du commerce.", false);
  const { data, error } = await sb.rpc("enregistrer_commerce", { id_: null, ville_: ville, nom_: nom, type_: type, localisation_: loc });
  if (error) return flash($("ncMsg"), "Non créé : " + error.message + (/enregistrer_commerce/.test(error.message) ? " (as-tu lancé 45_commerces_localisation.sql ?)" : ""), false);
  AUD.commerces.push({ id: data, ville, localisation: loc, nom, type, a_moi: true }); AUD.cprix.set(data, new Map());
  $("ncNom").value = ""; $("ncConcept").value = "";
  $("audVille").value = ville; majFiltresCom(); $("audLoc").value = loc; majFiltresCom(); $("audCom").value = String(data);
  renderReleve(); flash($("ncMsg"), `Commerce « ${nom} » ajouté : ajoute ses produits dans « Mes commerces ».`, true);
  document.querySelector(`.com[data-cid="${data}"] .ca-nom`)?.scrollIntoView({ behavior: "smooth", block: "center" });
};

// 2. Vue nationale : avancement par ville + une ligne par denrée (détail des villes au clic)
function renderNational() {
  if (!AUD) return;
  const N = AUD.denrees.length;
  $("audVilles").innerHTML = AUD.villes.map(v => { const n = AUD.denrees.filter(d => prixDe(d.cle, v.ville)).length;
    return `<div class="av"><span>${esc(v.ville)}</span><span class="av-b"><span style="width:${N ? n / N * 100 : 0}%"></span></span><span class="hint">${n}/${N}</span></div>`; }).join("");
  const ouverts = new Set([...$("audNat").querySelectorAll("tr.nat-det")].map(t => t.dataset.k));
  $("audNat").innerHTML = `<div class="k-table"><table class="k-jr nat"><thead><tr><th>Denrée</th><th class="r">Moyenne</th><th>Moins chère</th><th>Plus chère</th><th class="r">Villes</th></tr></thead><tbody>${
    AUD.denrees.map(d => { const s = stats(d.cle);
      return `<tr class="nat-l" data-k="${esc(d.cle)}"><td>${esc(d.nom)}</td><td class="r"><b>${fmtPrix(s.moy)}</b></td>
        <td>${s.n ? `${esc(s.min.ville)} <span class="hint">${fmtPrix(s.min.prix)}</span>` : '<span class="hint">—</span>'}</td>
        <td>${s.n > 1 ? `${esc(s.max.ville)} <span class="hint">${fmtPrix(s.max.prix)}</span>` : '<span class="hint">—</span>'}</td>
        <td class="r">${s.n}/10</td></tr>${ouverts.has(d.cle) ? detailNat(d) : ""}`; }).join("")}</tbody></table></div>`;
  $("audNat").querySelectorAll("tr.nat-l").forEach(tr => tr.onclick = () => {
    const suiv = tr.nextElementSibling;
    if (suiv?.classList.contains("nat-det")) suiv.remove();
    else tr.insertAdjacentHTML("afterend", detailNat(AUD.denrees.find(d => d.cle === tr.dataset.k)));
  });
}
function detailNat(d) {
  return `<tr class="nat-det" data-k="${esc(d.cle)}"><td colspan="5"><div class="nat-villes">${AUD.villes.map(v => { const x = prixDe(d.cle, v.ville);
    return `<span class="${x ? (vieux(x) ? "vieux" : "") : "manque"}"><b>${esc(v.ville)}</b> ${x ? fmtPrix(x.prix) : "—"}${x ? ` <span class="hint">${esc(x.par || "")}, ${new Date(x.le).toLocaleDateString("fr-FR")}</span>` : ""}</span>`; }).join("")}</div></td></tr>`;
}
$("audVille").onchange = () => { $("audLoc").value = ""; majFiltresCom(); renderReleve(); };
$("audLoc").onchange = () => { majFiltresCom(); renderReleve(); };
["audCom", "audType", "audCat", "audAFaire"].forEach(id => $(id).onchange = renderReleve);
$("audCherche").oninput = renderReleve;

// Gestion des denrées et catégories (admin)
async function rechargerAudit(msg) { if (await chargerAudit()) { majFiltresCom(); renderReleve(); renderNational(); renderGere(); if (msg) flash($("gereMsg"), msg, true); } }
const erreurGere = e => flash($("gereMsg"), "Non enregistré : " + e.message, false);
function renderGere() {
  if (!AUD?.gere) return;
  const optsCat = sel => AUD.cats.map(c => `<option value="${c.id}" ${String(c.id) === String(sel ?? "") ? "selected" : ""}>${esc(c.nom)}</option>`).join("");
  const nb = id => AUD.toutes.filter(d => String(d.catId) === String(id)).length;
  $("gereCats").innerHTML = `<div class="k-table"><table class="k-jr gere"><thead><tr><th>Nom</th><th class="r">Ordre</th><th class="r">Denrées</th><th></th></tr></thead><tbody>${
    AUD.cats.map(c => `<tr><td><input value="${esc(c.nom)}" data-cat-nom="${c.id}"></td><td class="r"><input type="number" step="10" value="${c.ordre}" data-cat-ordre="${c.id}" style="width:80px"></td><td class="r">${nb(c.id)}</td>
      <td class="r">${c.nom === "Autres" ? "" : `<button type="button" class="x" title="Supprimer la catégorie" data-cat-sup="${c.id}">×</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  $("gereDenCat").innerHTML = optsCat(AUD.cats.find(c => c.nom === "Autres")?.id);
  const q = sansAccent($("gereCherche").value.trim());
  const liste = AUD.toutes.filter(d => !q || sansAccent(d.nom).includes(q));
  $("gereDen").innerHTML = `<div class="k-table"><table class="k-jr gere"><thead><tr><th>Denrée</th><th>Catégorie</th><th></th></tr></thead><tbody>${
    liste.map(d => `<tr class="${d.actif ? "" : "k-retire"}"><td><input value="${esc(d.nom)}" data-den-nom="${esc(d.cle)}"></td>
      <td><select data-den-cat="${esc(d.cle)}">${optsCat(d.catId)}</select></td>
      <td class="r gere-act">${d.actif ? `<button type="button" class="btn small" data-den-off="${esc(d.cle)}">Retirer</button>` : `<button type="button" class="btn small" data-den-on="${esc(d.cle)}">Remettre</button>`}
        <button type="button" class="x" title="Supprimer complètement (et ses prix)" data-den-sup="${esc(d.cle)}">×</button></td></tr>`).join("")}</tbody></table></div>`;
  const den = k => AUD.toutes.find(d => d.cle === k);
  const majDen = async (k, champs, msg) => { const d = den(k);
    const { error } = await sb.rpc("modifier_denree", { cle_: k, nom_: champs.nom ?? d.nom, categorie: champs.cat !== undefined ? champs.cat : d.catId, actif_: champs.actif ?? d.actif });
    if (error) return erreurGere(error); rechargerAudit(msg); };
  $("gereDen").querySelectorAll("[data-den-nom]").forEach(i => i.onchange = () => i.value.trim() && majDen(i.dataset.denNom, { nom: i.value.trim() }, "Denrée renommée."));
  $("gereDen").querySelectorAll("[data-den-cat]").forEach(s => s.onchange = () => majDen(s.dataset.denCat, { cat: Number(s.value) }, `« ${den(s.dataset.denCat).nom} » → ${s.selectedOptions[0].text}.`));
  $("gereDen").querySelectorAll("[data-den-off]").forEach(b => b.onclick = async () => { if (await confirmer(`Retirer « ${den(b.dataset.denOff).nom} » des relevés ? (les prix déjà saisis sont gardés)`)) majDen(b.dataset.denOff, { actif: false }, "Denrée retirée."); });
  $("gereDen").querySelectorAll("[data-den-on]").forEach(b => b.onclick = () => majDen(b.dataset.denOn, { actif: true }, "Denrée remise."));
  $("gereDen").querySelectorAll("[data-den-sup]").forEach(b => b.onclick = async () => {
    const d = den(b.dataset.denSup);
    if (!await confirmer(`Supprimer complètement « ${d.nom} » et tous ses prix ? C'est définitif.`)) return;
    const { error } = await sb.rpc("supprimer_denree", { cle_: d.cle });
    if (error) return flash($("gereMsg"), error.message + (/supprimer_denree/.test(error.message) ? " (as-tu lancé 42_supprimer_denree.sql ?)" : ""), false);
    rechargerAudit(`« ${d.nom} » supprimée.`);
  });
  const majCat = async (id, nom, ordre, msg) => { const { error } = await sb.rpc("enregistrer_categorie", { id_: id, nom_: nom, ordre_: ordre }); if (error) return erreurGere(error); rechargerAudit(msg); };
  $("gereCats").querySelectorAll("[data-cat-nom]").forEach(i => i.onchange = () => { const c = AUD.cats.find(x => String(x.id) === i.dataset.catNom); if (i.value.trim()) majCat(c.id, i.value.trim(), c.ordre, "Catégorie renommée."); });
  $("gereCats").querySelectorAll("[data-cat-ordre]").forEach(i => i.onchange = () => { const c = AUD.cats.find(x => String(x.id) === i.dataset.catOrdre); majCat(c.id, c.nom, Number(i.value) || 0, "Ordre enregistré."); });
  $("gereCats").querySelectorAll("[data-cat-sup]").forEach(b => b.onclick = async () => {
    const c = AUD.cats.find(x => String(x.id) === b.dataset.catSup);
    if (!await confirmer(`Supprimer la catégorie « ${c.nom} » ?${nb(c.id) ? ` Ses ${nb(c.id)} denrée(s) passent dans « Autres ».` : ""}`)) return;
    const { error } = await sb.rpc("supprimer_categorie", { id_: c.id }); if (error) return erreurGere(error); rechargerAudit("Catégorie supprimée.");
  });
}
$("gereCherche").oninput = renderGere;
$("gereCatAdd").onclick = async () => {
  const nom = $("gereCatNom").value.trim(); if (!nom) return;
  const ordre = Math.max(0, ...AUD.cats.filter(c => c.nom !== "Autres").map(c => c.ordre)) + 10;
  const { error } = await sb.rpc("enregistrer_categorie", { id_: null, nom_: nom, ordre_: ordre });
  if (error) return erreurGere(error); $("gereCatNom").value = ""; rechargerAudit(`Catégorie « ${nom} » ajoutée.`);
};
$("gereDenAdd").onclick = async () => {
  const nom = $("gereDenNom").value.trim(); if (!nom) return;
  if (AUD.toutes.some(d => d.cle === cleDenree(nom) && d.actif)) return flash($("gereMsg"), `« ${nom} » existe déjà.`, false);
  const { error } = await sb.rpc("enregistrer_denree", { nom_: nom, categorie: Number($("gereDenCat").value) || null });
  if (error) return erreurGere(error); $("gereDenNom").value = ""; rechargerAudit(`« ${nom} » ajoutée.`);
};

// 3. Construire des contrats pour une ville (admin) : denrées moins chères que la moyenne
let GEN = null;
const arrondiQte = q => q < 20 ? Math.max(1, Math.round(q)) : q < 100 ? Math.round(q / 5) * 5 : q < 1000 ? Math.round(q / 10) * 10 : Math.round(q / 50) * 50;
function construireContrats(ville) {
  const cand = AUD.denrees.map(d => { const x = prixDe(d.cle, ville), s = stats(d.cle); return { d, local: x?.prix, moy: s.moy, n: s.n }; })
    .filter(c => c.local != null && c.n >= 2 && c.moy > c.local && c.local > 0)
    .map(c => ({ ...c, gain: (c.moy - c.local) / c.moy }))
    .sort((a, b) => b.gain - a.gain);
  if (!cand.length) return { erreur: `Aucune denrée moins chère que la moyenne nationale à ${ville} (il faut le prix de ${ville} et d'au moins une autre ville).` };
  const cibles = { petit: 4000, moyen: 12000, gros: 25000 }, marge = (Number($("genMarge").value) || 0) / 100;   // taille visée (valeur au prix national)
  const nbLignes = { petit: [1, 2], moyen: [2, 3], gros: [3, 4] }, contrats = {};
  for (const t of ["petit", "moyen", "gros"]) {
    const top = cand.slice(0, Math.max(6, nbLignes[t][1])).sort(() => Math.random() - 0.5);
    const n = Math.min(cand.length, nbLignes[t][0] + Math.floor(Math.random() * (nbLignes[t][1] - nbLignes[t][0] + 1)));
    const pris = top.slice(0, n);
    let lignes = pris.map(c => ({ c, qte: arrondiQte(cibles[t] / n / c.moy) }));
    const cout = lignes.reduce((s, l) => s + l.qte * l.c.local, 0);
    const prix = Math.max(50, Math.round(cout * (1 + marge) / 50) * 50);        // prix = coût à la ville + marge
    contrats[t] = { prix, lignes: lignes.map(l => `${l.c.d.nom} x ${l.qte}`), detail: lignes, cout, benef: prix - cout };
  }
  return { ville, contrats };
}
function renderGen() {
  $("genListe").innerHTML = ["petit", "moyen", "gros"].map(t => { const c = GEN.contrats[t];
    return `<figure class="gen-c"><img src="${parchemin(`Contrat de ${GEN.ville}`, c)}" alt="">
      <figcaption><b>${LIB_TAILLE[t]}</b> — ${fmt(c.prix)}
        <ul>${c.detail.map(l => `<li>${l.qte.toLocaleString("fr-FR")} × ${esc(l.c.d.nom)} <span class="hint">local ${fmtPrix(l.c.local)} / moy. ${fmtPrix(l.c.moy)}</span></li>`).join("")}</ul>
        <span class="hint">Coût à ${esc(GEN.ville)} : ${fmt(Math.round(c.cout))}</span><br><b class="pos">Bénéfice : ${fmt(Math.round(c.benef))}</b> <span class="hint">(${Math.round(c.benef / c.cout * 100)} %)</span>
      </figcaption></figure>`; }).join("");
  $("genApercu").hidden = false;
}
$("genGo").onclick = $("genRegen").onclick = async () => {
  if (!AUD) await chargerAudit();
  const m = Number($("genMarge").value);
  if (!(m >= 0)) return flash($("genMsg"), "Marge invalide.", false);
  if (m !== AUD.marge) { const { error } = await sb.rpc("fixer_marge", { marge: m }); if (!error) AUD.marge = m; }
  const r = construireContrats($("genVille").value);
  if (r.erreur) { $("genApercu").hidden = true; return flash($("genMsg"), r.erreur, false); }
  GEN = r; $("genMsg").className = "msg"; renderGen();
};
$("genSave").onclick = async () => {
  if (!GEN) return;
  if (!await confirmer(`Enregistrer ces 3 contrats (« Contrat de ${GEN.ville} ») dans les contrats d'exportation ? Ils pourront sortir au tirage de ${GEN.ville} uniquement.`)) return;
  const contrats = {}; ["petit", "moyen", "gros"].forEach(t => contrats[t] = { prix: GEN.contrats[t].prix, lignes: GEN.contrats[t].lignes });
  const slug = "gen-" + cleVille(GEN.ville) + "-" + Date.now().toString(36);
  const { error } = await sb.from("compagnies").insert({ slug, nom: `Contrat de ${GEN.ville}`, contrats, images: "genere", ville: GEN.ville, actif: true, ordre: 5000 });
  if (error) return flash($("genMsg"), "Non enregistré : " + error.message + (/genere|ville/.test(error.message) ? " (as-tu lancé 40_contrats_generes.sql ?)" : ""), false);
  flash($("genMsg"), `Contrats de ${GEN.ville} enregistrés ✔ (Réglages > Compagnies pour les désactiver ou les supprimer)`, true);
  $("genApercu").hidden = true; GEN = null; chargerCompagnies();
};

// Parchemin dessiné (même gabarit que les visuels des compagnies : 370 × 1414)
const PARCH_CACHE = new Map();
function parchemin(titre, c) {
  const cle = titre + "|" + c.prix + "|" + (c.lignes || []).join(";");
  if (PARCH_CACHE.has(cle)) return PARCH_CACHE.get(cle);
  const W = 370, H = 1414, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d"), or = "#d9a521", nuit = "#23253a";
  const g = x.createRadialGradient(W / 2, H * 0.55, 60, W / 2, H * 0.55, H * 0.7); g.addColorStop(0, "#f3e4bf"); g.addColorStop(1, "#d9c08a");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.globalAlpha = 0.06; for (let i = 0; i < 260; i++) { x.fillStyle = i % 2 ? "#7a5a2a" : "#fff"; x.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1 + Math.random() * 3); } x.globalAlpha = 1;
  // bandeau du haut en chevron
  x.fillStyle = nuit; x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0); x.lineTo(W, 480); x.lineTo(W / 2, 570); x.lineTo(0, 480); x.closePath(); x.fill();
  x.strokeStyle = or; x.lineWidth = 5; x.beginPath(); x.moveTo(0, 480); x.lineTo(W / 2, 570); x.lineTo(W, 480); x.stroke();
  x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = or;
  const mots = titre.split(" "), lignesT = []; let cur = "";
  x.font = "700 38px Cinzel, Georgia, serif";
  mots.forEach(m => { const t = cur ? cur + " " + m : m; if (x.measureText(t).width > W - 50 && cur) { lignesT.push(cur); cur = m; } else cur = t; }); if (cur) lignesT.push(cur);
  lignesT.forEach((l, i) => x.fillText(l, W / 2, 80 + i * 48));
  // emblème
  const ey = 340; x.lineWidth = 4; x.beginPath(); x.arc(W / 2, ey, 82, 0, Math.PI * 2); x.stroke(); x.lineWidth = 2; x.beginPath(); x.arc(W / 2, ey, 70, 0, Math.PI * 2); x.stroke();
  x.font = "700 30px Cinzel, Georgia, serif"; x.fillText("C·E·O", W / 2, ey - 8); x.font = "16px Cinzel, Georgia, serif"; x.fillText("Compagnie", W / 2, ey + 26);
  // lignes du contrat
  const lig = (c.lignes || []).map(l => { const m = String(l).match(/^(.*?)\s*[x×]\s*([0-9][0-9 .]*)\s*$/i); return m ? [m[1], m[2]] : [l, ""]; });
  const bloc = Math.min(120, 380 / Math.max(1, lig.length)), f = Math.min(30, bloc * 0.3);
  x.fillStyle = "#2b2118";
  lig.forEach(([nom, q], i) => { const y = 640 + i * bloc;
    x.font = `700 ${f}px "EB Garamond", Georgia, serif`; x.fillText(nom, W / 2, y, W - 30);
    x.font = `${f * 0.8}px "EB Garamond", Georgia, serif`; x.fillText("x", W / 2, y + f * 1.05);
    x.font = `700 ${f}px "EB Garamond", Georgia, serif`; x.fillText(Number(String(q).replace(/[ .]/g, "")).toLocaleString("fr-FR"), W / 2, y + f * 2.1); });
  // réalisé par
  x.strokeStyle = "#8a5a2b"; x.lineWidth = 3; x.beginPath(); x.moveTo(40, 1030); x.lineTo(W - 40, 1030); x.stroke();
  x.fillStyle = "#6b3a1e"; x.font = "600 28px Cinzel, Georgia, serif"; x.fillText("RÉALISÉ PAR", W / 2, 1068);
  // bandeau du bas : prix
  x.fillStyle = nuit; x.fillRect(0, H - 86, W, 86); x.strokeStyle = or; x.lineWidth = 4; x.beginPath(); x.moveTo(0, H - 86); x.lineTo(W, H - 86); x.stroke();
  x.fillStyle = or; x.font = "600 32px Cinzel, Georgia, serif"; x.fillText(`${Number(c.prix).toLocaleString("fr-FR")} Septims`, W / 2, H - 43);
  x.strokeStyle = or; x.lineWidth = 6; x.strokeRect(3, 3, W - 6, H - 6);
  const url = cv.toDataURL("image/jpeg", 0.9);
  PARCH_CACHE.set(cle, url);
  return url;
}
document.fonts?.load?.('700 38px Cinzel').then(() => PARCH_CACHE.clear()).catch(() => {});

/* ---------- Catalogues (admin) : principal + catalogues réservés à certaines zones ---------- */
function majSelectsCatalogue() {
  const opts = `<option value="">Principal</option>` + CATALOGUES.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("");
  const s1 = $("cCatalogue"), g1 = s1.value; s1.innerHTML = opts; s1.value = CATALOGUES.some(c => String(c.id) === g1) ? g1 : "";
  const s2 = $("cFiltreCatalogue"), g2 = s2.value;
  s2.innerHTML = `<option value="">Tous les catalogues</option><option value="0">Principal</option>` + CATALOGUES.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("");
  s2.value = g2 === "" || g2 === "0" || CATALOGUES.some(c => String(c.id) === g2) ? g2 : "";
  if (estAdmin()) renderCatalogues();
}
function renderCatalogues() {
  const nb = id => CATALOGUE.filter(a => (a.catalogue ?? null) === id).length;
  $("ctgListe").innerHTML = `<div class="k-table"><table class="k-jr gere"><thead><tr><th>Catalogue</th><th>Zones qui peuvent commander</th><th class="r">Articles</th><th></th></tr></thead><tbody>
    <tr><td><b>Principal</b></td><td class="hint">toutes</td><td class="r">${nb(null)}</td><td></td></tr>
    ${CATALOGUES.map(c => `<tr><td><input value="${esc(c.nom)}" data-ctg-nom="${c.id}"></td>
      <td class="ctg-zones">${[1, 2, 3, 4, 5, 6, 7].map(z => `<label class="liv"><input type="checkbox" data-ctg-z="${c.id}" value="${z}" ${(c.zones || []).includes(z) ? "checked" : ""}> ${z}</label>`).join("")}<span class="hint">${(c.zones || []).length ? "" : "(toutes)"}</span></td>
      <td class="r">${nb(c.id)}</td><td class="r"><button type="button" class="x" title="Supprimer le catalogue" data-ctg-sup="${c.id}">×</button></td></tr>`).join("")}</tbody></table></div>`;
  const maj = async (id, champs, msg) => { const { error } = await sb.from("catalogues").update(champs).eq("id", id); if (error) return flash($("ctgMsg"), "Non enregistré : " + error.message, false); flash($("ctgMsg"), msg, true); chargerCatalogue(); };
  $("ctgListe").querySelectorAll("[data-ctg-nom]").forEach(i => i.onchange = () => i.value.trim() && maj(Number(i.dataset.ctgNom), { nom: i.value.trim() }, "Catalogue renommé."));
  $("ctgListe").querySelectorAll("[data-ctg-z]").forEach(cb => cb.onchange = () => {
    const id = cb.dataset.ctgZ, zones = [...$("ctgListe").querySelectorAll(`[data-ctg-z="${id}"]:checked`)].map(x => Number(x.value));
    maj(Number(id), { zones }, zones.length ? `Réservé aux zones ${zones.join(", ")}.` : "Ouvert à toutes les zones.");
  });
  $("ctgListe").querySelectorAll("[data-ctg-sup]").forEach(b => b.onclick = async () => {
    const c = CATALOGUES.find(x => String(x.id) === b.dataset.ctgSup), n = nb(c.id);
    if (!await confirmer(`Supprimer le catalogue « ${c.nom} »${n ? ` et ses ${n} article(s)` : ""} ? C'est définitif.`)) return;
    const { error } = await sb.from("catalogues").delete().eq("id", c.id);
    if (error) return flash($("ctgMsg"), "Impossible : " + error.message, false);
    flash($("ctgMsg"), "Catalogue supprimé.", true); chargerCatalogue();
  });
}
$("ctgAdd").onclick = async () => {
  const nom = $("ctgNom").value.trim(); if (!nom) return;
  const { error } = await sb.from("catalogues").insert({ nom });
  if (error) return flash($("ctgMsg"), "Non créé : " + error.message + (/catalogues/.test(error.message) ? " (as-tu lancé 46_catalogues.sql ?)" : ""), false);
  $("ctgNom").value = ""; flash($("ctgMsg"), `Catalogue « ${nom} » créé : ajoute-lui des articles (choisis-le dans « Ajouter un article »).`, true); chargerCatalogue();
};
$("cFiltreCatalogue").onchange = () => renderCat();

/* ---------- Mode clair / sombre (retenu sur l'appareil) ---------- */
const themeSombre = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
function majBoutonsTheme() { document.querySelectorAll(".theme-btn").forEach(b => { b.textContent = themeSombre() ? "☀" : "☾"; b.title = themeSombre() ? "Passer en mode clair" : "Passer en mode sombre"; }); }
document.querySelectorAll(".theme-btn").forEach(b => b.onclick = () => {
  const t = themeSombre() ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch {}
  majBoutonsTheme();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", majBoutonsTheme);
majBoutonsTheme();

/* ---------- Démarrage ---------- */
if (SUPABASE_URL.includes("XXXXXXXX")) ecranConnexion("⚠ Renseigne SUPABASE_URL et SUPABASE_KEY en haut de script.js.", false);