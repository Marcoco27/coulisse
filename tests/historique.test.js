import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unifier, comparer, calendrier, medianesMensuelles, grouperParMois, lisser, formaterAllure,
} from '../src/historique.js';
import { cleJour } from '../src/objectif.js';

test('unifier ramène les deux sources au même format, du plus récent au plus ancien', () => {
  const t1 = new Date(2024, 0, 1, 10, 0).getTime();
  const t2 = new Date(2024, 0, 2, 10, 0).getTime();
  const t3 = new Date(2024, 0, 3, 10, 0).getTime();
  const seancesRameur = [
    { id: 'r1', debut: t1, etat: 'terminee', resume: { duree: 600, distance: 2000, allureMoyenne: 150, puissanceMoyenne: 120 } },
    { id: 'r2', debut: t2, etat: 'en-cours' },
  ];
  const activites = [
    { id: 'a1', debut: t3, minutes: 30, type: 'course', distance: 5000 },
    { id: 'a2', debut: t2, minutes: 45, type: 'renforcement' },
  ];
  const liste = unifier(seancesRameur, activites);
  assert.equal(liste.length, 3);
  assert.equal(liste[0].id, 'a1');
  assert.equal(liste[0].type, 'course');
  assert.equal(liste[0].minutes, 30);
  assert.equal(liste[0].distance, 5000);
  assert.equal(liste[0].allure, 360);
  assert.equal(liste[1].id, 'a2');
  assert.equal(liste[1].distance, null);
  assert.equal(liste[1].allure, null);
  assert.equal(liste[2].id, 'r1');
  assert.equal(liste[2].minutes, 10);
  assert.equal(liste[2].distance, 2000);
  assert.equal(liste[2].allure, 150);
  assert.equal(liste[2].puissance, 120);
});

test('comparer distingue plus vite, plus lent, allure habituelle et moins de cinq précédentes', () => {
  const base = new Date(2024, 0, 10, 10, 0).getTime();
  const jour = 86400000;
  const seance = { id: 'c0', debut: base + 6 * jour, type: 'course', allure: 300 };
  const cinq = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i + 1}`,
    debut: base + i * jour,
    type: 'course',
    allure: 308,
  }));

  const plusVite = comparer(seance, [seance, ...cinq]);
  assert.equal(plusVite.ecart, 8);
  assert.match(plusVite.texte, /8 s\/km plus vite que d’habitude/);

  const plusLent = comparer({ ...seance, allure: 320 }, [seance, ...cinq]);
  assert.equal(plusLent.ecart, -12);
  assert.match(plusLent.texte, /12 s\/km plus lent que d’habitude/);

  const habituelle = comparer({ ...seance, allure: 306 }, [seance, ...cinq]);
  assert.equal(habituelle.ecart, 2);
  assert.equal(habituelle.texte, 'allure habituelle');

  const deux = [
    { id: 'p1', debut: base, type: 'course', allure: 310 },
    { id: 'p2', debut: base + jour, type: 'course', allure: 310 },
  ];
  const moinsDeCinq = comparer(seance, [seance, ...deux]);
  assert.equal(moinsDeCinq.ecart, 10);
  assert.match(moinsDeCinq.texte, /10 s\/km plus vite/);
});

test('calendrier agrège les deux types, calcule les crans et commence un lundi', () => {
  const maintenant = new Date(2024, 2, 20, 12, 0);
  const lundi = new Date(2024, 2, 18, 10, 0);
  const mardi = new Date(2024, 2, 19, 10, 0);
  const mercredi = new Date(2024, 2, 20, 10, 0);
  const jeudi = new Date(2024, 2, 21, 10, 0);
  const liste = [
    { id: 'r1', debut: lundi.getTime(), type: 'rameur', minutes: 20 },
    { id: 'c1', debut: lundi.getTime() + 3600000, type: 'course', minutes: 15 },
    { id: 'r2', debut: mardi.getTime(), type: 'rameur', minutes: 10 },
    { id: 'r3', debut: mercredi.getTime(), type: 'rameur', minutes: 70 },
    { id: 'r4', debut: jeudi.getTime(), type: 'rameur', minutes: 150 },
  ];
  const semaines = calendrier(liste, maintenant);
  assert.equal(semaines.length, 53);
  assert.equal(semaines[0].length, 7);
  assert.equal(new Date(semaines[0][0].cle + 'T12:00:00').getDay(), 1);

  const parCle = new Map(semaines.flat().map((j) => [j.cle, j]));
  const l = parCle.get(cleJour(lundi));
  assert.equal(l.minutesRameur, 20);
  assert.equal(l.minutesFooting, 15);
  assert.equal(l.cran, 2);
  assert.deepEqual(l.seances, ['r1', 'c1']);
  assert.equal(parCle.get(cleJour(mardi)).cran, 1);
  assert.equal(parCle.get(cleJour(mercredi)).cran, 3);
  assert.equal(parCle.get(cleJour(jeudi)).cran, 4);
  assert.equal(parCle.get(cleJour(new Date(2024, 2, 22, 10, 0))).cran, 0);
});

test('medianesMensuelles calcule une médiane par mois local', () => {
  const points = [
    { debut: new Date(2024, 0, 10).getTime(), allure: 300 },
    { debut: new Date(2024, 0, 20).getTime(), allure: 320 },
    { debut: new Date(2024, 0, 25).getTime(), allure: 310 },
    { debut: new Date(2024, 1, 5).getTime(), allure: 400 },
    { debut: new Date(2024, 1, 15).getTime(), allure: 380 },
  ];
  assert.deepEqual(medianesMensuelles(points), [
    { mois: '2024-01', mediane: 310 },
    { mois: '2024-02', mediane: 390 },
  ]);
});

test('grouperParMois regroupe et totalise par mois, du plus récent au plus ancien', () => {
  const liste = [
    { id: 'a', debut: new Date(2024, 1, 10).getTime(), type: 'course', minutes: 30, distance: 5000, allure: 360 },
    { id: 'b', debut: new Date(2024, 0, 20).getTime(), type: 'course', minutes: 20, distance: 3000, allure: 400 },
    { id: 'c', debut: new Date(2024, 0, 10).getTime(), type: 'rameur', minutes: 10, distance: 2000, allure: 150 },
  ];
  const groupes = grouperParMois(liste);
  assert.equal(groupes.length, 2);
  assert.equal(groupes[0].cle, '2024-02');
  assert.equal(groupes[0].titre, 'février 2024');
  assert.equal(groupes[0].nombre, 1);
  assert.equal(groupes[0].totalMinutes, 30);
  assert.equal(groupes[0].totalDistance, 5000);
  assert.equal(groupes[1].cle, '2024-01');
  assert.equal(groupes[1].nombre, 2);
  assert.equal(groupes[1].totalMinutes, 30);
  assert.equal(groupes[1].totalDistance, 5000);
  assert.deepEqual(groupes[1].seances.map((s) => s.id), ['b', 'c']);
});

test('lisser lisse sans déborder et formaterAllure arrondit', () => {
  assert.deepEqual(lisser([10, 20, 30], 3), [15, 20, 25]);
  assert.deepEqual(lisser([10, null, 20], 3), [10, null, 20]);
  assert.equal(formaterAllure(312.6), '5:13');
});
