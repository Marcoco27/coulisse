import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decoderRameur, decoderStatut } from '../src/ftms.js';
import {
  creerSuivi, resumer, seanceVersCsv, historiqueVersCsv, lireImport, FORMAT_EXPORT,
} from '../src/seance.js';

const extrait = JSON.parse(readFileSync(new URL('./fixtures/rameur-protocole.json', import.meta.url)));

/** Rejoue l'extrait dans un suivi et rend les séances obtenues, avec leurs échantillons. */
function rejouer(entrees, suivi = creerSuivi(), base = 1_800_000_000_000) {
  const seances = new Map();
  const fins = [];
  const continuees = new Set();
  const appliquer = (evenements) => {
    for (const ev of evenements) {
      if (ev.type === 'debut') seances.set(ev.id, { id: ev.id, debut: ev.debut, echantillons: [] });
      if (ev.type === 'echantillon') {
        // Une séance reprise après un rechargement a commencé avant ce rejeu.
        if (!seances.has(ev.id)) continuees.add(ev.id);
        else seances.get(ev.id).echantillons.push(ev.e);
      }
      if (ev.type === 'fin' || ev.type === 'jetee') fins.push(ev);
    }
  };
  for (const e of entrees) {
    if (e.car === 'machineData') appliquer(suivi.mesure(decoderRameur(e.hex), base + e.t));
    if (e.car === 'machineStatus') appliquer(suivi.statut(decoderStatut(e.hex)));
  }
  return { seances: [...seances.values()], fins, suivi, continuees };
}

test('la capture se découpe en deux séances, fermées par le rameur', () => {
  const { seances, fins } = rejouer(extrait.entrees);
  assert.equal(seances.length, 2);
  assert.deepEqual(fins.map((f) => [f.type, f.raison]), [['fin', 'arret'], ['fin', 'arret']]);
});

test('la seconde séance porte les totaux du rameur', () => {
  const { seances } = rejouer(extrait.entrees);
  const r = resumer(seances[1].echantillons);
  assert.equal(r.duree, 291);
  assert.equal(r.distance, 824);
  assert.equal(r.coups, 128);
  assert.equal(r.calories, 24);
  // 291 s pour 824 m : 176,6 s aux 500 m.
  assert.equal(r.allureMoyenne, 177);
});

test('résumé : moyennes sur le seul temps ramé, temps de passage aux 500 m', () => {
  const { seances } = rejouer(extrait.entrees);
  const r = resumer(seances[1].echantillons);
  assert.ok(r.puissanceMoyenne > 40 && r.puissanceMoyenne < 200, `puissance moyenne ${r.puissanceMoyenne}`);
  assert.ok(r.puissanceMax >= r.puissanceMoyenne);
  assert.ok(r.cadenceMoyenne >= 25 && r.cadenceMoyenne <= 35, `cadence moyenne ${r.cadenceMoyenne}`);
  assert.equal(r.passages.length, 1);
  assert.equal(r.passages[0].distance, 500);
  assert.ok(r.passages[0].temps > 150 && r.passages[0].temps < 200, `passage à ${r.passages[0].temps} s`);
});

test('les répétitions du rameur ne créent pas d’échantillons en double', () => {
  const { seances } = rejouer(extrait.entrees);
  const e = seances[1].echantillons;
  for (let i = 1; i < e.length; i++) {
    const a = e[i - 1]; const b = e[i];
    assert.ok(a.t !== b.t || a.d !== b.d || a.coups !== b.coups || a.res !== b.res, `doublon au rang ${i}`);
  }
});

test('un rechargement de la page en pleine séance ne la coupe pas', () => {
  const mesures = extrait.entrees.filter((e) => e.car === 'machineData');
  const coupure = mesures.findIndex((e) => e.t > 260000);
  const avant = rejouer(mesures.slice(0, coupure));
  const ouverte = avant.suivi.courante;
  assert.ok(ouverte, 'une séance doit être ouverte au moment de la coupure');

  const apres = rejouer(mesures.slice(coupure), creerSuivi(ouverte));
  assert.equal(apres.seances.length, 0, 'aucune nouvelle séance');
  assert.ok(apres.continuees.has(ouverte.id), 'la séance coupée reçoit la suite de ses échantillons');
  assert.deepEqual(apres.fins.map((f) => f.id)[0], ouverte.id);
});

test('une séance trop courte est jetée', () => {
  const suivi = creerSuivi();
  suivi.mesure({ tempsEcoule: 5, distance: 12, coups: 2 }, 0);
  assert.deepEqual(suivi.statut({ type: 'arrete' }), [{ type: 'jetee', id: 's-0', raison: 'arret' }]);
});

test('des compteurs qui repartent de plus bas ouvrent une nouvelle séance', () => {
  const suivi = creerSuivi();
  suivi.mesure({ tempsEcoule: 100, distance: 300 }, 0);
  const ev = suivi.mesure({ tempsEcoule: 4, distance: 10 }, 1000);
  assert.deepEqual(ev.map((e) => e.type), ['fin', 'debut', 'echantillon']);
});

test('l’heure de début tient compte du chrono déjà écoulé', () => {
  const suivi = creerSuivi();
  const [debut] = suivi.mesure({ tempsEcoule: 39, distance: 86 }, 100_000);
  assert.equal(debut.debut, 61_000);
});

test('passages aux 500 m sur une séance longue', () => {
  const e = [];
  for (let t = 0; t <= 600; t++) e.push({ t, d: Math.round(t * 2.5), cad: 26, all: 200, p: 90, coups: t, kcal: 0, res: 5, fc: 0 });
  const r = resumer(e);
  assert.deepEqual(r.passages.map((p) => [p.distance, p.temps, p.troncon]), [[500, 200, 200], [1000, 400, 200], [1500, 600, 200]]);
  assert.equal(r.puissanceMoyenne, 90);
});

test('exports CSV', () => {
  const csv = seanceVersCsv([{ t: 1, d: 2, cad: 30, all: 120, p: 150, coups: 1, kcal: 0, res: 5, fc: 0 }]);
  assert.equal(csv, 'temps_s,distance_m,cadence,allure_s_500m,puissance_w,coups,kcal,resistance,fc\n1,2,30,120,150,1,0,5,0\n');
  const h = historiqueVersCsv([{ debut: 0, resume: { duree: 60, distance: 250, allureMoyenne: 120, calories: 3, coups: 30 } }]);
  assert.match(h, /^debut,duree_s/);
  assert.match(h, /1970-01-01T00:00:00.000Z,60,250,120,,,,3,30/);
});

test('import : refuse un fichier étranger, accepte un export', () => {
  assert.throws(() => lireImport('pas du json'), /JSON/);
  assert.throws(() => lireImport('{"a":1}'), /historique/);
  const ok = lireImport(JSON.stringify({ format: FORMAT_EXPORT, version: 1, seances: [{ id: 's-1', debut: 1, echantillons: [] }] }));
  assert.equal(ok.length, 1);
});
