// Écran en direct. Deux sources possibles pour les mêmes trames :
// - le rameur, par Web Bluetooth ;
// - un rejeu de capture (?rejeu=1, et ?vitesse=N pour accélérer), qui sert à mettre
//   l'écran au point sans personne sur le rameur.

import {
  decoderRameur, decoderStatut, decoderEntrainement, decoderCapacites, decoderPlageResistance,
} from '/src/ftms.js';

const FTMS = 0x1826;
const INFOS_APPAREIL = 0x180a;
const CARS = {
  capacites: 0x2acc,
  plageResistance: 0x2ad6,
  mesures: 0x2ad1,
  statut: 0x2ada,
  entrainement: 0x2ad3,
};

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- affichage

function mmss(secondes) {
  const s = Math.max(0, Math.round(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function afficherEtat(texte, classe = '') {
  $('etat').textContent = texte;
  $('etat').className = classe;
}

function afficherMesures(d) {
  // Une allure de 0 signifie « pas de coup en cours » : on affiche un tiret.
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

// ---------------------------------------------------------------- traitement commun

function surTrame(car, octets) {
  journaliser(car, octets);
  if (car === 'mesures') {
    afficherMesures(decoderRameur(octets));
  } else if (car === 'statut') {
    const s = decoderStatut(octets);
    if (s.type === 'demarre') afficherEtat('En séance', 'actif');
    if (s.type === 'en-pause') afficherEtat('En pause', 'pause');
    if (s.type === 'arrete') afficherEtat('Séance terminée par le rameur');
    if (s.type === 'resistance-cible') $('resistance').textContent = s.niveau;
  } else if (car === 'entrainement') {
    decoderEntrainement(octets);
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
    await fetch('/capture', { method: 'POST', body: JSON.stringify(lot) });
  } catch {
    enAttente.unshift(...lot); // le serveur reviendra : on garde le lot
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

// ---------------------------------------------------------------- rejeu

async function rejouer() {
  const vitesse = Number(params.get('vitesse') ?? 1);
  const source = params.get('fichier') ?? '/tests/fixtures/rameur-protocole.json';
  const capture = await (await fetch(source)).json();
  const noms = { feature: 'capacites', resistanceRange: 'plageResistance', machineData: 'mesures', machineStatus: 'statut', trainingStatus: 'entrainement' };
  $('secondaire').textContent = `Rejeu ×${vitesse}`;
  $('action').hidden = true;
  afficherEtat('Rejeu');
  const depart = params.has('depuis') ? Number(params.get('depuis')) * 1000 : 0;
  let t0 = null;
  for (const e of capture.entrees) {
    if (e.t < depart || e.sens === 'read') continue;
    t0 ??= e.t;
    const attente = (e.t - t0) / vitesse - (performance.now() - debutRejeu);
    if (attente > 0) await new Promise((r) => setTimeout(r, attente));
    surTrame(noms[e.car], Uint8Array.from(e.hex.split(' '), (h) => parseInt(h, 16)));
  }
  afficherEtat('Fin du rejeu');
}
const debutRejeu = performance.now();

// ---------------------------------------------------------------- démarrage

$('action').addEventListener('click', () => (appareil ? deconnecter() : connecter()));
if (params.has('rejeu')) rejouer();
