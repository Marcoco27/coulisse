// Page du rameur : séance en direct, résumé de fin, historique.
//
// Deux sources possibles pour les mêmes trames :
// - le rameur, par Web Bluetooth ;
// - un rejeu de capture (?rejeu=1, ?vitesse=N pour accélérer, ?depuis=S et ?jusqua=S
//   pour n'en jouer qu'un morceau), qui sert à mettre la page au point sans personne
//   sur le rameur.
// Le rejeu écrit dans une base à part (« rameur-rejeu ») pour ne pas salir
// l'historique réel. ?base=NOM ouvre une base précise, ?vue=historique une vue.

import {
  decoderRameur, decoderStatut, decoderCapacites, decoderPlageResistance,
} from '/src/ftms.js';
import {
  creerSuivi, resumer, seanceVersCsv, historiqueVersCsv, lireImport, DUREE_MINIMALE_S,
  FORMAT_EXPORT, VERSION_EXPORT,
} from '/src/seance.js';
import { ouvrir } from '/web/stockage.js';

const FTMS = 0x1826;
const INFOS_APPAREIL = 0x180a;
const CARS = { capacites: 0x2acc, plageResistance: 0x2ad6, mesures: 0x2ad1, statut: 0x2ada, entrainement: 0x2ad3 };

/** Sans nouvelle mesure pendant ce délai, une séance ouverte est close. Le rameur, lui, remet à zéro après 121 s. */
const DELAI_ABANDON_MS = 3 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const enRejeu = params.has('rejeu');

// ---------------------------------------------------------------- mise en forme

function mmss(secondes) {
  if (secondes === null || secondes === undefined) return '–';
  const s = Math.max(0, Math.round(secondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const formatDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const formatDateLongue = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
const nombre = new Intl.NumberFormat('fr-FR');

// ---------------------------------------------------------------- vues

let vueCourante = 'direct';
function montrer(vue) {
  vueCourante = vue;
  for (const v of ['direct', 'resume', 'historique']) $(`vue-${v}`).hidden = v !== vue;
  for (const b of document.querySelectorAll('nav button')) {
    const actif = b.dataset.vue === vue || (vue === 'resume' && b.dataset.vue === 'historique');
    if (actif) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (vue === 'historique') afficherHistorique();
}
for (const b of document.querySelectorAll('nav button')) b.addEventListener('click', () => montrer(b.dataset.vue));

// ---------------------------------------------------------------- séance en direct : affichage

function afficherEtat(texte, classe = '') {
  $('etat').textContent = texte;
  $('etat').className = classe;
}

function afficherMesures(d) {
  // Une allure ou une cadence à 0 signifie « pas de coup en cours » : on affiche un tiret.
  if (d.allure !== undefined) $('allure').textContent = d.allure > 0 ? mmss(d.allure) : '–:––';
  if (d.cadence !== undefined) $('cadence').textContent = d.cadence > 0 ? Math.round(d.cadence) : '–';
  if (d.tempsEcoule !== undefined) $('temps').textContent = mmss(d.tempsEcoule);
  if (d.distance !== undefined) $('distance').textContent = d.distance;
  if (d.puissance !== undefined) $('puissance').textContent = d.puissance > 0 ? d.puissance : '–';
  if (d.calories !== undefined) $('calories').textContent = d.calories;
  if (d.coups !== undefined) $('coups').textContent = d.coups;
  if (d.resistance !== undefined) $('resistance').textContent = d.resistance;
  if (d.frequenceCardiaque > 0) {
    $('bloc-fc').hidden = false;
    $('fc').textContent = d.frequenceCardiaque;
  }
}

// ---------------------------------------------------------------- enregistrement

let db;
let suivi = creerSuivi();
let derniereMesure = 0;

// Les écritures passent par une file : elles s'enchaînent dans l'ordre d'arrivée.
let file = Promise.resolve();
function enchainer(tache) {
  file = file.then(tache).catch((e) => console.error('enregistrement', e));
  return file;
}

function appliquer(evenements) {
  for (const ev of evenements) {
    enchainer(async () => {
      if (ev.type === 'debut') {
        await db.ecrireSeance({ id: ev.id, debut: ev.debut, etat: 'en-cours', maj: Date.now() });
        // On rame : l'écran en direct passe devant, quoi qu'il y ait à l'écran.
        if (vueCourante !== 'direct') montrer('direct');
      } else if (ev.type === 'echantillon') {
        await db.ecrireEchantillon(ev.id, ev.e);
        const s = await db.seance(ev.id);
        if (s) await db.ecrireSeance({ ...s, maj: Date.now() });
      } else if (ev.type === 'fin') {
        await terminer(ev.id);
        if (vueCourante === 'direct') await ouvrirResume(ev.id);
      } else if (ev.type === 'jetee') {
        await db.supprimer(ev.id);
      }
    });
  }
}

async function terminer(id) {
  const s = await db.seance(id);
  if (!s) return;
  const echantillons = await db.echantillons(id);
  await db.ecrireSeance({ ...s, etat: 'terminee', resume: resumer(echantillons) });
}

/**
 * Au chargement : une séance restée ouverte reprend si elle a bougé il y a peu
 * (rechargement de la page en pleine séance), sinon elle est close.
 */
async function reprendre() {
  for (const s of await db.seances()) {
    if (s.etat !== 'en-cours') continue;
    const echantillons = await db.echantillons(s.id);
    const dernier = echantillons.at(-1);
    if (dernier && Date.now() - (s.maj ?? 0) < DELAI_ABANDON_MS && !suivi.courante) {
      suivi = creerSuivi({ id: s.id, debut: s.debut, dernier });
      derniereMesure = s.maj;
    } else if (!dernier || dernier.t < DUREE_MINIMALE_S) {
      await db.supprimer(s.id);
    } else {
      await terminer(s.id);
    }
  }
}

// Une séance ouverte sans nouvelle mesure depuis trop longtemps est close.
setInterval(() => {
  if (suivi.courante && Date.now() - derniereMesure > DELAI_ABANDON_MS) appliquer(suivi.clore('abandon'));
}, 15000);

// ---------------------------------------------------------------- traitement commun des trames

function surTrame(car, octets) {
  journaliser(car, octets);
  if (car === 'mesures') {
    const m = decoderRameur(octets);
    afficherMesures(m);
    derniereMesure = Date.now();
    appliquer(suivi.mesure(m, Date.now()));
  } else if (car === 'statut') {
    const s = decoderStatut(octets);
    if (s.type === 'demarre') afficherEtat('En séance', 'actif');
    if (s.type === 'en-pause') afficherEtat('En pause', 'pause');
    if (s.type === 'arrete') afficherEtat('Séance enregistrée');
    if (s.type === 'resistance-cible') $('resistance').textContent = s.niveau;
    appliquer(suivi.statut(s));
  }
}

// ---------------------------------------------------------------- envoi des trames brutes au serveur local
// Seulement en direct : les trames partent vers donnees/ sur le poste qui sert la page.

const enAttente = [];
let envoiActif = false;
const debut = performance.now();

function hex(octets) {
  return [...octets].map((o) => o.toString(16).padStart(2, '0')).join(' ');
}

function journaliser(car, octets) {
  if (!envoiActif) return;
  enAttente.push({ t: Math.round(performance.now() - debut), car, hex: hex(octets) });
}

setInterval(async () => {
  if (!enAttente.length) return;
  const lot = enAttente.splice(0);
  try {
    const r = await fetch('/capture', { method: 'POST', body: JSON.stringify(lot) });
    if (!r.ok) envoiActif = false; // page servie sans serveur de capture : on s'arrête là
  } catch {
    if (enAttente.length < 20000) enAttente.unshift(...lot); // le serveur reviendra
  }
}, 2000);

// ---------------------------------------------------------------- écran allumé

let verrou = null;
async function garderEcranAllume() {
  if (!('wakeLock' in navigator) || verrou) return;
  try {
    verrou = await navigator.wakeLock.request('screen');
    verrou.addEventListener('release', () => { verrou = null; });
  } catch { /* refusé (batterie faible, onglet caché) : sans gravité */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && appareil) garderEcranAllume();
});

// ---------------------------------------------------------------- Web Bluetooth

let appareil = null;

async function brancher() {
  const serveur = await appareil.gatt.connect();
  const service = await serveur.getPrimaryService(FTMS);

  try {
    const cap = decoderCapacites(await (await service.getCharacteristic(CARS.capacites)).readValue());
    const plage = decoderPlageResistance(await (await service.getCharacteristic(CARS.plageResistance)).readValue());
    $('secondaire').textContent = `${appareil.name ?? 'rameur'} · résistance ${plage.min} à ${plage.max}`
      + (cap.resistancePilotable ? ' · pilotable' : '');
  } catch { $('secondaire').textContent = appareil.name ?? 'rameur'; }

  // Abonnement au seul service FTMS : certains rameurs n'envoient rien sinon.
  for (const [nom, uuid] of [['mesures', CARS.mesures], ['statut', CARS.statut], ['entrainement', CARS.entrainement]]) {
    try {
      const c = await service.getCharacteristic(uuid);
      c.addEventListener('characteristicvaluechanged', (ev) => {
        const v = ev.target.value;
        surTrame(nom, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      });
      await c.startNotifications();
    } catch (e) {
      if (nom === 'mesures') throw e; // sans les mesures, rien ne marche
    }
  }
  afficherEtat('Connecté : ramez pour démarrer', 'actif');
  $('action').textContent = 'Se déconnecter';
  $('aide').textContent = '';
  garderEcranAllume();
}

// Le rameur s'endort quand personne ne rame : on retente la connexion sans relâche.
async function surPerte() {
  if (!appareil) return;
  afficherEtat('Liaison perdue : ramez pour réveiller le rameur', 'pause');
  for (let essai = 0; appareil && !appareil.gatt.connected; essai++) {
    try { await brancher(); return; } catch { await new Promise((r) => setTimeout(r, Math.min(2000 + essai * 1000, 8000))); }
  }
}

async function connecter() {
  if (!navigator.bluetooth) {
    $('aide').textContent = 'Ce navigateur ne sait pas parler Bluetooth. Ouvrez la page dans Chrome, sur ordinateur ou Android.';
    return;
  }
  $('action').disabled = true;
  try {
    appareil = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS] }],
      optionalServices: [FTMS, INFOS_APPAREIL],
    });
    appareil.addEventListener('gattserverdisconnected', surPerte);
    envoiActif = true;
    afficherEtat('Connexion…');
    await brancher();
  } catch (e) {
    if (e.name === 'NotFoundError') $('aide').textContent = 'Aucun rameur choisi. Ramez quelques coups pour le réveiller, puis réessayez.';
    else $('aide').textContent = `Échec : ${e.message}`;
    afficherEtat('Non connecté');
    appareil = null;
  } finally {
    $('action').disabled = false;
  }
}

function deconnecter() {
  const a = appareil;
  appareil = null;
  a?.gatt.disconnect();
  verrou?.release();
  afficherEtat('Non connecté');
  $('action').textContent = 'Se connecter au rameur';
}

// ---------------------------------------------------------------- résumé d'une séance

let resumeOuvert = null;

async function ouvrirResume(id) {
  const s = await db.seance(id);
  if (!s) return;
  resumeOuvert = s;
  const r = s.resume ?? resumer(await db.echantillons(id));
  $('resume-titre').textContent = `${nombre.format(r.distance)} m en ${mmss(r.duree)}`;
  $('resume-date').textContent = formatDateLongue.format(s.debut) + (s.etat === 'en-cours' ? ' · en cours' : '');

  const chiffres = [
    ['Durée ramée', mmss(r.duree)],
    ['Distance', `${nombre.format(r.distance)} m`],
    ['Allure moyenne', r.allureMoyenne ? `${mmss(r.allureMoyenne)} /500 m` : '–'],
    ['Cadence moyenne', r.cadenceMoyenne ? `${r.cadenceMoyenne} /min` : '–'],
    ['Puissance moyenne', r.puissanceMoyenne ? `${r.puissanceMoyenne} W` : '–'],
    ['Puissance maximale', r.puissanceMax ? `${r.puissanceMax} W` : '–'],
    ['Calories', `${r.calories} kcal`],
    ['Coups', nombre.format(r.coups)],
  ];
  $('resume-chiffres').replaceChildren(...chiffres.map(([titre, valeur]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = titre;
    const dd = document.createElement('dd'); dd.textContent = valeur;
    div.append(dt, dd);
    return div;
  }));

  const corps = $('resume-passages').tBodies[0];
  corps.replaceChildren(...r.passages.map((p) => {
    const tr = document.createElement('tr');
    for (const v of [`${nombre.format(p.distance)} m`, mmss(p.temps), p.troncon === null ? '–' : mmss(p.troncon)]) {
      const td = document.createElement('td'); td.textContent = v; tr.append(td);
    }
    return tr;
  }));
  $('resume-passages').hidden = r.passages.length === 0;
  $('resume-sans-passage').hidden = r.passages.length > 0;
  montrer('resume');
}

function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const nomFichier = (debutMs) => new Date(debutMs).toISOString().slice(0, 16).replace(/[T:]/g, '-');

async function exporterJson(seances, nom) {
  const complet = [];
  for (const s of seances) complet.push({ ...s, echantillons: await db.echantillons(s.id) });
  telecharger(nom, JSON.stringify({ format: FORMAT_EXPORT, version: VERSION_EXPORT, seances: complet }), 'application/json');
}

$('resume-json').addEventListener('click', () => exporterJson([resumeOuvert], `seance-${nomFichier(resumeOuvert.debut)}.json`));
$('resume-csv').addEventListener('click', async () => {
  telecharger(`seance-${nomFichier(resumeOuvert.debut)}.csv`, seanceVersCsv(await db.echantillons(resumeOuvert.id)), 'text/csv');
});
$('resume-supprimer').addEventListener('click', async () => {
  if (!confirm('Supprimer cette séance ? Elle disparaîtra de l’historique.')) return;
  await db.supprimer(resumeOuvert.id);
  montrer('historique');
});
$('resume-retour').addEventListener('click', () => montrer('historique'));

// ---------------------------------------------------------------- historique

async function afficherHistorique() {
  const seances = await db.seances();
  $('historique-vide').hidden = seances.length > 0;
  $('historique-liste').replaceChildren(...seances.map((s) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const date = document.createElement('span'); date.className = 'date';
    date.textContent = formatDate.format(s.debut) + (s.etat === 'en-cours' ? ' · en cours' : '');
    const totaux = document.createElement('span'); totaux.className = 'totaux';
    const r = s.resume;
    totaux.textContent = r ? `${mmss(r.duree)} · ${nombre.format(r.distance)} m · ${mmss(r.allureMoyenne)} /500 m` : '…';
    b.append(date, totaux);
    b.addEventListener('click', () => ouvrirResume(s.id));
    li.append(b);
    return li;
  }));
}

$('historique-json').addEventListener('click', async () => exporterJson(await db.seances(), `rameur-historique-${nomFichier(Date.now())}.json`));
$('historique-csv').addEventListener('click', async () => {
  telecharger(`rameur-historique-${nomFichier(Date.now())}.csv`, historiqueVersCsv(await db.seances()), 'text/csv');
});
$('historique-import').addEventListener('change', async (ev) => {
  const fichier = ev.target.files[0];
  ev.target.value = '';
  if (!fichier) return;
  try {
    const ajoutees = await db.importer(lireImport(await fichier.text()));
    $('historique-message').textContent = ajoutees
      ? `${ajoutees} séance${ajoutees > 1 ? 's' : ''} ajoutée${ajoutees > 1 ? 's' : ''}.`
      : 'Rien de nouveau : ces séances étaient déjà là.';
  } catch (e) {
    $('historique-message').textContent = e.message;
  }
  afficherHistorique();
});

// ---------------------------------------------------------------- rejeu

async function rejouer() {
  const vitesse = Number(params.get('vitesse') ?? 1);
  const source = params.get('fichier') ?? '/tests/fixtures/rameur-protocole.json';
  const capture = await (await fetch(source)).json();
  const noms = { machineData: 'mesures', machineStatus: 'statut', trainingStatus: 'entrainement' };
  $('secondaire').textContent = `Rejeu ×${vitesse}`;
  $('action').hidden = true;
  afficherEtat('Rejeu');
  const depart = params.has('depuis') ? Number(params.get('depuis')) * 1000 : 0;
  const arret = params.has('jusqua') ? Number(params.get('jusqua')) * 1000 : Infinity;
  const debutRejeu = performance.now();
  let t0 = null;
  for (const e of capture.entrees) {
    if (e.t < depart || e.sens === 'read') continue;
    if (e.t >= arret) break;
    t0 ??= e.t;
    const attente = (e.t - t0) / vitesse - (performance.now() - debutRejeu);
    if (attente > 0) await new Promise((r) => setTimeout(r, attente));
    surTrame(noms[e.car], Uint8Array.from(e.hex.split(' '), (h) => parseInt(h, 16)));
  }
  await file;
  afficherEtat('Fin du rejeu');
  document.body.dataset.rejeu = 'fini';
}

// ---------------------------------------------------------------- démarrage

$('action').addEventListener('click', () => (appareil ? deconnecter() : connecter()));

db = await ouvrir(params.get('base') ?? (enRejeu ? 'rameur-rejeu' : 'rameur'));
await reprendre();
if (params.get('vue') === 'historique') montrer('historique');
if (enRejeu) rejouer();
