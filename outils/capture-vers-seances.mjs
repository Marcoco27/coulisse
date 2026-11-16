// Transforme une capture brute en séances, au format de la sauvegarde du serveur.
//
//   node outils/capture-vers-seances.mjs <capture> <dossier-seances> [--fin AAAA-MM-JJTHH:MM:SSZ]
//
// Accepte une capture exportée par la démo de ftms-js (.json) ou une capture reçue en
// direct par le serveur (.jsonl). L'heure réelle de la dernière trame vient de --fin,
// à défaut de « recordedAt » (export ftms-js), à défaut de la date du fichier.
// N'écrase jamais une séance déjà présente.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decoderRameur, decoderStatut } from '../src/ftms.js';
import { creerSuivi, resumer } from '../src/seance.js';

const args = process.argv.slice(2);
const iFin = args.indexOf('--fin');
const finForcee = iFin >= 0 ? Date.parse(args.splice(iFin, 2)[1]) : null;
const [source, dossier] = args;
if (!source || !dossier) {
  console.error('usage : node outils/capture-vers-seances.mjs <capture> <dossier-seances> [--fin ISO]');
  process.exit(1);
}

const texte = readFileSync(source, 'utf8');
let entrees; let fin;
if (source.endsWith('.jsonl')) {
  entrees = texte.trim().split('\n').map((l) => JSON.parse(l)).map((e) => ({ t: e.t, car: e.car, hex: e.hex }));
  fin = statSync(source).mtimeMs;
} else {
  const c = JSON.parse(texte);
  const noms = { machineData: 'mesures', machineStatus: 'statut' };
  entrees = c.entries.map((e) => ({ t: e.t, car: noms[e.characteristic] ?? e.characteristic, hex: e.hex }));
  fin = Date.parse(c.recordedAt);
}
if (finForcee) fin = finForcee;
const decalage = Math.round(fin - entrees.at(-1).t); // heure réelle = decalage + t, en millisecondes entières

const suivi = creerSuivi();
const seances = new Map();
const gardees = [];
for (const e of entrees) {
  const ev = e.car === 'mesures' ? suivi.mesure(decoderRameur(e.hex), decalage + e.t)
    : e.car === 'statut' ? suivi.statut(decoderStatut(e.hex)) : [];
  for (const x of ev) {
    if (x.type === 'debut') seances.set(x.id, { id: x.id, debut: x.debut, echantillons: [] });
    if (x.type === 'echantillon') seances.get(x.id).echantillons.push(x.e);
    if (x.type === 'fin') gardees.push(x.id);
  }
}
for (const x of suivi.clore('fin-de-capture')) if (x.type === 'fin') gardees.push(x.id);

mkdirSync(dossier, { recursive: true });
for (const id of gardees) {
  const s = seances.get(id);
  const chemin = join(dossier, `${id}.json`);
  const r = resumer(s.echantillons);
  if (existsSync(chemin)) { console.log(`déjà là : ${id}`); continue; }
  writeFileSync(chemin, JSON.stringify({ id, debut: s.debut, etat: 'terminee', maj: Date.now(), resume: r, echantillons: s.echantillons }));
  console.log(`${new Date(s.debut).toLocaleString('fr-FR')} : ${r.distance} m en ${r.duree} s, niveau ${r.niveauPrincipal} → ${chemin}`);
}
