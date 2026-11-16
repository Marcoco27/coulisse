import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bilan, lundiDe, suggererNiveau, objectifPour } from '../src/objectif.js';

// Dates en heure locale : new Date(année, mois - 1, jour, heure).
const le = (a, m, j, h = 18) => new Date(a, m - 1, j, h).getTime();
const rame = (a, m, j, minutes = 15) => ({ debut: le(a, m, j), minutes, type: 'rameur' });
const reglages = (extra = {}) => ({ objectifs: [{ depuis: '2026-11-16', seances: 5 }], ...extra });

/** Cinq jours de rame dans la semaine qui commence au lundi donné. */
function semaineTenue(a, m, j) { return [0, 1, 2, 3, 4].map((k) => rame(a, m, j + k)); }

test('la semaine va du lundi au dimanche', () => {
  assert.equal(lundiDe(le(2026, 11, 16)), '2026-11-16');
  assert.equal(lundiDe(le(2026, 11, 22, 23)), '2026-11-16');
  assert.equal(lundiDe(le(2026, 11, 23, 0)), '2026-11-23');
});

test('les jours se comptent, pas les séances : deux séances le même jour font un jour', () => {
  const b = bilan([rame(2026, 11, 16), rame(2026, 11, 16), rame(2026, 11, 17)], reglages(), le(2026, 11, 18));
  assert.equal(b.courante.jours, 2);
  assert.equal(b.courante.minutes, 45);
  assert.deepEqual(b.courante.joursActifs, [true, true, false, false, false, false, false]);
});

test('R5 : le renforcement se compte à part, le rameur n’y entre pas', () => {
  const b = bilan([rame(2026, 11, 16), { debut: le(2026, 11, 17), minutes: 20, type: 'renforcement' }], reglages(), le(2026, 11, 18));
  assert.equal(b.courante.renforcement, 1);
  assert.equal(b.courante.jours, 2);
  assert.equal(b.courante.minutes, 35);
});

test('R3 : une séance de deux minutes compte un jour', () => {
  const b = bilan([rame(2026, 11, 16, 2)], reglages(), le(2026, 11, 16, 20));
  assert.equal(b.courante.jours, 1);
});

test('semaine tenue, semaine de déplacement, puis semaine tenue : série de deux', () => {
  const a = [...semaineTenue(2026, 11, 16), ...semaineTenue(2026, 11, 30)];
  const b = bilan(a, reglages({ deplacements: ['2026-11-23'] }), le(2026, 12, 8));
  assert.deepEqual(b.semaines.map((s) => s.statut), ['tenue', 'deplacement', 'tenue']);
  assert.equal(b.serie, 2);
  assert.equal(b.semainesTenues, 2);
  assert.equal(b.reserve, 3, 'un déplacement ne consomme pas de réserve');
});

test('R7 : une semaine manquée est couverte par la réserve, la série tient', () => {
  const a = [...semaineTenue(2026, 11, 16), rame(2026, 11, 23), ...semaineTenue(2026, 11, 30)];
  const b = bilan(a, reglages(), le(2026, 12, 8));
  assert.deepEqual(b.semaines.map((s) => s.statut), ['tenue', 'joker', 'tenue']);
  assert.equal(b.serie, 2);
  assert.equal(b.reserve, 2);
});

test('R6 : réserve épuisée, la série casse, le total des semaines tenues reste', () => {
  const a = [...semaineTenue(2026, 11, 16)]; // puis quatre semaines vides
  const b = bilan(a, reglages(), le(2026, 12, 21));
  assert.deepEqual(b.semaines.map((s) => s.statut), ['tenue', 'joker', 'joker', 'joker', 'manquee']);
  assert.equal(b.serie, 0);
  assert.equal(b.semainesTenues, 1);
  assert.equal(b.reserve, 0);
});

test('la réserve se recharge au bloc suivant de douze semaines', () => {
  const a = [];
  for (let i = 0; i < 12; i++) if (i % 4 !== 3) a.push(...semaineTenue(2026, 11, 16 + 7 * i));
  // Semaines 3, 7 et 11 manquées : trois jokers. Semaine 12 (nouveau bloc) manquée aussi.
  const b = bilan(a, reglages(), le(2027, 2, 17));
  assert.equal(b.semaines.length, 13);
  assert.equal(b.semaines.filter((s) => s.statut === 'joker').length, 4);
  assert.equal(b.semaines.at(-1).statut, 'joker');
  assert.equal(b.reserve, 2);
});

test('changement d’année : la semaine du 28 décembre 2026 au 3 janvier 2027 est une seule semaine', () => {
  const a = [28, 29, 30, 31].map((j) => rame(2026, 12, j));
  a.push(rame(2027, 1, 2));
  const b = bilan(a, reglages(), le(2027, 1, 3, 21));
  assert.equal(b.courante.lundi, '2026-12-28');
  assert.equal(b.courante.jours, 5);
  assert.equal(b.courante.statut, 'tenue');
});

test('changement d’heure : le compte des semaines ne dérive pas', () => {
  // Passage à l'heure d'été le 28 mars 2027.
  const b = bilan([], { objectifs: [{ depuis: '2027-03-15', seances: 5 }] }, le(2027, 4, 5));
  assert.equal(b.semaines.length, 3);
});

test('R10 : revoir l’objectif après quatre semaines, puis quatre semaines après la révision', () => {
  assert.equal(bilan([], reglages(), le(2026, 12, 10)).revisionDue, false);
  assert.equal(bilan([], reglages(), le(2026, 12, 14)).revisionDue, true);
  assert.equal(bilan([], reglages({ derniereRevision: '2026-12-14' }), le(2026, 12, 15)).revisionDue, false);
});

test('R1 : un objectif changé ne réécrit pas les semaines passées', () => {
  const r = { objectifs: [{ depuis: '2026-11-16', seances: 3 }, { depuis: '2026-11-23', seances: 5 }] };
  assert.equal(objectifPour(r, '2026-11-16'), 3);
  assert.equal(objectifPour(r, '2026-11-30'), 5);
  const a = [rame(2026, 11, 16), rame(2026, 11, 17), rame(2026, 11, 18)];
  assert.equal(bilan(a, r, le(2026, 11, 24)).semaines[0].statut, 'tenue');
});

test('R9 : hier sans séance est signalé, pas avant la toute première séance', () => {
  assert.equal(bilan([], reglages(), le(2026, 11, 18)).hierSansSeance, false);
  assert.equal(bilan([rame(2026, 11, 16)], reglages(), le(2026, 11, 18)).hierSansSeance, true);
  assert.equal(bilan([rame(2026, 11, 16), rame(2026, 11, 18, 5)], reglages(), le(2026, 11, 18, 20)).hierSansSeance, false);
});

test('progression : on monte d’un niveau après trois séances complètes', () => {
  const s = (niveau, minutes = 15) => ({ duree: minutes * 60, niveau });
  assert.equal(suggererNiveau([], {}), null);
  assert.equal(suggererNiveau([s(5, 5)], {}).niveau, 5);
  assert.equal(suggererNiveau([s(5), s(5)], {}).niveau, 5);
  assert.equal(suggererNiveau([s(5), s(5), s(5)], {}).niveau, 6);
  assert.equal(suggererNiveau([s(5), s(5), s(5), s(6)], {}).niveau, 6);
  assert.equal(suggererNiveau([s(5), s(5), s(5), s(6, 8)], {}).niveau, 6, 'une séance courte ne fait pas monter');
  assert.equal(suggererNiveau([s(15), s(15), s(15)], {}).niveau, 15, 'pas au-delà du maximum');
});
