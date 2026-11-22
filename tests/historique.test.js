import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unifier, comparer, calendrier, medianesMensuelles, grouperParMois, lisser, formaterAllure,
  semainesRecentes, tendance, elan,
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


test('semainesRecentes place la semaine courante en dernière position', () => {
  const maintenant = new Date(2024, 4, 15, 12, 0, 0);
  const semaines = semainesRecentes([], maintenant, 3);
  assert.equal(semaines.length, 3);
  assert.equal(semaines[0].lundi, '2024-04-29');
  assert.equal(semaines[2].lundi, '2024-05-13');
  assert.equal(semaines[2].jours[0].cle, '2024-05-13');
  assert.equal(semaines[2].jours[6].cle, '2024-05-19');
});

test('semainesRecentes additionne les minutes par famille', () => {
  const maintenant = new Date(2024, 0, 10, 12);
  const liste = [
    { id: 'r', debut: new Date(2024, 0, 8, 10).getTime(), type: 'rameur', minutes: 10 },
    { id: 'c', debut: new Date(2024, 0, 9, 10).getTime(), type: 'course', minutes: 20 },
    { id: 'ren', debut: new Date(2024, 0, 9, 11).getTime(), type: 'renforcement', minutes: 15 },
    { id: 'a', debut: new Date(2024, 0, 10, 10).getTime(), type: 'autre', minutes: 5 },
  ];
  const semaine = semainesRecentes(liste, maintenant, 1)[0];
  assert.equal(semaine.minutes.rameur, 10);
  assert.equal(semaine.minutes.course, 20);
  assert.equal(semaine.minutes.autre, 20);
  assert.equal(semaine.total, 50);
  assert.equal(semaine.joursActifs, 3);
});

test('semainesRecentes signale un jour mixte sans doublon de famille', () => {
  const maintenant = new Date(2024, 0, 10, 12);
  const liste = [
    { id: 'r1', debut: new Date(2024, 0, 8, 9).getTime(), type: 'rameur', minutes: 10 },
    { id: 'r2', debut: new Date(2024, 0, 8, 10).getTime(), type: 'rameur', minutes: 5 },
    { id: 'c1', debut: new Date(2024, 0, 8, 11).getTime(), type: 'course', minutes: 20 },
  ];
  const jour = semainesRecentes(liste, maintenant, 1)[0].jours[0];
  assert.deepEqual(jour.types, ['rameur', 'course']);
  assert.equal(jour.minutes, 35);
});

test('semainesRecentes passe le changement d’heure sans décaler les jours', () => {
  const maintenant = new Date(2024, 9, 28, 12);
  const semaines = semainesRecentes([], maintenant, 2);
  assert.equal(semaines[0].lundi, '2024-10-21');
  assert.equal(semaines[0].jours[6].cle, '2024-10-27');
  assert.equal(semaines[1].lundi, '2024-10-28');
  assert.equal(semaines[1].jours[0].cle, '2024-10-28');
});

test('semainesRecentes reprend le statut et l’objectif de la Map', () => {
  const statuts = new Map([['2024-05-13', { statut: 'tenue', objectif: 5 }]]);
  const semaine = semainesRecentes([], new Date(2024, 4, 15, 12), 1, statuts)[0];
  assert.equal(semaine.statut, 'tenue');
  assert.equal(semaine.objectif, 5);
  const sans = semainesRecentes([], new Date(2024, 4, 15, 12), 1)[0];
  assert.equal(sans.statut, null);
  assert.equal(sans.objectif, null);
});

test('tendance calcule un écart positif entre le lot récent et le précédent', () => {
  const t0 = new Date(2024, 0, 1, 10).getTime();
  const liste = [
    { id: 'p1', debut: t0, type: 'rameur', minutes: 10, allure: 200 },
    { id: 'p2', debut: t0 + 1, type: 'rameur', minutes: 10, allure: 202 },
    { id: 'r1', debut: t0 + 2, type: 'rameur', minutes: 10, allure: 190 },
    { id: 'r2', debut: t0 + 3, type: 'rameur', minutes: 10, allure: 192 },
  ];
  const t = tendance(liste, 'rameur', 2);
  assert.deepEqual(t.points.map((p) => p.id), ['p1', 'p2', 'r1', 'r2']);
  assert.equal(t.actuelle, 191);
  assert.equal(t.avant, 201);
  assert.equal(t.ecart, 10);
  assert.equal(t.nombre, 2);
});

test('tendance écarte les séances trop courtes et les allures aberrantes', () => {
  const t0 = new Date(2024, 0, 1, 10).getTime();
  const liste = [
    { id: 'courte', debut: t0, type: 'rameur', minutes: 4, allure: 100 },
    { id: 'p1', debut: t0 + 1, type: 'rameur', minutes: 10, allure: 200 },
    { id: 'p2', debut: t0 + 2, type: 'rameur', minutes: 10, allure: 202 },
    { id: 'r1', debut: t0 + 3, type: 'rameur', minutes: 10, allure: 190 },
    { id: 'r2', debut: t0 + 4, type: 'rameur', minutes: 10, allure: 192 },
    { id: 'aberrante', debut: t0 + 5, type: 'rameur', minutes: 10, allure: 300 },
  ];
  const t = tendance(liste, 'rameur', 2);
  assert.ok(!t.points.some((p) => p.id === 'courte'));
  assert.ok(!t.points.some((p) => p.id === 'aberrante'));
});

test('tendance laisse avant à null sous deux séances précédentes', () => {
  const t0 = new Date(2024, 0, 1, 10).getTime();
  const liste = [
    { id: 'p1', debut: t0, type: 'rameur', minutes: 10, allure: 200 },
    { id: 'r1', debut: t0 + 1, type: 'rameur', minutes: 10, allure: 190 },
    { id: 'r2', debut: t0 + 2, type: 'rameur', minutes: 10, allure: 192 },
  ];
  const t = tendance(liste, 'rameur', 2);
  assert.equal(t.avant, null);
  assert.equal(t.ecart, null);
  assert.equal(t.nombre, 2);
});

// ------------------------------------------------ élan de la semaine

function seance(type, date, minutes) {
  return { id: `${type}-${date.getTime()}`, type, debut: date.getTime(), minutes };
}

test('elan montre toujours les deux sports et pousse au footing manquant', () => {
  const maintenant = new Date(2026, 10, 18, 20, 0); // mercredi
  const liste = [
    seance('rameur', new Date(2026, 10, 16, 10), 15),
    seance('rameur', new Date(2026, 10, 17, 10), 15),
    seance('course', new Date(2026, 9, 14, 10), 30),
  ];
  const e = elan(liste, semainesRecentes(liste, maintenant, 2), maintenant);
  assert.deepEqual(e.sports.map((s) => s.type), ['rameur', 'course']);
  assert.equal(e.sports[0].minutes, 30);
  assert.equal(e.sports[1].seances, 0);
  assert.equal(e.sports[1].joursDepuis, 35);
  assert.match(e.coupDePouce, /baskets attendent depuis 35 jours/);
  assert.equal(e.total, 30);
});

test('elan félicite une semaine tenue', () => {
  const maintenant = new Date(2026, 10, 20, 20, 0); // vendredi
  const liste = [1, 2].map((j) => seance('rameur', new Date(2026, 10, 15 + j, 10), 20))
    .concat([seance('course', new Date(2026, 10, 19, 10), 30)]);
  const statuts = new Map([['2026-11-16', { statut: 'tenue', objectif: 3 }]]);
  const e = elan(liste, semainesRecentes(liste, maintenant, 2, statuts), maintenant);
  assert.equal(e.ton, 'victoire');
  assert.equal(e.titre, 'Semaine gagnée');
});

test('elan ne promet pas une semaine devenue impossible, et regarde vers demain le dimanche', () => {
  const maintenant = new Date(2026, 10, 22, 20, 0); // dimanche
  const liste = [seance('rameur', new Date(2026, 10, 16, 10), 26)];
  const statuts = new Map([['2026-11-16', { statut: 'en-cours', objectif: 5 }]]);
  const e = elan(liste, semainesRecentes(liste, maintenant, 2, statuts), maintenant);
  assert.equal(e.titre, 'Pas cette fois, mais rien n’est perdu');
  assert.match(e.texte, /Demain, le compteur repart à zéro/);
});

test('elan compte les jours restants quand la semaine reste jouable', () => {
  const maintenant = new Date(2026, 10, 17, 9, 0); // mardi matin, rien fait aujourd'hui
  const liste = [seance('course', new Date(2026, 10, 16, 10), 30)];
  const statuts = new Map([['2026-11-16', { statut: 'en-cours', objectif: 5 }]]);
  const e = elan(liste, semainesRecentes(liste, maintenant, 2, statuts), maintenant);
  assert.equal(e.titre, 'Encore 4 jours actifs');
  assert.match(e.texte, /Il reste 6 jours/);
  assert.match(e.coupDePouce, /rameur/);
});
