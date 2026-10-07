/* =========================================================
   CONFIG
   ========================================================= */
// Supabase > Project Settings > API (ou Data API)
const SUPABASE_URL = "https://ipdenjiyngkwweklbdbf.supabase.co";
const SUPABASE_KEY = "sb_publishable_Lv560D7iNF9V_d35b-EEyA_FzbYF9od";

const WEBHOOK_URL   = "https://discord.com/api/webhooks/1552560280481833070/fM56DVf7LqtqifvuFinmTgpbhDatkxSHwXYWomq1cQKTjneYrGrmPdvSm3YQH8CHhb3b";
const ROLE_ID_MODOS = "1552559545828642868";   // "" = pas de ping
const MONNAIE       = "septims";

const INTENDANTS = [
  { nom: "Motuu",       coffre: "Coffre de Motuu",       lieux: ["Solitude", "Morthal", "Markarth"] },
  { nom: "Bérin Pépin", coffre: "Coffre de Bérin Pépin", lieux: ["Vendeaume", "Fort-Hiver", "Aubétoile", "Faillaise", "Blancherive", "Epervine"] },
];
const INSTITUTIONS = ["Thalmor", "Empire", "Académie des Mages"];

/* =========================================================
   Données
   - catalogue + historique : Supabase (partagés par tout le monde)
   - permanence en cours (saisie) : ce navigateur, jusqu'à clôture ou « vider »
   ========================================================= */
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

let state = { intendant: 0, lieu: "", date: today(), orders: [], draft: null };
let hist = [];
try { const s = JSON.parse(localStorage.getItem("perm_state")); if (s && Array.isArray(s.orders)) state = Object.assign(state, s); } catch {}
const save = () => { try { localStorage.setItem("perm_state", JSON.stringify(state)); } catch {} };
let editId = state.draft?.editId || null;
let restoring = false;

function statut(t) { $("dbStatus").textContent = t; }

/* ---------- Chargement depuis Supabase ---------- */
async function chargerCatalogue() {
  const tout = [];
  for (let de = 0; ; de += 1000) {                       // Supabase renvoie 1000 lignes max par appel
    const { data, error } = await sb.from("articles").select("*").order("ordre").order("id").range(de, de + 999);
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
    clotureLe: r.cloture_le, discord: r.discord, envoyeLe: r.envoye_le }));
  if (!$("viewHist").hidden) renderHist();
}

// Les autres pages ouvertes se mettent à jour toutes seules
let tCat = null, tHist = null;
sb.channel("maj")
  .on("postgres_changes", { event: "*", schema: "public", table: "articles" }, () => { clearTimeout(tCat); tCat = setTimeout(chargerCatalogue, 400); })
  .on("postgres_changes", { event: "*", schema: "public", table: "permanences" }, () => { clearTimeout(tHist); tHist = setTimeout(chargerHist, 400); })
  .subscribe();
// Filet de sécurité : rechargement quand on revient sur l'onglet
document.addEventListener("visibilitychange", () => { if (!document.hidden) { chargerCatalogue(); chargerHist(); } });

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
function showTab(t) {
  [["perm", "viewPerm", "tabPerm"], ["hist", "viewHist", "tabHist"], ["cat", "viewCat", "tabCat"]].forEach(([k, v, b]) => {
    $(v).hidden = t !== k; $(b).classList.toggle("on", t === k);
  });
  if (t === "hist") renderHist();
  if (t === "cat") renderCat();
  try { sessionStorage.setItem("tab", t); } catch {}
}
$("tabPerm").onclick = () => showTab("perm");
$("tabHist").onclick = () => showTab("hist");
$("tabCat").onclick = () => showTab("cat");

/* ---------- Permanence ---------- */
INTENDANTS.forEach((it, i) => $("intendant").add(new Option(it.nom, i)));
INSTITUTIONS.forEach(n => $("institutions").append(new Option(n)));

function majLieux() {
  const it = INTENDANTS[$("intendant").value];
  $("lieu").innerHTML = "";
  it.lieux.forEach(l => $("lieu").add(new Option(l, l)));
  if (it.lieux.includes(state.lieu)) $("lieu").value = state.lieu;
  state.intendant = +$("intendant").value; state.lieu = $("lieu").value; save();
  render();
}
$("intendant").value = state.intendant;
$("date").value = state.date || today();
$("intendant").onchange = majLieux;
$("lieu").onchange = () => { state.lieu = $("lieu").value; save(); };
$("date").onchange = () => { state.date = $("date").value; save(); };

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
  });
  restoring = false;
}

function ajouterLigne(x) {
  x = x || {};
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><select class="item"></select><select class="var" hidden style="margin-top:6px"></select></td>
    <td class="qty"><input type="number" class="q" min="1" value="${x.qte || 1}"></td>
    <td class="cost"></td>
    <td class="del"><button type="button" class="x" title="Retirer">×</button></td>`;
  remplirSelect(tr.querySelector(".item"), cle(x), x.nom);
  majVariante(tr, x.var);
  tr.querySelector(".var").onchange = calcForm;
  tr.querySelector(".x").onclick = () => { tr.remove(); if (!$("lines").tBodies[0].children.length) ajouterLigne(); calcForm(); };
  tr.querySelector(".item").onchange = e => { e.target.dataset.nom = ITEM[e.target.value]?.nom || ""; majVariante(tr); calcForm(); };
  tr.querySelector(".q").oninput = calcForm;
  $("lines").tBodies[0].append(tr);
  calcForm();
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

$("saveOrder").onclick = () => {
  const client = $("client").value.trim(), items = lignesForm();
  if (!client) return flash($("formMsg"), "Renseigne le nom du client.", false);
  if (!items.length) return flash($("formMsg"), "Ajoute au moins un article.", false);
  const absent = items.find(x => !ITEM[x.k]);
  if (absent) return flash($("formMsg"), `« ${absent.nom || "article"} » n'est pas (ou plus) dans le catalogue : retire la ligne.`, false);
  const sansVar = items.find(x => ITEM[x.k].variantes && !x.var);
  if (sansVar) return flash($("formMsg"), `Choisis la variante pour « ${sansVar.nom} ».`, false);
  const fig = items.map(x => { const a = ITEM[x.k]; return Object.assign(x, { nom: a.nom, prix: a.prix, fourni: a.fourni || "", cat: a.cat, id: (x.var ? a.varIds?.[x.var] : a.id) || "" }); });
  const o = { id: editId || Date.now().toString(36), client, type: $("clientType").value, notes: $("notes").value.trim(), items: fig };
  const edit = !!editId;
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
  return orders.map((o, i) => `<div class="order${permId && o.livreLe ? " livree" : ""}">
    <div class="order-head"><b>${i + 1}. ${esc(o.client)}</b><span class="hint">${esc(o.type)}</span>
      <span class="total" style="font-size:.9rem">${fmt(totalOrder(o))}</span></div>
    <ul>${o.items.map(x => { const a = infos(x); return `<li>${x.qte} × ${esc(lib(x))}${a.fourni ? ` <span class="hint">— fournit : ${esc(a.fourni)}${x.qte > 1 ? " (×" + x.qte + ")" : ""}</span>` : ""}</li>`; }).join("")}</ul>
    ${o.notes ? `<div class="meta">📝 ${esc(o.notes)}</div>` : ""}
    ${permId ? `<div class="row" style="margin-top:8px"><label class="liv"><input type="checkbox" data-liv="${esc(permId)}|${esc(o.id)}" ${o.livreLe ? "checked" : ""}> Livré</label>
      ${o.livreLe ? `<span class="hint">le ${new Date(o.livreLe).toLocaleString("fr-FR")}</span>` : ""}</div>` : ""}
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
  $("recap").innerHTML = state.orders.length ? htmlRecap(state.orders, INTENDANTS[state.intendant].coffre) : '<p class="empty">Le récapitulatif apparaîtra ici.</p>';
}

/* ---------- Discord ---------- */
function chunks(lines, max) {
  const out = []; let cur = "";
  lines.forEach(l => { if (cur && (cur + "\n" + l).length > max) { out.push(cur); cur = l; } else cur = cur ? cur + "\n" + l : l; });
  if (cur) out.push(cur);
  return out;
}

function recapTexte(p) {
  return `📦 **Commande à l'administration — Permanence ${p.lieu} — ${dateFR(p.date)}** (${p.intendant})
À déposer dans : **${p.coffre}**

${agreger(p.orders).map(x => `• ${x.qte} × ${x.nom} — ID : ${x.id || "⚠ manquant"}`).join("\n")}

Clients : ${p.orders.map(o => o.client).join(", ")}
Encaissé : ${fmt(totalPerm(p.orders))}`;
}

async function post(payload) {
  const r = await fetch(WEBHOOK_URL + "?wait=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("Discord a répondu " + r.status);
}

// Envoie une permanence (lève une erreur si ça échoue) — un seul message, sans détail par client
async function envoyerDiscord(p) {
  const ag = agreger(p.orders), nb = ag.reduce((s, x) => s + x.qte, 0);
  const titre = `Permanence ${p.lieu} — ${dateFR(p.date)}`;
  const embeds = chunks(ag.map(x => `\`${String(x.qte).padStart(3)}\` × **${x.nom}** — ID : ${x.id ? "`" + x.id + "`" : "⚠ manquant"}`), 3800).map((txt, i) => ({
    title: i === 0 ? `📦 Commande à l'administration — ${titre}` : "📦 (suite)", description: txt, color: 0x7a1f1a
  }));
  embeds[0].fields = [
    { name: "Intendant", value: p.intendant, inline: true },
    { name: "Coffre de dépôt", value: p.coffre, inline: true },
    { name: "Volume", value: `${p.orders.length} client(s) · ${nb} article(s)`, inline: true },
  ];
  const sansId = ag.filter(x => !x.id).length;
  if (sansId) embeds[0].fields.push({ name: "⚠ Attention", value: `${sansId} article(s) sans ID dans le catalogue`, inline: false });
  embeds[embeds.length - 1].footer = { text: `Encaissé : ${fmt(totalPerm(p.orders))}` };
  embeds[embeds.length - 1].timestamp = new Date().toISOString();
  await post({
    username: "Compagnie de l'Empire Oriental",
    content: ROLE_ID_MODOS ? `<@&${ROLE_ID_MODOS}> nouvelle commande de permanence` : "Nouvelle commande de permanence",
    allowed_mentions: { roles: ROLE_ID_MODOS ? [ROLE_ID_MODOS] : [] },
    embeds: embeds.slice(0, 10)
  });
}

function snapshot() {
  const it = INTENDANTS[state.intendant];
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), intendant: it.nom, coffre: it.coffre, lieu: state.lieu, date: state.date,
           orders: JSON.parse(JSON.stringify(state.orders)), clotureLe: new Date().toISOString(), discord: false };
}
const versPerm = p => ({ id: p.id, intendant: p.intendant, coffre: p.coffre, lieu: p.lieu, date: p.date || null, orders: p.orders,
  cloture_le: p.clotureLe, discord: !!p.discord, envoye_le: p.envoyeLe || null });

$("send").onclick = async () => {
  if (!state.orders.length) return flash($("sendMsg"), "Aucune commande dans cette permanence.", false);
  if (!state.date) return flash($("sendMsg"), "Renseigne la date.", false);
  if (!await confirmer(`Clôturer la permanence (${state.orders.length} client(s)) et commander aux administrateurs impériaux ?`)) return;

  const p = snapshot();
  $("send").disabled = true;
  // 1. archivage (obligatoire : sinon on ne vide rien)
  const { error } = await sb.from("permanences").insert(versPerm(p));
  if (error) { $("send").disabled = false; return flash($("sendMsg"), "Impossible d'archiver la permanence (" + error.message + "). Rien n'a été envoyé ni effacé, réessaie.", false); }
  // 2. envoi Discord
  let erreur = null;
  try { await envoyerDiscord(p); p.discord = true; p.envoyeLe = new Date().toISOString(); await sb.from("permanences").update({ discord: true, envoye_le: p.envoyeLe }).eq("id", p.id); }
  catch (e) { erreur = e.message; }
  // 3. permanence vidée
  state.orders = []; editId = null; state.draft = null; save();
  resetForm(); render(); chargerHist();
  $("send").disabled = false;

  if (!erreur) flash($("sendMsg"), "Commande transmise aux administrateurs impériaux ✔ Permanence clôturée et archivée dans l'historique.", true);
  else flash($("sendMsg"), `Permanence clôturée et archivée, mais pas transmise sur Discord (${erreur}). Tu pourras la renvoyer depuis l'onglet Historique.`, false);
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
  if (!await confirmer("Effacer toutes les commandes de cette permanence sans rien envoyer ?")) return;
  state.orders = []; state.draft = null; editId = null; save(); resetForm(); render();
};

/* ---------- Historique (Supabase) ---------- */
INTENDANTS.forEach(it => $("fInt").add(new Option(it.nom, it.nom)));
[...new Set(INTENDANTS.flatMap(it => it.lieux))].forEach(l => $("fLieu").add(new Option(l, l)));
$("fInt").onchange = $("fLieu").onchange = $("fClient").oninput = renderHist;

function renderHist() {
  const fi = $("fInt").value, fl = $("fLieu").value, fc = $("fClient").value.trim().toLowerCase();
  const list = hist.filter(p => (!fi || p.intendant === fi) && (!fl || p.lieu === fl) &&
    (!fc || p.orders.some(o => o.client.toLowerCase().includes(fc))));
  const box = $("hist");
  if (!hist.length) { box.innerHTML = '<p class="empty">Aucune permanence clôturée pour l\'instant.</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="empty">Aucune permanence ne correspond aux filtres.</p>'; return; }
  const ouverts = new Set([...box.querySelectorAll("details[open]")].map(d => d.dataset.id));
  box.innerHTML = list.map(p => {
    const nb = p.orders.reduce((s, o) => s + o.items.reduce((t, x) => t + x.qte, 0), 0);
    const liv = p.orders.filter(o => o.livreLe).length, fini = liv === p.orders.length;
    return `<details class="perm ${fini ? "done" : "pending"}" data-id="${esc(p.id)}" ${ouverts.has(p.id) ? "open" : ""}>
      <summary><b>${esc(p.lieu)} — ${dateFR(p.date)}</b><span class="hint">${esc(p.intendant)} · ${p.orders.length} client(s) · ${nb} article(s)</span>
        ${p.discord ? '<span class="tag ok">Transmise</span>' : '<span class="tag err">Non transmise</span>'}
        <span class="tag ${fini ? "ok" : ""}">${fini ? "✔ Tout livré" : `Livré ${liv}/${p.orders.length}`}</span>
        <span class="total" style="font-size:.9rem">${fmt(totalPerm(p.orders))}</span></summary>
      <div class="body">
        <div class="hint">Clôturée le ${new Date(p.clotureLe).toLocaleString("fr-FR")}${p.discord && p.envoyeLe ? " — transmise le " + new Date(p.envoyeLe).toLocaleString("fr-FR") : ""}</div>
        <h3>Commandé à l'administration</h3>${htmlRecap(p.orders, p.coffre)}
        <h3>Commandes détaillées</h3>${htmlCommandes(p.orders, false, p.id)}
        <div class="row" style="margin-top:8px">${p.discord ? "" : `<button class="btn small primary" data-hs="${esc(p.id)}">Transmettre aux administrateurs</button>`}<button class="btn small" data-hc="${esc(p.id)}">Copier le récap</button><button class="btn small" data-hd="${esc(p.id)}">Supprimer de l'historique</button></div>
        <div class="msg" id="hm-${esc(p.id)}"></div>
      </div></details>`;
  }).join("");
  box.querySelectorAll("[data-liv]").forEach(c => c.onchange = async () => {
    const [pid, oid] = c.dataset.liv.split("|");
    const p = hist.find(x => x.id === pid), o = p.orders.find(x => x.id === oid);
    o.livreLe = c.checked ? new Date().toISOString() : null;
    renderHist();
    const { error } = await sb.from("permanences").update({ orders: p.orders }).eq("id", pid);
    if (error) { flash($("hm-" + pid), "Non enregistré : " + error.message, false); chargerHist(); }
  });
  box.querySelectorAll("[data-hc]").forEach(b => b.onclick = () => copier(recapTexte(hist.find(p => p.id === b.dataset.hc)), $("hm-" + b.dataset.hc)));
  box.querySelectorAll("[data-hs]").forEach(b => b.onclick = async () => {
    const p = hist.find(x => x.id === b.dataset.hs);
    b.disabled = true;
    try {
      await envoyerDiscord(p);
      p.discord = true; p.envoyeLe = new Date().toISOString();
      await sb.from("permanences").update({ discord: true, envoye_le: p.envoyeLe }).eq("id", p.id);
      renderHist();
    } catch (e) {
      b.disabled = false;
      flash($("hm-" + p.id), "Échec de l'envoi (" + e.message + ").", false);
    }
  });
  box.querySelectorAll("[data-hd]").forEach(b => b.onclick = async () => {
    if (!await confirmer("Supprimer cette permanence de l'historique (pour tout le monde) ?")) return;
    const { error } = await sb.from("permanences").delete().eq("id", b.dataset.hd);
    if (error) return flash($("hm-" + b.dataset.hd), "Suppression impossible : " + error.message, false);
    hist = hist.filter(p => p.id !== b.dataset.hd); renderHist();
  });
}

/* ---------- Gestion du catalogue (Supabase) ---------- */
let catEdit = null;   // clé de l'article en cours de modification

function resetCatForm() {
  catEdit = null;
  ["cCat", "cNom", "cPrix", "cId", "cFourni", "cVar", "cNote"].forEach(id => $(id).value = "");
  $("catFormTitle").textContent = "Ajouter un article";
  $("cSave").textContent = "Ajouter au catalogue";
  $("cCancel").style.display = "none";
  $("catFormCard").classList.remove("editing");
}
$("cCancel").onclick = resetCatForm;

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
  // "Blanc = 0A1B2C, Bleu" -> variantes + varIds
  const ancien = catEdit ? ITEM[catEdit] : null;
  const vars = [], varIds = {};
  $("cVar").value.split(",").map(x => x.trim()).filter(Boolean).forEach(v => {
    const [n, ...r] = v.split("="); const nomV = n.trim(), idV = r.join("=").trim();
    if (!nomV || vars.includes(nomV)) return;
    vars.push(nomV);
    const garde = idV || ancien?.varIds?.[nomV] || "";
    if (garde) varIds[nomV] = garde;
  });
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
    $("cVar").value = (a.variantes || []).map(v => a.varIds?.[v] ? `${v} = ${a.varIds[v]}` : v).join(", ");
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

/* ---------- Démarrage ---------- */
majLieux();
chargerForm(state.draft);
render();
let t0 = "perm"; try { t0 = sessionStorage.getItem("tab") || "perm"; } catch {}
showTab(t0);
if (SUPABASE_URL.includes("XXXXXXXX")) statut("⚠ Renseigne SUPABASE_URL et SUPABASE_KEY en haut de script.js.");
else { chargerCatalogue(); chargerHist(); }