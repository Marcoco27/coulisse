import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decoderRameur, decoderStatut, decoderEntrainement, decoderCapacites, decoderPlageResistance,
} from '../src/ftms.js';

const extrait = JSON.parse(readFileSync(new URL('./fixtures/rameur-protocole.json', import.meta.url)));
const trames = extrait.entrees.filter((e) => e.car === 'machineData');

test('trame en plein effort, résistance sur 16 bits', () => {
  const d = decoderRameur('ae 0b 3c 41 00 3a 7e 01 00 7b 00 b8 00 0f 00 0a 00 60 03 0e 00 8e 00');
  assert.deepEqual(d, {
    cadence: 30, coups: 65, cadenceMoyenne: 29, distance: 382, allure: 123, puissance: 184,
    resistance: 15, calories: 10, caloriesParHeure: 864, caloriesParMinute: 14,
    frequenceCardiaque: 0, tempsEcoule: 142,
  });
});

test('même trame à la norme, résistance sur 8 bits', () => {
  const d = decoderRameur('ae 0b 3c 41 00 3a 7e 01 00 7b 00 b8 00 0f 0a 00 60 03 0e 00 8e 00');
  assert.equal(d.resistance, 15);
  assert.equal(d.tempsEcoule, 142);
});

test('puissance « non disponible » omise', () => {
  // Drapeaux 0x0021 : bit 0 à 1 (pas de cadence), bit 5 à 1 (puissance seule).
  const d = decoderRameur('2100 ff7f');
  assert.equal(d.puissance, undefined);
  assert.equal(d.cadence, undefined);
});

test('longueur incohérente refusée', () => {
  assert.throws(() => decoderRameur('ae 0b 3c 41'), RangeError);
});

test('toutes les trames réelles se décodent', () => {
  assert.ok(trames.length > 400);
  for (const t of trames) decoderRameur(t.hex);
});

test('capacités : résistance mesurée et pilotable, pas de puissance pilotable', () => {
  const lu = extrait.entrees.find((e) => e.car === 'feature');
  const c = decoderCapacites(lu.hex);
  assert.equal(c.resistance, true);
  assert.equal(c.resistancePilotable, true);
  assert.equal(c.puissancePilotable, false);
  assert.equal(c.puissance, true);
});

test('plage de résistance : 1 à 15, pas de 1', () => {
  const lu = extrait.entrees.find((e) => e.car === 'resistanceRange');
  assert.deepEqual(decoderPlageResistance(lu.hex), { min: 1, max: 15, pas: 1 });
});

test('statuts', () => {
  assert.deepEqual(decoderStatut('04'), { type: 'demarre' });
  assert.deepEqual(decoderStatut('02 02'), { type: 'en-pause' });
  assert.deepEqual(decoderStatut('02 01'), { type: 'arrete' });
  assert.deepEqual(decoderStatut('07 96'), { type: 'resistance-cible', niveau: 15 });
  assert.deepEqual(decoderEntrainement('01 0d'), { etat: 'mode-libre' });
  assert.deepEqual(decoderEntrainement('01 01'), { etat: 'repos' });
});

test('chaque changement de résistance annoncé se retrouve dans les mesures', () => {
  const statuts = extrait.entrees.filter((e) => e.car === 'machineStatus' && e.hex.startsWith('07'));
  for (const s of statuts) {
    const niveau = decoderStatut(s.hex).niveau;
    const suivante = trames.find((t) => t.t > s.t);
    assert.equal(decoderRameur(suivante.hex).resistance, niveau, `à ${s.t} ms`);
  }
});

// Cohérence interne de la séance gardée (après la remise à zéro de 152 s).
// La console affiche une mesure à la fois ; on contrôle donc les chiffres entre eux.
test('le chrono du rameur ne compte que le temps ramé', () => {
  const evenements = extrait.entrees.filter((e) => e.car === 'machineStatus' || e.car === 'trainingStatus');
  let debut = null; let rame = 0;
  for (const e of evenements) {
    if (e.t < 160000 || e.car !== 'machineStatus') continue;
    const s = decoderStatut(e.hex).type;
    if (s === 'demarre') debut = e.t;
    if ((s === 'en-pause' || s === 'arrete') && debut !== null) { rame += e.t - debut; debut = null; }
  }
  const fin = decoderRameur(trames.filter((t) => t.t < 639000).at(-1).hex);
  assert.ok(Math.abs(fin.tempsEcoule - rame / 1000) <= 2, `${fin.tempsEcoule} s contre ${rame / 1000} s`);
});

test('totaux de la séance gardée', () => {
  const fin = decoderRameur(trames.filter((t) => t.t < 639000).at(-1).hex);
  assert.equal(fin.distance, 824);
  assert.equal(fin.coups, 128);
  assert.equal(fin.tempsEcoule, 291);
  assert.equal(fin.calories, 24);
});

test('remise à zéro après l’arrêt : tous les compteurs repartent de zéro', () => {
  const apres = trames.filter((t) => t.t > 640000).at(-1);
  const d = decoderRameur(apres.hex);
  assert.equal(d.distance, 0);
  assert.equal(d.tempsEcoule, 0);
  assert.equal(d.coups, 0);
});

test('la distance ne recule jamais entre deux remises à zéro', () => {
  let precedente = 0;
  for (const t of trames) {
    const d = decoderRameur(t.hex).distance;
    if (d === 0) { precedente = 0; continue; }
    assert.ok(d >= precedente, `recul à ${t.t} ms`);
    precedente = d;
  }
});
