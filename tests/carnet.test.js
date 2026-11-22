import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionnerCarnets } from '../src/carnet.js';

// Dates en heure locale : new Date(année, mois - 1, jour, heure, minute, seconde).
const le = (a, m, j, h = 18, mi = 0, s = 0) => new Date(a, m - 1, j, h, mi, s).getTime();

const course = (id, debut, minutes = 30) => ({ id, debut, minutes, type: 'course' });

test('fusionnerCarnets : un vieux carnet local ne fait pas perdre une course Garmin du serveur', () => {
  const garmin = course('garmin-42', le(2026, 3, 8, 7, 15), 31);
  const local = { id: 'carnet', maj: le(2026, 3, 10), reglages: { objectifs: [] }, activites: [] };
  const distant = { id: 'carnet', maj: le(2026, 3, 9), reglages: { objectifs: [{ seances: 5 }] }, activites: [garmin] };

  const r = fusionnerCarnets(local, distant);

  assert.deepEqual(r.activites.map((a) => a.id), ['garmin-42']);
  assert.deepEqual(r.reglages, { objectifs: [] }, 'les réglages du local, plus récent, gagnent');
  assert.equal(r.maj, local.maj);
});

test('fusionnerCarnets : une activité retirée d’un côté ne revient pas de l’autre', () => {
  const locale = course('s-1', le(2026, 3, 7, 8), 40);
  const garmin = course('garmin-42', le(2026, 3, 8, 7, 15), 31);
  const local = { maj: 200, reglages: {}, supprimees: ['garmin-42'], activites: [locale] };
  const distant = { maj: 100, reglages: {}, supprimees: ['s-1'], activites: [garmin] };

  const r = fusionnerCarnets(local, distant);

  assert.deepEqual(r.supprimees, ['garmin-42', 's-1']);
  assert.deepEqual(r.activites, []);
});

test('fusionnerCarnets : les réglages suivent le maj le plus grand', () => {
  const ancien = { maj: 10, reglages: { jokersParBloc: 1 }, activites: [] };
  const recent = { maj: 20, reglages: { jokersParBloc: 3 }, activites: [] };

  assert.deepEqual(fusionnerCarnets(ancien, recent).reglages, { jokersParBloc: 3 });
  assert.deepEqual(fusionnerCarnets(recent, ancien).reglages, { jokersParBloc: 3 });
});

test('fusionnerCarnets : à id égal, la version du carnet le plus récent gagne', () => {
  const ancienne = { id: 's-1', debut: le(2026, 3, 7, 8), minutes: 20, type: 'course' };
  const recente = { id: 's-1', debut: le(2026, 3, 7, 8), minutes: 45, type: 'course' };
  const ancien = { maj: 10, reglages: {}, activites: [ancienne] };
  const recent = { maj: 20, reglages: {}, activites: [recente] };

  const r = fusionnerCarnets(ancien, recent);

  assert.equal(r.activites.length, 1);
  assert.equal(r.activites[0].minutes, 45);
});

test('fusionnerCarnets : un des deux carnets peut être null', () => {
  const c = { maj: 5, reglages: { a: 1 }, activites: [course('s-1', le(2026, 3, 7, 8))] };

  assert.deepEqual(fusionnerCarnets(c, null).reglages, { a: 1 });
  assert.equal(fusionnerCarnets(null, c).maj, 5);
  assert.deepEqual(fusionnerCarnets(null, c).activites.map((a) => a.id), ['s-1']);
  assert.deepEqual(fusionnerCarnets(null, c).supprimees, []);
});

test('fusionnerCarnets : les activités sont triées par début', () => {
  const a = { maj: 1, reglages: {}, activites: [course('b', le(2026, 3, 9, 8))] };
  const b = { maj: 2, reglages: {}, activites: [course('a', le(2026, 3, 8, 8))] };

  assert.deepEqual(fusionnerCarnets(a, b).activites.map((x) => x.id), ['a', 'b']);
});
