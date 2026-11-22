import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estUneCourse, versActivite, fusionner } from '../src/garmin.js';

// Dates en heure locale : new Date(année, mois - 1, jour, heure, minute, seconde).
const le = (a, m, j, h = 18, mi = 0, s = 0) => new Date(a, m - 1, j, h, mi, s).getTime();

/** Une activité Garmin brute, telle que renvoyée par l'API. */
const garmin = (activityId, startTimeLocal, { duration = 1800, distance = 5000, typeKey = 'running' } = {}) =>
  ({ activityId, activityType: { typeKey }, startTimeLocal, duration, distance });

const carnetVide = () => ({ maj: 0, reglages: {}, activites: [] });

test('versActivite : identifiant, heure locale, minutes et distance', () => {
  const a = versActivite(garmin(42, '2026-03-08 07:15:30', { duration: 1837, distance: 5234 }));
  assert.equal(a.id, 'garmin-42');
  assert.equal(a.debut, le(2026, 3, 8, 7, 15, 30), 'debut à l’heure locale de la montre');
  assert.equal(a.minutes, 30.6);
  assert.equal(a.distance, 5234);
  assert.equal(a.type, 'course');
  assert.equal(a.source, 'garmin');

  const b = versActivite(garmin(43, '2026-03-08 08:00:00', { duration: 1800 }));
  assert.equal(b.minutes, 30);
});

test('estUneCourse : seules les courses comptent', () => {
  for (const typeKey of ['running', 'indoor_running', 'trail_running', 'treadmill_running', 'track_running']) {
    assert.equal(estUneCourse({ activityType: { typeKey } }), true, typeKey);
  }
  assert.equal(estUneCourse({ activityType: { typeKey: 'indoor_cardio' } }), false);
  assert.equal(estUneCourse({ activityType: { typeKey: 'cycling' } }), false);
  assert.equal(estUneCourse({}), false);
});

test('fusionner : une activité non-course est ignorée sans être signalée', () => {
  const r = fusionner(carnetVide(), [garmin(1, '2026-03-08 07:00:00', { typeKey: 'indoor_cardio' })], le(2026, 3, 9));
  assert.equal(r.ajoutees.length, 0);
  assert.equal(r.ignorees.length, 0);
  assert.equal(r.carnet.maj, 0);
});

test('fusionner : un identifiant déjà présent est ignoré', () => {
  const existante = { id: 'garmin-1', debut: le(2026, 3, 8), minutes: 30, type: 'course' };
  const carnet = { maj: 10, reglages: {}, activites: [existante] };
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.ajoutees.length, 0);
  assert.deepEqual(r.ignorees, [{ id: 'garmin-1', raison: 'déjà là' }]);
  assert.equal(r.carnet.maj, 10);
});

test('fusionner : une course manuelle le même jour bloque la course Garmin', () => {
  const manuelle = { id: 's-1234567890', debut: le(2026, 3, 8, 8), minutes: 40, type: 'course' };
  const carnet = { maj: 10, reglages: {}, activites: [manuelle] };
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.ajoutees.length, 0);
  assert.deepEqual(r.ignorees, [{ id: 'garmin-1', raison: 'course saisie à la main le même jour' }]);
  assert.equal(r.carnet.maj, 10);
});

test('fusionner : une course manuelle un autre jour ne bloque pas', () => {
  const manuelle = { id: 's-1234567890', debut: le(2026, 3, 7, 8), minutes: 40, type: 'course' };
  const carnet = { maj: 10, reglages: {}, activites: [manuelle] };
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.ajoutees.length, 1);
  assert.equal(r.ignorees.length, 0);
  assert.equal(r.carnet.activites.length, 2);
});

test('fusionner : le maj est strictement croissant même si maintenant est plus petit', () => {
  const ancien = le(2026, 3, 10);
  const carnet = { maj: ancien, reglages: {}, activites: [] };
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.carnet.maj, ancien + 1);
  assert.ok(r.carnet.maj > ancien);
});

test('fusionner : carnet absent, tout est ajouté', () => {
  const r = fusionner(undefined, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.ajoutees.length, 1);
  assert.deepEqual(r.carnet.reglages, {});
  assert.equal(r.carnet.maj, le(2026, 3, 9));
  assert.equal(r.carnet.activites.length, 1);
});

test('fusionner : carnet sans réglages, les réglages valent {}', () => {
  const r = fusionner({ maj: 5, activites: [] }, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.deepEqual(r.carnet.reglages, {});
  assert.equal(r.carnet.maj, le(2026, 3, 9));
});

test('fusionner : ne modifie pas le carnet reçu', () => {
  const carnet = {
    maj: 10,
    reglages: { jokersParBloc: 3 },
    activites: [{ id: 'autre', debut: le(2026, 3, 7), minutes: 20, type: 'rameur' }],
  };
  const copie = JSON.parse(JSON.stringify(carnet));
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.deepEqual(carnet, copie, 'l’entrée n’a pas bougé');
  assert.equal(r.carnet.activites.length, 2);
  assert.notEqual(r.carnet, carnet);
  assert.notEqual(r.carnet.activites, carnet.activites);
});

test('fusionner : rien d’ajouté, le maj ne bouge pas', () => {
  const carnet = {
    maj: 42,
    reglages: {},
    activites: [{ id: 'garmin-1', debut: le(2026, 3, 8), minutes: 30, type: 'course' }],
  };
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.ajoutees.length, 0);
  assert.equal(r.carnet.maj, 42);
});

test('fusionner : les activités sont triées par début', () => {
  const r = fusionner(carnetVide(), [
    garmin(2, '2026-03-09 07:00:00'),
    garmin(1, '2026-03-08 07:00:00'),
  ], le(2026, 3, 10));
  assert.deepEqual(r.carnet.activites.map((a) => a.id), ['garmin-1', 'garmin-2']);
});

test('fusionner : garde les réglages et les activités existantes', () => {
  const reglages = { objectifs: [{ depuis: '2026-01-05', seances: 5 }] };
  const existante = { id: 's-1', debut: le(2026, 3, 7), minutes: 20, type: 'rameur' };
  const carnet = { maj: 10, reglages, activites: [existante] };
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.carnet.reglages, reglages);
  assert.ok(r.carnet.activites.includes(existante));
});

test('fusionner : une course de moins de 500 m est écartée et signalée', () => {
  const r = fusionner(
    carnetVide(),
    [garmin(1, '2025-09-28 07:00:00', { duration: 5, distance: 0 }),
     garmin(2, '2025-11-18 07:00:00', { duration: 66, distance: 120 }),
     garmin(3, '2025-11-19 07:00:00', { duration: 300, distance: 500 })],
    le(2026, 3, 9),
  );
  assert.deepEqual(r.ajoutees.map((a) => a.id), ['garmin-3']);
  assert.equal(r.ignorees.length, 2);
  assert.match(r.ignorees[0].raison, /trop courte/);
});

test('fusionner : une activité retirée à la main n’est pas réimportée', () => {
  const carnet = { maj: 10, reglages: {}, supprimees: ['garmin-1'], activites: [] };
  const r = fusionner(carnet, [garmin(1, '2026-03-08 07:00:00')], le(2026, 3, 9));
  assert.equal(r.ajoutees.length, 0);
  assert.deepEqual(r.ignorees, [{ id: 'garmin-1', raison: 'retirée à la main' }]);
  assert.deepEqual(r.carnet.supprimees, ['garmin-1']);
  assert.equal(r.carnet.maj, 10);
});
