// Versement des footings Garmin dans le carnet : fonctions pures, sans réseau ni disque.
//
// Le carnet est un fichier DONNEES/carnet.json, de forme
//   { id?: 'carnet', maj, reglages, activites: [{ id, debut, minutes, type }] }
// La page fusionne « le maj le plus grand gagne » : le maj écrit doit donc être
// strictement supérieur à l'ancien.

import { cleJour } from './objectif.js';

/** En dessous de cette distance (mètres), une course est un chrono lancé par erreur. */
export const DISTANCE_MINIMALE = 500;

const TYPES_COURSE = new Set([
  'running',
  'indoor_running',
  'trail_running',
  'treadmill_running',
  'track_running',
]);

/** Vrai si l'activité Garmin est une course à pied. */
export function estUneCourse(activite) {
  return TYPES_COURSE.has(activite?.activityType?.typeKey);
}

/**
 * Convertit une activité Garmin brute en activité du carnet.
 * startTimeLocal est l'heure locale de la montre ('AAAA-MM-JJ HH:MM:SS') : on la lit
 * telle quelle, surtout pas via new Date(chaine) ni startTimeGMT.
 */
export function versActivite(activite) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(activite.startTimeLocal);
  const debut = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6]),
  ).getTime();
  return {
    id: `garmin-${activite.activityId}`,
    debut,
    minutes: Math.round(activite.duration / 60 * 10) / 10,
    type: 'course',
    distance: Math.round(activite.distance ?? 0),
    source: 'garmin',
  };
}

/**
 * Fusionne les activités Garmin dans le carnet, sans modifier l'objet reçu.
 * - ignore silencieusement les non-courses ;
 * - ignore un id déjà présent (raison « déjà là ») ;
 * - ignore une course Garmin si une course saisie à la main existe le même jour local
 *   (raison « course saisie à la main le même jour »).
 * Si rien n'est ajouté, le carnet revient inchangé (même maj). Sinon le maj devient
 * strictement supérieur à l'ancien, et les activités sont triées par début.
 */
export function fusionner(carnet, activitesGarmin, maintenant) {
  const source = carnet ?? {};
  const existantes = Array.isArray(source.activites) ? source.activites : [];
  const reglages = source.reglages ?? {};
  const majAvant = source.maj ?? 0;

  const ids = new Set(existantes.map((a) => a.id));
  const joursManuels = new Set(
    existantes
      .filter((a) => a.type === 'course' && !String(a.id ?? '').startsWith('garmin-'))
      .map((a) => cleJour(a.debut)),
  );

  const ajoutees = [];
  const ignorees = [];
  for (const brute of activitesGarmin ?? []) {
    if (!estUneCourse(brute)) continue;
    const a = versActivite(brute);
    if (a.distance < DISTANCE_MINIMALE) {
      ignorees.push({ id: a.id, raison: `trop courte (${a.distance} m)` });
      continue;
    }
    if (ids.has(a.id)) {
      ignorees.push({ id: a.id, raison: 'déjà là' });
      continue;
    }
    if (joursManuels.has(cleJour(a.debut))) {
      ignorees.push({ id: a.id, raison: 'course saisie à la main le même jour' });
      continue;
    }
    ids.add(a.id);
    ajoutees.push(a);
  }

  if (ajoutees.length === 0) {
    return { carnet: { ...source, maj: majAvant, reglages, activites: existantes }, ajoutees, ignorees };
  }

  const activites = [...existantes, ...ajoutees].sort((a, b) => a.debut - b.debut);
  const maj = Math.max(maintenant, majAvant + 1);
  return { carnet: { ...source, maj, reglages, activites }, ajoutees, ignorees };
}

