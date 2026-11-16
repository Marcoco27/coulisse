// Tire d'une capture exportée par la démo de ftms-js un extrait publiable pour les tests.
//
//   node outils/extraire-fixture.mjs donnees/ftms-capture-XXXX.json tests/fixtures/rameur-protocole.json
//
// Ce que l'extrait retire : l'heure de la séance (recordedAt) et le numéro de série
// contenu dans le nom Bluetooth. Ce qu'il resserre : une trame identique à la
// précédente sur la même caractéristique est retirée, le rameur répétant chaque
// mesure environ quatre fois par seconde. Rien d'autre n'est modifié.

import { readFileSync, writeFileSync } from 'node:fs';

const [source, cible] = process.argv.slice(2);
if (!source || !cible) {
  console.error('usage : node outils/extraire-fixture.mjs <capture.json> <extrait.json>');
  process.exit(1);
}

const capture = JSON.parse(readFileSync(source, 'utf8'));
const dernier = {};
const entrees = [];
for (const e of capture.entries) {
  if (e.direction === 'in' && dernier[e.characteristic] === e.hex) continue;
  dernier[e.characteristic] = e.hex;
  entrees.push({ t: e.t, car: e.characteristic, sens: e.direction, hex: e.hex });
}

const nom = (capture.device?.name ?? '').replace(/\d{4}$/, '0000');
const extrait = {
  origine: 'Capture réelle, exportée par la démo de ftms-js puis resserrée par outils/extraire-fixture.mjs',
  appareil: { nom, ...capture.device?.info },
  type: capture.machineType,
  entrees,
};
writeFileSync(cible, JSON.stringify(extrait, null, 1) + '\n');
console.log(`${capture.entries.length} entrées → ${entrees.length} gardées dans ${cible}`);
