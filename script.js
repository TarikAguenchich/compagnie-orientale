/* =========================================================
   CONFIG
   ========================================================= */
const WEBHOOK_URL   = "https://discord.com/api/webhooks/XXXXXXXX/YYYYYYYY";
const ROLE_ID_MODOS = "123456789012345678";   // "" = pas de ping
const MONNAIE       = "septims";

const INTENDANTS = [
  { nom: "Motuu",       coffre: "Coffre de Motuu",       lieux: ["Solitude", "Morthal", "Markarth"] },
  { nom: "Bérin Pépin", coffre: "Coffre de Bérin Pépin", lieux: ["Vendeaume", "Fort-Hiver", "Aubétoile", "Faillaise", "Blancherive", "Epervine"] },
];
const INSTITUTIONS = ["Thalmor", "Empire", "Académie des Mages"];

// Coloris Moon Monk (communs aux 4 pièces)
const MOON_MONK = [
  "Basique", "Grandeur de Ra'Kazra", "Fierté d'Alkosh", "Flamme de Nahflaar",
  "Respiration de Khenarthi", "Regal", "Aube d'Anequina", "L'ombre de Rahjiin",
  "Clan de l'eau", "Assassins", "Émissaire impérial", "Lumière de Jone",
];

// prix = septims ; fourni = ce que le client doit apporter en plus ("" si rien)
// variantes = liste facultative (coloris...) : une 2e liste apparaît dans la ligne
// note = avertissement facultatif affiché à côté du coût
const CATALOGUE = [
  // Plates nordiques
  { cat: "Plates nordiques", nom: "Casque nordique de plates",    fourni: "Casque d'acier",    prix: 3000 },
  { cat: "Plates nordiques", nom: "Armure nordique de plates",    fourni: "Armure d'acier",    prix: 6000 },
  { cat: "Plates nordiques", nom: "Gantelets nordiques de plates",fourni: "Gantelets d'acier", prix: 3000 },
  { cat: "Plates nordiques", nom: "Bottes nordiques de plates",   fourni: "Bottes d'acier",    prix: 3000 },
  { cat: "Plates nordiques", nom: "Bouclier nordique de plates",  fourni: "Bouclier d'acier",  prix: 4000 },
  // Plates
  { cat: "Plates", nom: "Casque de plates",               fourni: "Casque d'acier",    prix: 3500 },
  { cat: "Plates", nom: "Armure de plates (sans robe)",   fourni: "Armure d'acier",    prix: 6000 },
  { cat: "Plates", nom: "Robed steel plate armor",        fourni: "Armure d'acier",    prix: 7500 },
  { cat: "Plates", nom: "Gantelets de plates",            fourni: "Gantelets d'acier", prix: 3500 },
  { cat: "Plates", nom: "Bottes de plates",               fourni: "Bottes d'acier",    prix: 3500 },
  { cat: "Plates", nom: "Casque de plates d'Ours",        fourni: "Casque d'acier",    prix: 3500 },
  { cat: "Plates", nom: "Armure de plates d'Ours (Homme uniquement)", fourni: "Armure d'acier", prix: 6000 },
  // Plates ornées
  { cat: "Plates ornées", nom: "Casque de plates orné",    fourni: "Casque de plates + 25 lingots d'or",    prix: 3000 },
  { cat: "Plates ornées", nom: "Armure de plates ornée",   fourni: "Armure de plates + 50 lingots d'or",    prix: 3000 },
  { cat: "Plates ornées", nom: "Gantelets de plates ornés",fourni: "Gantelets de plates + 25 lingots d'or", prix: 3000 },
  { cat: "Plates ornées", nom: "Bottes de plates ornées",  fourni: "Bottes de plates + 25 lingots d'or",    prix: 3000 },
  // Rugged plate
  { cat: "Rugged Plate", nom: "Rugged Plate Helmet",    fourni: "Casque d'acier",    prix: 3000 },
  { cat: "Rugged Plate", nom: "Rugged Plate Armor",     fourni: "Armure d'acier",    prix: 6000 },
  { cat: "Rugged Plate", nom: "Rugged Plate Gauntlets", fourni: "Gantelets d'acier", prix: 3000 },
  { cat: "Rugged Plate", nom: "Rugged Plate Boots",     fourni: "Bottes d'acier",    prix: 3000 },
  // Orsimer
  { cat: "Orsimer", nom: "Orcish Warchief Armor (plastron uniquement)", fourni: "", prix: 3000 },
  // Verre (Vvardenfell)
  { cat: "Verre (Vvardenfell)", nom: "Casque de verre (Vvardenfell)",    fourni: "", prix: 12375 },
  { cat: "Verre (Vvardenfell)", nom: "Armure de verre (Vvardenfell)",    fourni: "", prix: 22500 },
  { cat: "Verre (Vvardenfell)", nom: "Gantelets de verre (Vvardenfell)", fourni: "", prix: 9000 },
  { cat: "Verre (Vvardenfell)", nom: "Bottes de verre (Vvardenfell)",    fourni: "", prix: 12375 },
  { cat: "Verre (Vvardenfell)", nom: "Bouclier de verre (Vvardenfell)",  fourni: "", prix: 21375 },
  // Verre
  { cat: "Verre", nom: "Casque de verre",    fourni: "", prix: 12375 },
  { cat: "Verre", nom: "Armure de verre",    fourni: "", prix: 22500 },
  { cat: "Verre", nom: "Gantelets de verre", fourni: "", prix: 9000 },
  { cat: "Verre", nom: "Bottes de verre",    fourni: "", prix: 12375 },
  { cat: "Verre", nom: "Bouclier de verre",  fourni: "", prix: 21375 },
  // Armes de verre
  { cat: "Armes de verre", nom: "Dague de verre",          fourni: "", prix: 7875 },
  { cat: "Armes de verre", nom: "Épée de verre",           fourni: "", prix: 9000 },
  { cat: "Armes de verre", nom: "Hache de verre",          fourni: "", prix: 9000 },
  { cat: "Armes de verre", nom: "Masse de verre",          fourni: "", prix: 12375 },
  { cat: "Armes de verre", nom: "Arc de verre",            fourni: "", prix: 12375 },
  { cat: "Armes de verre", nom: "Espadon de verre",        fourni: "", prix: 13500 },
  { cat: "Armes de verre", nom: "Hache d'armes de verre",  fourni: "", prix: 13500 },
  { cat: "Armes de verre", nom: "Marteau de verre",        fourni: "", prix: 18000 },
  // Northern Scaled
  { cat: "Nordique — Northern Scaled", nom: "Northern Scaled Helmet",          fourni: "", prix: 2000 },
  { cat: "Nordique — Northern Scaled", nom: "Northern Scaled Armor",           fourni: "", prix: 3000 },
  { cat: "Nordique — Northern Scaled", nom: "Northern Scaled Armor (Gravée)",  fourni: "", prix: 4000 },
  { cat: "Nordique — Northern Scaled", nom: "Northern Scaled Gauntlets",       fourni: "", prix: 2000 },
  { cat: "Nordique — Northern Scaled", nom: "Northern Scaled Boots/Greaves",   fourni: "", prix: 2000 },
  // Nordic Carved
  { cat: "Nordique — Nordic Carved", nom: "Nordic Carved Helmet",   fourni: "", prix: 67000 },
  { cat: "Nordique — Nordic Carved", nom: "Nordic Carved Armor",    fourni: "", prix: 71000 },
  { cat: "Nordique — Nordic Carved", nom: "Nordic Carved Gauntlet", fourni: "", prix: 66000 },
  { cat: "Nordique — Nordic Carved", nom: "Nordic Carved Boots",    fourni: "", prix: 66000 },
  { cat: "Nordique — Nordic Carved", nom: "Nordic Shield",          fourni: "", prix: 9000 },
  // Rugged Scales
  { cat: "Nordique — Rugged Scales", nom: "Rugged Scales Helmet",    fourni: "", prix: 1500 },
  { cat: "Nordique — Rugged Scales", nom: "Rugged Scales Armor",     fourni: "", prix: 2500 },
  { cat: "Nordique — Rugged Scales", nom: "Rugged Scales Gauntlets", fourni: "", prix: 1500 },
  { cat: "Nordique — Rugged Scales", nom: "Rugged Scales Boots",     fourni: "", prix: 1500 },
  // Nordique divers
  { cat: "Nordique — Divers", nom: "Armure de l'Ours",                 fourni: "", prix: 1500 },
  { cat: "Nordique — Divers", nom: "Casque de l'Ours",                 fourni: "", prix: 1000 },
  { cat: "Nordique — Divers", nom: "Casque nordique de l'Ours",        fourni: "", prix: 1000 },
  { cat: "Nordique — Divers", nom: "Casque ancien de l'Ours",          fourni: "", prix: 1500 },
  { cat: "Nordique — Divers", nom: "Armure de cuir renforcée (Homme uniquement)", fourni: "", prix: 250 },
  { cat: "Nordique — Divers", nom: "Chapeau en cuir renforcé",         fourni: "", prix: 150 },
  { cat: "Nordique — Divers", nom: "Chapeau en fer renforcé",          fourni: "", prix: 200 },
  { cat: "Nordique — Divers", nom: "Chapeau en écailles renforcé",     fourni: "", prix: 150 },
  { cat: "Nordique — Divers", nom: "Casque raccourci en acier",        fourni: "", prix: 150 },
  { cat: "Nordique — Divers", nom: "Bottes nordiques en acier",        fourni: "", prix: 200 },
  // Armes nordiques
  { cat: "Nordique — Armes", nom: "Dague nordique",               fourni: "", prix: 7500 },
  { cat: "Nordique — Armes", nom: "Arme nordique à une main",     fourni: "", prix: 8500 },
  { cat: "Nordique — Armes", nom: "Arc nordique",                 fourni: "", prix: 9500 },
  { cat: "Nordique — Armes", nom: "Arme nordique à deux mains",   fourni: "", prix: 10000 },
  // ===== VÊTEMENTS =====
  // Tenue de Skaal
  { cat: "Vêtements — Skaal", nom: "Chapeau de Skaal",  fourni: "", prix: 1000 },
  { cat: "Vêtements — Skaal", nom: "Manteau de Skaal",  fourni: "", prix: 2000 },
  { cat: "Vêtements — Skaal", nom: "Gants de Skaal",    fourni: "", prix: 1000 },
  { cat: "Vêtements — Skaal", nom: "Bottes de Skaal",   fourni: "", prix: 1000 },
  // Ulfric
  { cat: "Vêtements — Ulfric", nom: "Vêtements d'Ulfric", fourni: "", prix: 7500 },
  { cat: "Vêtements — Ulfric", nom: "Gantelets d'Ulfric", fourni: "", prix: 5000 },
  { cat: "Vêtements — Ulfric", nom: "Bottes d'Ulfric",    fourni: "", prix: 5000 },
  // Mariage
  { cat: "Vêtements — Mariage", nom: "Couronne de mariée",  fourni: "", prix: 1300 },
  { cat: "Vêtements — Mariage", nom: "Robe de mariée",      fourni: "", prix: 1600 },
  { cat: "Vêtements — Mariage", nom: "Sandales de mariée",  fourni: "", prix: 1300 },
  { cat: "Vêtements — Mariage", nom: "Alliance",            fourni: "", prix: 1500 },
  // Sacs
  { cat: "Vêtements — Sacs", nom: "Glowdust Gem Backpack", fourni: "Reinforced Backpack + 20 Soul Gems", prix: 4500,
    variantes: ["Blanc", "Bleu", "Violet"] },
  // Hammerfell
  { cat: "Vêtements — Hammerfell", nom: "Capuchon d'Alik'r",           fourni: "", prix: 650 },
  { cat: "Vêtements — Hammerfell", nom: "Dark Hammerfell Garb (rouge)", fourni: "", prix: 650 },
  { cat: "Vêtements — Hammerfell", nom: "Atours de Lenclume (bleu)",    fourni: "", prix: 650 },
  { cat: "Vêtements — Hammerfell", nom: "Bottes de Rougegarde",         fourni: "", prix: 650 },
  // Tenues civiles
  { cat: "Vêtements — Civils", nom: "Vêtements de Paysan",           fourni: "", prix: 50 },
  { cat: "Vêtements — Civils", nom: "Vêtements de Paysan bourgeois", fourni: "", prix: 50 },
  { cat: "Vêtements — Civils", nom: "Vêtements de Marchand",         fourni: "", prix: 90 },
  { cat: "Vêtements — Civils", nom: "Vêtements de Noble",            fourni: "", prix: 3000 },
  { cat: "Vêtements — Civils", nom: "Habits de nobles divers",       fourni: "", prix: 5000 },
  // Peaux & fourrures
  { cat: "Vêtements — Peaux", nom: "Fourrure",            fourni: "", prix: 20 },
  { cat: "Vêtements — Peaux", nom: "Peau d'ours",         fourni: "", prix: 250 },
  { cat: "Vêtements — Peaux", nom: "Peau ornée",          fourni: "", prix: 250 },
  { cat: "Vêtements — Peaux", nom: "Peau raffinée",       fourni: "", prix: 500 },
  { cat: "Vêtements — Peaux", nom: "Peau raffinée grise", fourni: "", prix: 500 },
  { cat: "Vêtements — Peaux", nom: "Fourrure royale",     fourni: "", prix: 2500 },
  // Moon Monk
  { cat: "Vêtements — Moon Monk", nom: "Moon Monk Mask",      fourni: "", prix: 1500, variantes: MOON_MONK },
  { cat: "Vêtements — Moon Monk", nom: "Moon Monk Robes",     fourni: "", prix: 1500, variantes: MOON_MONK },
  { cat: "Vêtements — Moon Monk", nom: "Moon Monk Boots",     fourni: "", prix: 1500, variantes: MOON_MONK },
  { cat: "Vêtements — Moon Monk", nom: "Moon Monk Gauntlets", fourni: "", prix: 1500, variantes: MOON_MONK },
  // Gothiques
  { cat: "Vêtements — Gothiques", nom: "Capuchon de vampire", fourni: "", prix: 2500 },
  { cat: "Vêtements — Gothiques", nom: "Armure de vampire",   fourni: "", prix: 4500 },
  { cat: "Vêtements — Gothiques", nom: "Robe de vampire",     fourni: "", prix: 2000 },
  { cat: "Vêtements — Gothiques", nom: "Gants de vampire",    fourni: "", prix: 2500 },
  { cat: "Vêtements — Gothiques", nom: "Bottes de vampire",   fourni: "", prix: 2500 },
  // Bijoux & accessoires
  { cat: "Vêtements — Bijoux", nom: "Couronne d'or ornée d'émeraude", fourni: "", prix: 3000 },
  { cat: "Vêtements — Bijoux", nom: "Anneau d'aigle osseux",          fourni: "", prix: 4000 },
  { cat: "Vêtements — Bijoux", nom: "Amulette d'aigle osseux",        fourni: "", prix: 4000 },
  // ===== ALCOOL =====
  { cat: "Alcool", nom: "Course-Falaise",           fourni: "Bière", prix: 40 },
  { cat: "Alcool", nom: "Vin des frères Surilies",   fourni: "Vin",   prix: 35 },
  { cat: "Alcool", nom: "Matze",                    fourni: "Vin",   prix: 50 },
  { cat: "Alcool", nom: "Tour d'Or Blanc",          fourni: "Vin",   prix: 55 },
  { cat: "Alcool", nom: "Vin épicé",                fourni: "Vin",   prix: 110 },
  { cat: "Alcool", nom: "Eau-de-vie de Cyrodiil",   fourni: "Vin",   prix: 40 },
  { cat: "Alcool", nom: "Sujamma",                  fourni: "",      prix: 60 },
  { cat: "Alcool", nom: "Vin de Tisebraise",        fourni: "Vin",   prix: 50 },
  { cat: "Alcool", nom: "Shein",                    fourni: "Vin",   prix: 50 },
  { cat: "Alcool", nom: "Vin alto",                 fourni: "Vin",   prix: 45 },
  { cat: "Alcool", nom: "Rhum de Stross M'kai",      fourni: "",      prix: 50 },
  { cat: "Alcool", nom: "Vin de Sang Argonien",     fourni: "Vin",   prix: 50 },
  { cat: "Alcool", nom: "Colodvie",                 fourni: "Vin",   prix: 70 },
  { cat: "Alcool", nom: "Flin",                     fourni: "Vin",   prix: 50 },
  { cat: "Alcool", nom: "Vin-de-feu",               fourni: "Vin",   prix: 350 },
  { cat: "Alcool", nom: "Vin de Jessica",           fourni: "Vin",   prix: 60 },
  // ===== POTIONS =====
  { cat: "Potions", nom: "Potion de soins profuse",           fourni: "", prix: 50 },
  { cat: "Potions", nom: "Potion de vigueur profuse",         fourni: "", prix: 50 },
  { cat: "Potions", nom: "Potion de magie profuse",           fourni: "", prix: 50 },
  { cat: "Potions", nom: "Élixir de respiration aquatique",   fourni: "", prix: 500 },
  { cat: "Potions", nom: "Potion d'invisibilité prolongée",   fourni: "", prix: 1500 },
  // ===== NOURRITURE =====
  { cat: "Nourriture", nom: "Boeuf épicé",               fourni: "", prix: 12 },
  { cat: "Nourriture", nom: "Igname des Cendres",       fourni: "", prix: 10 },
  { cat: "Nourriture", nom: "Viande cuite de sanglier", fourni: "", prix: 10 },
  { cat: "Nourriture", nom: "Madeleine",                fourni: "", prix: 5 },
  // ===== JOAILLERIE =====
  { cat: "Joaillerie", nom: "Saphir (parfait)",     fourni: "Saphir",   prix: 450 },
  { cat: "Joaillerie", nom: "Saphir (exquis)",      fourni: "Saphir",   prix: 800 },
  { cat: "Joaillerie", nom: "Grenat (parfait)",     fourni: "Grenat",   prix: 500 },
  { cat: "Joaillerie", nom: "Rubis (parfait)",      fourni: "Rubis",    prix: 850 },
  { cat: "Joaillerie", nom: "Émeraude (parfaite)",  fourni: "Émeraude", prix: 1250 },
  { cat: "Joaillerie", nom: "Améthyste (parfaite)", fourni: "Améthyste",prix: 850 },
  { cat: "Joaillerie", nom: "Diamant",              fourni: "",         prix: 1200 },
  { cat: "Joaillerie", nom: "Diamant (parfait)",    fourni: "Diamant",  prix: 2800 },
  // ===== INGRÉDIENTS ALCHIMIQUES =====
  { cat: "Ingrédients alchimiques", nom: "Sucrelune x50",       fourni: "", prix: 1000 },
  { cat: "Ingrédients alchimiques", nom: "Sel de feu x30",      fourni: "", prix: 1000 },
  { cat: "Ingrédients alchimiques", nom: "Sel de givre x30",    fourni: "", prix: 1000 },
  { cat: "Ingrédients alchimiques", nom: "Sel du Néant x30",    fourni: "", prix: 2000 },
  { cat: "Ingrédients alchimiques", nom: "Œil de smilodon x10", fourni: "", prix: 1750 },
  { cat: "Ingrédients alchimiques", nom: "Rayon de miel x50",   fourni: "", prix: 600 },
  { cat: "Ingrédients alchimiques", nom: "Choucard x30",        fourni: "", prix: 300 },
  // ===== MINERAIS =====
  { cat: "Minerais", nom: "Malachite brute",          fourni: "", prix: 750 },
  { cat: "Minerais", nom: "Vif-argent brute",          fourni: "", prix: 550 },
  { cat: "Minerais", nom: "Lingot de métal dwemer",   fourni: "", prix: 600 },
  { cat: "Minerais", nom: "Ébonite brute",            fourni: "", prix: 20000, note: "Max 4 par semaine / licence" },
  { cat: "Minerais", nom: "Pierre de lune brute",     fourni: "", prix: 350 },
  // ===== AUTRES =====
  { cat: "Autres", nom: "Masque de bois",           fourni: "",                          prix: 50000 },
  { cat: "Autres", nom: "Épée en bois",             fourni: "10 Clous",                  prix: 50 },
  { cat: "Autres", nom: "Arbalète",                 fourni: "",                          prix: 2000 },
  { cat: "Autres", nom: "Capuchon d'exécution",     fourni: "",                          prix: 250 },
  { cat: "Autres", nom: "Livres divers",            fourni: "",                          prix: 500 },
  { cat: "Autres", nom: "Amulette nordique antique",fourni: "",                          prix: 4000 },
  { cat: "Autres", nom: "Carreaux d'acier x80",     fourni: "",                          prix: 400 },
  { cat: "Autres", nom: "Casque de berserk",        fourni: "Casque en fourrure + Peau d'ours", prix: 500 },
  { cat: "Autres", nom: "Torche x10",               fourni: "20 Petit bois",             prix: 100 },
];

/* =========================================================
   État + stockage local
   La permanence en cours (commandes + saisie en cours) reste
   enregistrée tant qu'on ne vide pas / ne clôture pas.
   ========================================================= */
const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("fr-FR") + " " + MONNAIE;
const ITEM = Object.fromEntries(CATALOGUE.map(a => [a.nom, a]));
const lib = x => x.nom + (x.var ? " — " + x.var : "");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dateFR = s => s ? s.split("-").reverse().join("/") : "";

let state = { intendant: 0, lieu: "", date: today(), orders: [], draft: null };
let hist = [];
try { const s = JSON.parse(localStorage.getItem("perm_state")); if (s && Array.isArray(s.orders)) state = Object.assign(state, s); } catch {}
try { const h = JSON.parse(localStorage.getItem("perm_hist")); if (Array.isArray(h)) hist = h.map(p => ("discord" in p) ? p : Object.assign(p, { discord: true })); } catch {}
const save = () => { try { localStorage.setItem("perm_state", JSON.stringify(state)); } catch {} };
const saveHist = () => { try { localStorage.setItem("perm_hist", JSON.stringify(hist)); } catch {} };
let editId = state.draft?.editId || null;
let restoring = false;

/* ---------- Confirmation dans la page (confirm() est bloqué dans certains aperçus) ---------- */
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
  $("viewPerm").hidden = t !== "perm"; $("viewHist").hidden = t !== "hist";
  $("tabPerm").classList.toggle("on", t === "perm"); $("tabHist").classList.toggle("on", t === "hist");
  if (t === "hist") renderHist();
  try { sessionStorage.setItem("tab", t); } catch {}
}
$("tabPerm").onclick = () => showTab("perm");
$("tabHist").onclick = () => showTab("hist");

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
function remplirSelect(sel, garder) {
  sel.innerHTML = "";
  sel.add(new Option("— choisir un article —", ""));
  let cur = null, g = null;
  CATALOGUE.forEach(a => {
    if (a.cat !== cur) { g = document.createElement("optgroup"); g.label = a.cat; sel.append(g); cur = a.cat; }
    g.append(new Option(a.nom, a.nom));
  });
  if (garder) sel.value = garder;
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

function ajouterLigne(nom, qte, variante) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><select class="item"></select><select class="var" hidden style="margin-top:6px"></select></td>
    <td class="qty"><input type="number" class="q" min="1" value="${qte || 1}"></td>
    <td class="cost"></td>
    <td class="del"><button type="button" class="x" title="Retirer">×</button></td>`;
  remplirSelect(tr.querySelector(".item"), nom || "");
  majVariante(tr, variante);
  tr.querySelector(".var").onchange = calcForm;
  tr.querySelector(".x").onclick = () => { tr.remove(); if (!$("lines").tBodies[0].children.length) ajouterLigne(); calcForm(); };
  tr.querySelector(".item").onchange = () => { majVariante(tr); calcForm(); };
  tr.querySelector(".q").oninput = calcForm;
  $("lines").tBodies[0].append(tr);
  calcForm();
}
$("addLine").onclick = () => ajouterLigne();

function lignesBrutes() {
  return [...document.querySelectorAll("#lines tbody tr")].map(tr => ({ nom: tr.querySelector(".item").value, var: tr.querySelector(".var").value, qte: parseInt(tr.querySelector(".q").value, 10) || 1 }));
}
function lignesForm() {
  const m = new Map();
  lignesBrutes().forEach(x => {
    if (!x.nom || !(x.qte > 0)) return;
    const k = x.nom + "|" + (x.var || "");
    m.set(k, (m.get(k) || 0) + x.qte);
  });
  return [...m].map(([k, qte]) => { const [nom, v] = k.split("|"); return v ? { nom, var: v, qte } : { nom, qte }; });
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
  const ls = d?.lines?.length ? d.lines : [{ nom: "", qte: 1 }];
  ls.forEach(x => ajouterLigne(x.nom, x.qte, x.var));
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
  const sansVar = items.find(x => ITEM[x.nom]?.variantes && !x.var);
  if (sansVar) return flash($("formMsg"), `Choisis la variante pour « ${sansVar.nom} ».`, false);
  const o = { id: editId || Date.now().toString(36), client, type: $("clientType").value, notes: $("notes").value.trim(), items };
  const edit = !!editId;
  if (edit) state.orders = state.orders.map(x => x.id === editId ? o : x);
  else state.orders.push(o);
  save();
  flash($("formMsg"), `Commande de ${client} ${edit ? "modifiée" : "ajoutée"}.`, true);
  resetForm(); render();
  $("client").focus();
};

/* ---------- Calculs ---------- */
const totalOrder = o => o.items.reduce((s, x) => s + (ITEM[x.nom]?.prix || 0) * x.qte, 0);
const totalPerm = orders => orders.reduce((s, o) => s + totalOrder(o), 0);
function agreger(orders) {
  const m = new Map();
  orders.forEach(o => o.items.forEach(x => {
    const k = lib(x);
    if (!m.has(k)) m.set(k, { nom: k, base: x.nom, var: x.var || "", qte: 0, cat: ITEM[x.nom]?.cat || "—" });
    m.get(k).qte += x.qte;
  }));
  const ordre = n => { const i = CATALOGUE.findIndex(a => a.nom === n); return i < 0 ? 9999 : i; };
  return [...m.values()].sort((a, b) => ordre(a.base) - ordre(b.base) || a.var.localeCompare(b.var));
}

/* ---------- Rendu (partagé avec l'historique) ---------- */
function htmlCommandes(orders, actions, permId) {
  return orders.map((o, i) => `<div class="order${permId && o.livreLe ? " livree" : ""}">
    <div class="order-head"><b>${i + 1}. ${esc(o.client)}</b><span class="hint">${esc(o.type)}</span>
      <span class="total" style="font-size:.9rem">${fmt(totalOrder(o))}</span></div>
    <ul>${o.items.map(x => { const a = ITEM[x.nom]; return `<li>${x.qte} × ${esc(lib(x))}${a && a.fourni ? ` <span class="hint">— fournit : ${esc(a.fourni)}${x.qte > 1 ? " (×" + x.qte + ")" : ""}</span>` : ""}</li>`; }).join("")}</ul>
    ${o.notes ? `<div class="meta">📝 ${esc(o.notes)}</div>` : ""}
    ${permId ? `<div class="row" style="margin-top:8px"><label class="liv"><input type="checkbox" data-liv="${permId}|${o.id}" ${o.livreLe ? "checked" : ""}> Livré</label>
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

${agreger(p.orders).map(x => `• ${x.qte} × ${x.nom}`).join("\n")}

Clients : ${p.orders.map(o => o.client).join(", ")}
Encaissé : ${fmt(totalPerm(p.orders))}`;
}

async function post(payload) {
  const r = await fetch(WEBHOOK_URL + "?wait=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error("Discord a répondu " + r.status);
}

function snapshot() {
  const it = INTENDANTS[state.intendant];
  return { id: Date.now().toString(36), intendant: it.nom, coffre: it.coffre, lieu: state.lieu, date: state.date,
           orders: JSON.parse(JSON.stringify(state.orders)), clotureLe: new Date().toISOString(), discord: false };
}

// Envoie une permanence sur Discord (lève une erreur si ça échoue)
async function envoyerDiscord(p) {
  const ag = agreger(p.orders), nb = ag.reduce((s, x) => s + x.qte, 0);
  const titre = `Permanence ${p.lieu} — ${dateFR(p.date)}`;
  const embeds = chunks(ag.map(x => `\`${String(x.qte).padStart(3)}\` × ${x.nom}`), 3800).map((txt, i) => ({
    title: i === 0 ? `📦 Commande à l'administration — ${titre}` : "📦 (suite)", description: txt, color: 0x7a1f1a
  }));
  embeds[0].fields = [
    { name: "Intendant", value: p.intendant, inline: true },
    { name: "Coffre de dépôt", value: p.coffre, inline: true },
    { name: "Volume", value: `${p.orders.length} client(s) · ${nb} article(s)`, inline: true },
  ];
  embeds[embeds.length - 1].footer = { text: `Encaissé : ${fmt(totalPerm(p.orders))}` };
  embeds[embeds.length - 1].timestamp = new Date().toISOString();
  const detail = chunks(p.orders.map((o, i) =>
    `**${i + 1}. ${o.client}** *(${o.type})* — ${fmt(totalOrder(o))}\n` +
    o.items.map(x => `  ${x.qte} × ${lib(x)}`).join("\n") + (o.notes ? `\n  📝 ${o.notes}` : "")), 3800);

  await post({
    username: "Compagnie de l'Empire Oriental",
    content: ROLE_ID_MODOS ? `<@&${ROLE_ID_MODOS}> nouvelle commande de permanence` : "Nouvelle commande de permanence",
    allowed_mentions: { roles: ROLE_ID_MODOS ? [ROLE_ID_MODOS] : [] },
    embeds: embeds.slice(0, 10)
  });
  for (let i = 0; i < detail.length; i++) {
    await post({ username: "Compagnie de l'Empire Oriental", allowed_mentions: { parse: [] },
      embeds: [{ title: i === 0 ? `🧾 Détail par client — ${titre}` : "🧾 (suite)", description: detail[i], color: 0x6d5d49 }] });
  }
}

$("send").onclick = async () => {
  if (!state.orders.length) return flash($("sendMsg"), "Aucune commande dans cette permanence.", false);
  if (!state.date) return flash($("sendMsg"), "Renseigne la date.", false);
  if (!await confirmer(`Clôturer la permanence (${state.orders.length} client(s)) et envoyer la commande à l'administration ?`)) return;

  const p = snapshot();
  $("send").disabled = true;
  let erreur = null;
  try { await envoyerDiscord(p); p.discord = true; p.envoyeLe = new Date().toISOString(); }
  catch (e) { erreur = e.message; }

  // Dans tous les cas : archivage + permanence vidée
  hist.unshift(p); saveHist();
  state.orders = []; editId = null; state.draft = null; save();
  resetForm(); render();
  $("send").disabled = false;

  if (!erreur) flash($("sendMsg"), "Commande envoyée à l'administration ✔ Permanence clôturée et archivée dans l'historique.", true);
  else flash($("sendMsg"), `Permanence clôturée et archivée dans l'historique, mais pas envoyée sur Discord (${erreur}). Tu pourras la renvoyer depuis l'onglet Historique.`, false);
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

/* ---------- Historique ---------- */
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
    return `<details class="perm ${fini ? "done" : "pending"}" data-id="${p.id}" ${ouverts.has(p.id) ? "open" : ""}>
      <summary><b>${esc(p.lieu)} — ${dateFR(p.date)}</b><span class="hint">${esc(p.intendant)} · ${p.orders.length} client(s) · ${nb} article(s)</span>
        ${p.discord ? '<span class="tag ok">Envoyée</span>' : '<span class="tag err">Non envoyée sur Discord</span>'}
        <span class="tag ${fini ? "ok" : ""}">${fini ? "✔ Tout livré" : `Livré ${liv}/${p.orders.length}`}</span>
        <span class="total" style="font-size:.9rem">${fmt(totalPerm(p.orders))}</span></summary>
      <div class="body">
        <div class="hint">Clôturée le ${new Date(p.clotureLe || p.envoyeLe).toLocaleString("fr-FR")}${p.discord && p.envoyeLe ? " — envoyée le " + new Date(p.envoyeLe).toLocaleString("fr-FR") : ""}</div>
        <h3>Commandé à l'administration</h3>${htmlRecap(p.orders, p.coffre)}
        <h3>Commandes détaillées</h3>${htmlCommandes(p.orders, false, p.id)}
        <div class="row" style="margin-top:8px">${p.discord ? "" : `<button class="btn small primary" data-hs="${p.id}">Envoyer sur Discord</button>`}<button class="btn small" data-hc="${p.id}">Copier le récap</button><button class="btn small" data-hd="${p.id}">Supprimer de l'historique</button></div>
        <div class="msg" id="hm-${p.id}"></div>
      </div></details>`;
  }).join("");
  box.querySelectorAll("[data-liv]").forEach(c => c.onchange = () => {
    const [pid, oid] = c.dataset.liv.split("|");
    const o = hist.find(p => p.id === pid).orders.find(x => x.id === oid);
    o.livreLe = c.checked ? new Date().toISOString() : null;
    saveHist(); renderHist();
  });
  box.querySelectorAll("[data-hc]").forEach(b => b.onclick = () => copier(recapTexte(hist.find(p => p.id === b.dataset.hc)), $("hm-" + b.dataset.hc)));
  box.querySelectorAll("[data-hs]").forEach(b => b.onclick = async () => {
    const p = hist.find(x => x.id === b.dataset.hs);
    b.disabled = true;
    try {
      await envoyerDiscord(p);
      p.discord = true; p.envoyeLe = new Date().toISOString(); saveHist(); renderHist();
    } catch (e) {
      b.disabled = false;
      flash($("hm-" + p.id), "Échec de l'envoi (" + e.message + ").", false);
    }
  });
  box.querySelectorAll("[data-hd]").forEach(b => b.onclick = async () => {
    if (!await confirmer("Supprimer cette permanence de l'historique ?")) return;
    hist = hist.filter(p => p.id !== b.dataset.hd); saveHist(); renderHist();
  });
}

/* ---------- Démarrage ---------- */
majLieux();
chargerForm(state.draft);
render();
let t0 = "perm"; try { t0 = sessionStorage.getItem("tab") || "perm"; } catch {}
showTab(t0);