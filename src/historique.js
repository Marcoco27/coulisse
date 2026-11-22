// Fonctions pures de l'historique : unification, comparaisons, calendrier, groupes.
// Aucun accès au DOM ni au stockage.

import { cleJour, lundiDe } from './objectif.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Ramène séances de rameur et activités à un format commun, du plus récent au plus ancien. */
export function unifier(seancesRameur, activites) {
  const liste = [];
  for (const s of seancesRameur) {
    if (!s.resume) continue; // une séance en cours sans résumé ne compte pas encore
    const r = s.resume;
    liste.push({
      id: s.id,
      debut: s.debut,
      type: 'rameur',
      minutes: (r.duree ?? 0) / 60,
      distance: r.distance ?? null,
      allure: r.allureMoyenne || null,
      puissance: r.puissanceMoyenne ?? null,
      source: s.source ?? 'rameur',
    });
  }
  for (const a of activites) {
    const minutes = Number(a.minutes) || 0;
    const distance = a.distance != null ? Number(a.distance) : null;
    let allure = null;
    if (a.type === 'course' && distance > 0 && minutes > 0) {
      allure = (minutes * 60 * 1000) / distance;
    } else if (a.type === 'rameur' && distance > 0 && minutes > 0) {
      allure = (minutes * 60 * 500) / distance;
    }
    liste.push({
      id: a.id,
      debut: a.debut,
      type: a.type,
      minutes,
      distance,
      allure,
      puissance: null,
      source: a.source ?? null,
    });
  }
  return liste.sort((a, b) => b.debut - a.debut);
}

/** Compare l'allure d'une séance à la moyenne des cinq précédentes du même type. */
export function comparer(seance, toutes) {
  if (!seance || seance.allure == null || (seance.type !== 'rameur' && seance.type !== 'course')) {
    return { ecart: null, texte: 'allure habituelle' };
  }
  const precedentes = toutes
    .filter((s) => s.type === seance.type && s.allure != null && s.debut < seance.debut)
    .sort((a, b) => b.debut - a.debut)
    .slice(0, 5);
  if (precedentes.length === 0) {
    return { ecart: null, texte: 'allure habituelle' };
  }
  const moyenne = precedentes.reduce((somme, s) => somme + s.allure, 0) / precedentes.length;
  const ecart = moyenne - seance.allure; // positif : plus vite que d'habitude
  const unite = seance.type === 'rameur' ? '500 m' : 'km';
  if (Math.abs(ecart) < 3) {
    return { ecart, texte: 'allure habituelle' };
  }
  if (ecart > 0) {
    return { ecart, texte: `${Math.round(ecart)} s/${unite} plus vite que d’habitude` };
  }
  return { ecart, texte: `${Math.round(-ecart)} s/${unite} plus lent que d’habitude` };
}

/** Calendrier thermique : 53 semaines du lundi au dimanche, la dernière est la semaine courante. */
export function calendrier(liste, maintenant) {
  const lundiCourant = lundiDe(maintenant);
  const premierLundi = new Date(lundiCourant);
  premierLundi.setDate(premierLundi.getDate() - 52 * 7);
  const debut = new Date(premierLundi);
  const fin = new Date(lundiCourant);
  fin.setDate(fin.getDate() + 6);
  fin.setHours(23, 59, 59, 999);

  const parJour = new Map();
  for (const s of liste) {
    const d = new Date(s.debut);
    if (d < debut || d > fin) continue;
    const cle = cleJour(d);
    if (!parJour.has(cle)) {
      parJour.set(cle, { minutesRameur: 0, minutesFooting: 0, seances: [] });
    }
    const jour = parJour.get(cle);
    jour.seances.push(s.id);
    if (s.type === 'rameur') jour.minutesRameur += s.minutes || 0;
    else if (s.type === 'course') jour.minutesFooting += s.minutes || 0;
  }

  const semaines = [];
  for (let i = 0; i < 53; i++) {
    const semaine = [];
    for (let j = 0; j < 7; j++) {
      const d = new Date(premierLundi);
      d.setDate(d.getDate() + i * 7 + j);
      const cle = cleJour(d);
      const existant = parJour.get(cle);
      const minutesRameur = existant?.minutesRameur ?? 0;
      const minutesFooting = existant?.minutesFooting ?? 0;
      const total = minutesRameur + minutesFooting;
      let cran = 0;
      if (total > 0) {
        if (total < 30) cran = 1;
        else if (total < 60) cran = 2;
        else if (total < 120) cran = 3;
        else cran = 4;
      }
      semaine.push({
        cle,
        minutesRameur,
        minutesFooting,
        cran,
        seances: existant?.seances ?? [],
      });
    }
    semaines.push(semaine);
  }
  return semaines;
}

/** Médianes d'allure par mois local, triées chronologiquement. */
export function medianesMensuelles(points) {
  const groupes = new Map();
  for (const p of points) {
    if (p.allure == null) continue;
    const d = new Date(p.debut);
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(p.allure);
  }
  const resultat = [];
  for (const [mois, valeurs] of groupes) {
    valeurs.sort((a, b) => a - b);
    const milieu = Math.floor(valeurs.length / 2);
    const mediane = valeurs.length % 2
      ? valeurs[milieu]
      : (valeurs[milieu - 1] + valeurs[milieu]) / 2;
    resultat.push({ mois, mediane });
  }
  return resultat.sort((a, b) => a.mois.localeCompare(b.mois));
}

/** Groupes par mois local, avec les totaux du mois. */
export function grouperParMois(liste) {
  const groupes = new Map();
  for (const s of liste) {
    const d = new Date(s.debut);
    const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        cle,
        titre: `${MOIS[d.getMonth()]} ${d.getFullYear()}`,
        totalMinutes: 0,
        totalDistance: 0,
        nombre: 0,
        seances: [],
      });
    }
    const g = groupes.get(cle);
    g.seances.push(s);
    g.totalMinutes += s.minutes || 0;
    g.totalDistance += s.distance || 0;
    g.nombre++;
  }
  return [...groupes.values()]
    .sort((a, b) => b.cle.localeCompare(a.cle))
    .map((g) => ({ ...g, seances: g.seances.sort((a, b) => b.debut - a.debut) }));
}

/** Moyenne glissante centrée, en ignorant les trous (null). */
export function lisser(valeurs, fenetre) {
  const n = valeurs.length;
  const f = Math.max(1, Math.round(fenetre));
  if (f <= 1) return valeurs.slice();
  const demi = Math.floor(f / 2);
  const resultat = new Array(n);
  for (let i = 0; i < n; i++) {
    if (valeurs[i] == null) {
      resultat[i] = null;
      continue;
    }
    let somme = 0;
    let compte = 0;
    for (let j = i - demi; j <= i + demi; j++) {
      if (j < 0 || j >= n) continue;
      const v = valeurs[j];
      if (v != null) {
        somme += v;
        compte++;
      }
    }
    resultat[i] = compte ? somme / compte : null;
  }
  return resultat;
}

/** Secondes par unité en « m:ss ». */
export function formaterAllure(s) {
  if (s == null || !Number.isFinite(s)) return '–';
  const total = Math.max(0, Math.round(s));
  const minutes = Math.floor(total / 60);
  const secondes = total % 60;
  return `${minutes}:${String(secondes).padStart(2, '0')}`;
}
