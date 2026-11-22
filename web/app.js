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
} from '../src/ftms.js';
import {
  creerSuivi, resumer, seanceVersCsv, historiqueVersCsv, lireImport, DUREE_MINIMALE_S,
  FORMAT_EXPORT, VERSION_EXPORT,
} from '../src/seance.js';
import { ouvrir } from './stockage.js';
import { creerSynchro } from './synchro.js';
import { creerHistorique } from './historique.js';
import { bilan, suggererNiveau, lundiDe, cleJour, REGLAGES_PAR_DEFAUT } from '../src/objectif.js';

const FTMS = 0x1826;
const INFOS_APPAREIL = 0x180a;
const CARS = { capacites: 0x2acc, plageResistance: 0x2ad6, mesures: 0x2ad1, statut: 0x2ada, entrainement: 0x2ad3, pilotage: 0x2ad9 };

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

let vueCourante = 'semaine';
function montrer(vue) {
  vueCourante = vue;
  for (const v of ['semaine', 'direct', 'resume', 'historique']) $(`vue-${v}`).hidden = v !== vue;
  for (const b of document.querySelectorAll('nav button')) {
    const actif = b.dataset.vue === vue || (vue === 'resume' && b.dataset.vue === 'historique');
    if (actif) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (vue === 'historique') afficherHistorique();
  if (vue === 'semaine') afficherSemaine();
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
let synchro = null;
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
  try { await synchro?.envoyerSeance(id); } catch (e) { console.warn('sauvegarde serveur', e); afficherSauvegarde(); }
}

async function supprimerSeance(id) {
  await db.supprimer(id);
  try { await synchro?.supprimerSeance(id); } catch (e) { console.warn('sauvegarde serveur', e); }
}

// ---------------------------------------------------------------- carnet : réglages et activités hors rameur

let carnet = null;

async function chargerCarnet() {
  carnet = (await db.carnet()) ?? { maj: 0, reglages: {}, activites: [] };
  carnet.reglages = { ...REGLAGES_PAR_DEFAUT, ...carnet.reglages };
  carnet.activites ??= [];
  carnet.supprimees ??= [];
}

async function enregistrerCarnet() {
  carnet.maj = Date.now();
  await db.ecrireCarnet(carnet);
  try {
    const fusionne = await synchro?.envoyerCarnet({ ...carnet, id: 'carnet' });
    if (fusionne) {
      carnet = fusionne;
      await db.ecrireCarnet(carnet);
    }
  } catch (e) { console.warn('sauvegarde serveur', e); }
}

function afficherSauvegarde() {
  if (!synchro) $('sauvegarde').textContent = enRejeu || params.has('base') ? 'Base d’essai : rien n’est sauvegardé ailleurs.' : '';
  else $('sauvegarde').textContent = synchro.active
    ? 'Historique sauvegardé aussi sur le poste qui sert la page.'
    : 'Historique gardé dans ce navigateur seulement : pensez à l’exporter de temps en temps.';
}

// ---------------------------------------------------------------- écran de la semaine

/** « Aujourd'hui ». ?maintenant=AAAA-MM-JJTHH:MM ne sert qu'aux essais, sur une base d'essai. */
const maintenant = () => (params.has('maintenant') && params.has('base') ? Date.parse(params.get('maintenant')) : Date.now());

const formatJour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const formatCourt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const LETTRES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const NOMS_ACTIVITE = { course: 'Course à pied', renforcement: 'Renforcement', rameur: 'Rameur', autre: 'Autre' };

/** Les séances de rameur enregistrées, avec leur niveau principal (recalculé pour les anciennes). */
async function seancesRameur() {
  const liste = [];
  for (const s of await db.seances()) {
    if (s.etat !== 'terminee' || !s.resume) continue;
    if (s.resume.niveauPrincipal === undefined) {
      s.resume = resumer(await db.echantillons(s.id));
      await db.ecrireSeance(s);
    }
    liste.push(s);
  }
  return liste.sort((a, b) => a.debut - b.debut);
}

let niveauConseille = null;

async function afficherSemaine() {
  const rameur = await seancesRameur();
  const activites = [
    ...rameur.map((s) => ({ debut: s.debut, minutes: s.resume.duree / 60, type: 'rameur' })),
    ...carnet.activites,
  ];
  const b = bilan(activites, carnet.reglages, maintenant());
  const c = b.courante;
  const lundi = new Date(`${c.lundi}T12:00`);
  const dimanche = new Date(lundi); dimanche.setDate(dimanche.getDate() + 6);
  $('semaine-dates').textContent = `Du lundi ${formatJour.format(lundi)} au dimanche ${formatJour.format(dimanche)}`;

  const sansObjectif = carnet.reglages.objectifs.length === 0;
  $('semaine-depart').hidden = !sansObjectif;
  $('semaine-tableau').hidden = sansObjectif;
  $('semaine-actions').hidden = sansObjectif;
  $('semaine-revision').hidden = sansObjectif || !b.revisionDue;
  afficherSauvegarde();
  if (sansObjectif) { $('semaine-message').hidden = true; return; }

  $('semaine-jours').textContent = c.jours;
  $('semaine-objectif').textContent = c.objectif;
  const aujourdhui = cleJour(maintenant());
  $('semaine-points').replaceChildren(...c.joursActifs.map((fait, i) => {
    const li = document.createElement('li');
    li.textContent = LETTRES[i];
    const jour = new Date(lundi); jour.setDate(jour.getDate() + i);
    if (fait) li.classList.add('fait');
    if (cleJour(jour) === aujourdhui) { li.classList.add('aujourdhui'); li.setAttribute('aria-current', 'date'); }
    li.setAttribute('aria-label', `${formatCourt.format(jour)} : ${fait ? 'actif' : 'pas d’activité'}`);
    return li;
  }));
  const reste = Math.max(0, c.objectif - c.jours);
  $('semaine-statut').textContent = c.statut === 'deplacement' ? 'Semaine de déplacement : elle ne compte ni pour ni contre la série.'
    : c.statut === 'tenue' ? 'Objectif de la semaine atteint.'
    : `Encore ${reste} jour${reste > 1 ? 's' : ''} pour tenir la semaine.`;

  // R2, R3, R13
  $('semaine-minutes').textContent = c.minutes;
  $('semaine-jauge').value = Math.min(c.minutes, 150);
  // R5
  $('semaine-renfo').textContent = c.renforcement;
  // R6 : le total d'abord, la série ensuite.
  $('semaine-tenues').textContent = b.semainesTenues;
  $('semaine-serie').textContent = `${b.serie} semaine${b.serie > 1 ? 's' : ''}`;
  // R7
  $('semaine-reserve').textContent = b.reserve;
  $('semaine-reserve-max').textContent = b.jokersParBloc;
  $('semaine-reserve-detail').textContent = `Semaines manquées pardonnées. La réserve se recharge dans ${b.semainesAvantNouveauBloc} semaine${b.semainesAvantNouveauBloc > 1 ? 's' : ''}.`;

  // Progression du niveau (règle choisie par l'utilisateur).
  const suggestion = suggererNiveau(rameur.map((s) => ({ duree: s.resume.duree, niveau: s.resume.niveauPrincipal })), carnet.reglages);
  niveauConseille = suggestion?.niveau ?? null;
  $('tuile-niveau').hidden = !suggestion;
  if (suggestion) {
    $('semaine-niveau').textContent = suggestion.niveau;
    $('semaine-niveau-raison').textContent = suggestion.raison;
  }
  majBoutonNiveau();

  // R9 et R4 : sobre, sans reproche, avec la séance courte en proposition.
  const courte = carnet.reglages.dureeSeanceCourteMin;
  let message = '';
  if (!b.aujourdhuiActif && c.statut !== 'deplacement') {
    message = b.hierSansSeance
      ? `Pas de séance hier. Aujourd’hui, ${courte} minutes comptent aussi.`
      : `Pas le temps ou pas l’envie ? Une séance de ${courte} minutes compte aussi.`;
  }
  $('semaine-message').hidden = !message;
  $('semaine-message').textContent = message;

  // Activités ajoutées à la main.
  const manuelles = [...carnet.activites].sort((x, y) => y.debut - x.debut).slice(0, 20);
  $('aucune-activite').hidden = manuelles.length > 0;
  $('liste-activites').replaceChildren(...manuelles.map((a) => {
    const li = document.createElement('li');
    const texte = document.createElement('span');
    texte.textContent = `${formatCourt.format(a.debut)} · ${NOMS_ACTIVITE[a.type] ?? a.type} · ${a.minutes} min`;
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.textContent = 'Retirer';
    retirer.addEventListener('click', async () => {
      carnet.activites = carnet.activites.filter((x) => x.id !== a.id);
      carnet.supprimees ??= [];
      if (!carnet.supprimees.includes(a.id)) carnet.supprimees.push(a.id);
      await enregistrerCarnet();
      afficherSemaine();
    });
    li.append(texte, retirer);
    return li;
  }));

  $('basculer-deplacement').textContent = 'Semaine de déplacement';

  // Réglages
  const r = carnet.reglages;
  $('reglage-objectif').value = c.objectif;
  $('reglage-jokers').value = r.jokersParBloc;
  $('reglage-bloc').value = r.semainesParBloc;
  $('reglage-cible').value = r.dureeCibleMin;
  $('reglage-palier').value = r.seancesParPalier;
  $('reglage-courte').value = r.dureeSeanceCourteMin;
}

function fixerObjectif(jours) {
  const lundi = lundiDe(maintenant());
  const r = carnet.reglages;
  r.objectifs = r.objectifs.filter((o) => o.depuis !== lundi);
  r.objectifs.push({ depuis: lundi, seances: Math.min(7, Math.max(1, jours)) });
  r.derniereRevision = lundi;
}

$('depart-valider').addEventListener('click', async () => {
  fixerObjectif(Number($('depart-jours').value) || 3);
  await enregistrerCarnet();
  afficherSemaine();
});

for (const bouton of document.querySelectorAll('[data-revision]')) {
  bouton.addEventListener('click', async () => {
    const actuel = Number($('semaine-objectif').textContent) || 3;
    fixerObjectif(actuel + Number(bouton.dataset.revision));
    await enregistrerCarnet();
    afficherSemaine();
  });
}

$('ouvrir-activite').addEventListener('click', () => {
  $('form-deplacement').hidden = true;
  $('activite-jour').value = cleJour(maintenant());
  $('activite-jour').max = cleJour(maintenant());
  $('form-activite').hidden = false;
  $('activite-minutes').focus();
});
$('annuler-activite').addEventListener('click', () => { $('form-activite').hidden = true; });
$('form-activite').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const [a, m, j] = $('activite-jour').value.split('-').map(Number);
  const debut = new Date(a, m - 1, j, 12).getTime();
  carnet.activites.push({
    id: `a-${Date.now()}`, debut, minutes: Number($('activite-minutes').value), type: $('activite-type').value,
  });
  await enregistrerCarnet();
  $('form-activite').hidden = true;
  afficherSemaine();
});

$('basculer-deplacement').addEventListener('click', () => {
  $('form-activite').hidden = true;
  const choix = $('deplacement-semaine');
  const lundiCourant = lundiDe(maintenant());
  const options = [-1, 0, 1, 2].map((decalage) => {
    const d = new Date(`${lundiCourant}T12:00`); d.setDate(d.getDate() + 7 * decalage);
    const cle = lundiDe(d);
    const etiquette = { '-1': 'La semaine dernière', 0: 'Cette semaine', 1: 'La semaine prochaine', 2: 'Dans deux semaines' }[decalage];
    const deja = carnet.reglages.deplacements.includes(cle);
    const o = document.createElement('option');
    o.value = cle;
    o.textContent = `${etiquette}, du ${formatJour.format(d)}${deja ? ' (déclarée)' : ''}`;
    return o;
  });
  choix.replaceChildren(...options);
  choix.value = lundiCourant;
  majBoutonDeplacement();
  $('form-deplacement').hidden = false;
});
function majBoutonDeplacement() {
  const deja = carnet.reglages.deplacements.includes($('deplacement-semaine').value);
  $('valider-deplacement').textContent = deja ? 'Annuler la déclaration' : 'Déclarer';
}
$('deplacement-semaine').addEventListener('change', majBoutonDeplacement);
$('annuler-deplacement').addEventListener('click', () => { $('form-deplacement').hidden = true; });
$('form-deplacement').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cle = $('deplacement-semaine').value;
  const r = carnet.reglages;
  r.deplacements = r.deplacements.includes(cle) ? r.deplacements.filter((x) => x !== cle) : [...r.deplacements, cle];
  await enregistrerCarnet();
  $('form-deplacement').hidden = true;
  afficherSemaine();
});

$('enregistrer-reglages').addEventListener('click', async () => {
  const r = carnet.reglages;
  const lire = (id, defaut) => { const v = Number($(id).value); return Number.isFinite(v) && v > 0 ? v : defaut; };
  const objectif = lire('reglage-objectif', 3);
  if (objectif !== objectifCourant()) fixerObjectif(objectif);
  r.jokersParBloc = Math.max(0, Number($('reglage-jokers').value) || 0);
  r.semainesParBloc = lire('reglage-bloc', r.semainesParBloc);
  r.dureeCibleMin = lire('reglage-cible', r.dureeCibleMin);
  r.seancesParPalier = lire('reglage-palier', r.seancesParPalier);
  r.dureeSeanceCourteMin = lire('reglage-courte', r.dureeSeanceCourteMin);
  await enregistrerCarnet();
  afficherSemaine();
});
function objectifCourant() { return Number($('semaine-objectif').textContent) || null; }

// ---------------------------------------------------------------- pilotage de la résistance
// FTMS, Control Point 0x2AD9 : 0x00 demande le contrôle, 0x04 règle la résistance
// (paramètre en dixièmes). La norme le donne sur un octet ; ce rameur envoie sa
// résistance sur deux octets, donc on essaie l'autre forme si la première est refusée.

let pointPilotage = null;
let resistancePilotable = false;

function majBoutonNiveau() {
  const b = $('regler-niveau');
  b.hidden = !(appareil && resistancePilotable && pointPilotage && niveauConseille);
  b.textContent = `Régler le rameur au niveau ${niveauConseille ?? '–'}`;
}

function attendreReponse(op) {
  return new Promise((resolve) => {
    const surReponse = (ev) => {
      const v = new Uint8Array(ev.target.value.buffer);
      if (v[0] === 0x80 && v[1] === op) { pointPilotage.removeEventListener('characteristicvaluechanged', surReponse); resolve(v[2]); }
    };
    pointPilotage.addEventListener('characteristicvaluechanged', surReponse);
    setTimeout(() => { pointPilotage?.removeEventListener('characteristicvaluechanged', surReponse); resolve(null); }, 3000);
  });
}

async function commander(octets) {
  const reponse = attendreReponse(octets[0]);
  await pointPilotage.writeValueWithResponse(Uint8Array.from(octets));
  return reponse; // 0x01 : accepté ; null : pas de réponse
}

/** Règle la résistance au niveau conseillé. Appelé seul à la connexion : on ne clique pas en ramant. */
async function reglerNiveau() {
  if (!(pointPilotage && resistancePilotable && niveauConseille)) return;
  const b = $('regler-niveau');
  b.disabled = true;
  try {
    const n = niveauConseille * 10;
    const controle = await commander([0x00]);
    let resultat = await commander([0x04, n & 0xff]);
    if (resultat !== 0x01) resultat = await commander([0x04, n & 0xff, (n >> 8) & 0xff]);
    journaliser('pilotage', Uint8Array.from([controle ?? 0xff, resultat ?? 0xff]));
    $('aide').textContent = resultat === 0x01 ? `Rameur réglé au niveau ${niveauConseille}.`
      : `Le rameur n’a pas accepté le réglage (réponse ${resultat ?? 'absente'}). Réglez-le sur la console.`;
  } catch (e) {
    $('aide').textContent = `Réglage impossible : ${e.message}`;
  } finally {
    b.disabled = false;
  }
}

$('regler-niveau').addEventListener('click', reglerNiveau);

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
    resistancePilotable = cap.resistancePilotable;
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
  // Le point de pilotage répond par « indications » : il faut s'y abonner avant d'écrire.
  pointPilotage = null;
  if (resistancePilotable) {
    try {
      const c = await service.getCharacteristic(CARS.pilotage);
      await c.startNotifications();
      pointPilotage = c;
    } catch { /* pilotage indisponible : le bouton reste caché */ }
  }
  majBoutonNiveau();
  afficherEtat('Connecté : ramez pour démarrer', 'actif');
  reglerNiveau(); // sans attendre : la connexion n'en dépend pas
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
  pointPilotage = null;
  majBoutonNiveau();
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
  await supprimerSeance(resumeOuvert.id);
  montrer('historique');
});
$('resume-retour').addEventListener('click', () => montrer('historique'));

// ---------------------------------------------------------------- historique

let historique = null;

async function afficherHistorique() {
  historique ??= creerHistorique({ db, lireCarnet: () => carnet, ouvrirResume });
  await historique.afficher();
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
    if (ajoutees) await synchro?.demarrer(); // les séances importées partent aussi vers la sauvegarde
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

const nomBase = params.get('base') ?? (enRejeu ? 'rameur-rejeu' : 'rameur');
db = await ouvrir(nomBase);
// La sauvegarde sur le serveur ne concerne que la vraie base : jamais un rejeu ni une base d'essai.
if (nomBase === 'rameur') {
  synchro = creerSynchro(db);
  await synchro.demarrer();
}
await chargerCarnet();
await reprendre();
montrer(enRejeu ? 'direct' : params.get('vue') ?? 'semaine');
if (enRejeu) rejouer();
