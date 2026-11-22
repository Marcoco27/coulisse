// Fonctions pures de l'historique : unification, comparaisons, groupes.
// Aucun accès au DOM ni au stockage.

import { cleJour, lundiDe } from './objectif.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Une séance de rameur plus courte que ce seuil (en secondes) est un faux départ : elle ne compte pas. */
export const DUREE_MINIMALE_SECONDES = 60;

/** Ramène séances de rameur et activités à un format commun, du plus récent au plus ancien. */
export function unifier(seancesRameur, activites) {
  const liste = [];
  for (const s of seancesRameur) {
    if (!s.resume) continue; // une séance en cours sans résumé ne compte pas encore
    const r = s.resume;
    if ((r.duree ?? 0) < DUREE_MINIMALE_SECONDES) continue;
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

function medianeNombres(valeurs) {
  if (!valeurs.length) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 ? tri[milieu] : (tri[milieu - 1] + tri[milieu]) / 2;
}

/** Semaines du lundi au dimanche, de la plus ancienne à la semaine courante. */
export function semainesRecentes(liste, maintenant, nombre = 12, statuts = new Map()) {
  const totalSemaines = Math.max(0, Math.floor(nombre));
  const lundiCourant = lundiDe(maintenant);
  const [annee, mois, jour] = lundiCourant.split('-').map(Number);
  const semaines = [];
  const parLundi = new Map();

  for (let i = 0; i < totalSemaines; i++) {
    const decalage = (i - (totalSemaines - 1)) * 7;
    const dateLundi = new Date(annee, mois - 1, jour + decalage);
    const lundi = cleJour(dateLundi);
    const jours = [];
    const parCle = new Map();

    for (let j = 0; j < 7; j++) {
      const d = new Date(dateLundi.getFullYear(), dateLundi.getMonth(), dateLundi.getDate() + j);
      const cle = cleJour(d);
      const jourSemaine = { cle, minutes: 0, types: [] };
      jours.push(jourSemaine);
      parCle.set(cle, jourSemaine);
    }

    const info = statuts.get(lundi);
    const semaine = {
      lundi,
      jours,
      seances: [],
      minutes: { rameur: 0, course: 0, autre: 0 },
      total: 0,
      joursActifs: 0,
      statut: info?.statut ?? null,
      objectif: info?.objectif ?? null,
    };
    semaines.push(semaine);
    parLundi.set(lundi, { semaine, parCle });
  }

  const ordre = ['rameur', 'course', 'autre'];
  for (const s of liste) {
    const lundi = lundiDe(s.debut);
    const entree = parLundi.get(lundi);
    if (!entree) continue;
    const { semaine, parCle } = entree;
    const cle = cleJour(s.debut);
    const jourSemaine = parCle.get(cle);
    if (!jourSemaine) continue;

    const famille = s.type === 'rameur' ? 'rameur' : s.type === 'course' ? 'course' : 'autre';
    const minutes = Number(s.minutes) || 0;
    jourSemaine.minutes += minutes;
    if (!jourSemaine.types.includes(famille)) jourSemaine.types.push(famille);
    semaine.minutes[famille] += minutes;
    semaine.total += minutes;
    semaine.seances.push(s);
  }

  for (const semaine of semaines) {
    semaine.seances.sort((a, b) => a.debut - b.debut);
    semaine.joursActifs = semaine.jours.filter((j) => j.types.length > 0).length;
    for (const jourSemaine of semaine.jours) {
      jourSemaine.types.sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b));
    }
  }

  return semaines;
}

const JOUR_MS = 86400000;
export const MINUTES_CONSEILLEES = 150;

/**
 * Élan de la semaine : où en est la semaine courante, sport par sport, et une
 * phrase d'encouragement fondée sur les chiffres (jamais une promesse).
 * `semaines` vient de semainesRecentes : la dernière est la semaine courante.
 */
export function elan(liste, semaines, maintenant) {
  const instant = maintenant instanceof Date ? maintenant.getTime() : Number(maintenant);
  const courante = semaines[semaines.length - 1];
  const precedente = semaines.length >= 2 ? semaines[semaines.length - 2] : null;
  if (!courante) return null;

  const derniere = (type) => {
    const s = liste.filter((x) => x.type === type && x.debut <= instant)
      .reduce((a, b) => (a && a.debut > b.debut ? a : b), null);
    return s ? Math.floor((instant - s.debut) / JOUR_MS) : null;
  };
  const sports = ['rameur', 'course'].map((type) => ({
    type,
    minutes: courante.minutes[type] || 0,
    seances: courante.seances.filter((s) => s.type === type).length,
    joursDepuis: derniere(type),
  }));

  const total = courante.total;
  const part = Math.min(1, total / MINUTES_CONSEILLEES);
  const jourSemaine = (new Date(instant).getDay() + 6) % 7; // lundi = 0
  const joursRestants = 6 - jourSemaine; // jours après aujourd'hui
  const reste = courante.objectif != null ? Math.max(0, courante.objectif - courante.joursActifs) : null;
  const aujourdhuiActif = courante.jours[jourSemaine]?.types.length > 0;
  const course = sports[1];
  const rameur = sports[0];

  let titre;
  let texte;
  let ton = 'elan';
  if (courante.statut === 'tenue' || (reste === 0 && courante.objectif != null)) {
    titre = 'Semaine gagnée';
    texte = total >= MINUTES_CONSEILLEES
      ? `Objectif tenu et ${Math.round(total)} minutes au compteur : la dose conseillée est atteinte.`
      : 'Objectif tenu. Tout ce qui vient maintenant est du bonus.';
    ton = 'victoire';
  } else if (total === 0) {
    titre = jourSemaine === 0 ? 'Nouvelle semaine, page blanche' : 'La semaine attend son premier coup de rame';
    texte = 'Quinze minutes suffisent pour ouvrir le compteur. Le plus dur, c’est de s’asseoir.';
  } else if (reste != null && reste > joursRestants + (aujourdhuiActif ? 0 : 1)) {
    titre = 'Pas cette fois, mais rien n’est perdu';
    texte = `${Math.round(total)} minutes déjà faites cette semaine. Chaque séance compte pour la forme, même quand l’objectif file.`;
    if (joursRestants === 0) texte += ' Demain, le compteur repart à zéro.';
  } else if (reste != null) {
    titre = `Encore ${reste} ${reste > 1 ? 'jours actifs' : 'jour actif'}`;
    const marge = joursRestants + (aujourdhuiActif ? 0 : 1);
    texte = `Il reste ${marge} ${marge > 1 ? 'jours' : 'jour'} au calendrier : c’est jouable.`;
  } else {
    titre = `${Math.round(total)} minutes cette semaine`;
    texte = 'Chaque minute compte, et elles s’additionnent.';
  }

  let coupDePouce = null;
  if (course.seances === 0 && rameur.seances > 0) {
    coupDePouce = course.joursDepuis != null
      ? `Les baskets attendent depuis ${course.joursDepuis} jours : un footing cette semaine, et elle devient complète.`
      : 'Un footing cette semaine, et elle devient complète.';
  } else if (rameur.seances === 0 && course.seances > 0) {
    coupDePouce = rameur.joursDepuis != null
      ? `Le rameur n’a pas servi depuis ${rameur.joursDepuis} jours : quinze minutes, et les deux sports sont au rendez-vous.`
      : 'Quinze minutes de rameur, et les deux sports sont au rendez-vous.';
  } else if (precedente && total > precedente.total && precedente.total > 0) {
    coupDePouce = `Déjà ${Math.round(total - precedente.total)} minutes de plus que la semaine dernière.`;
  } else if (total < MINUTES_CONSEILLEES && total > 0) {
    coupDePouce = `${Math.round(MINUTES_CONSEILLEES - total)} minutes encore pour la dose conseillée de ${MINUTES_CONSEILLEES} minutes.`;
  }

  return { titre, texte, coupDePouce, ton, total, part, sports, reste, objectif: courante.objectif };
}

/** Tendance d'allure : lot récent, lot précédent et écart, sans valeurs aberrantes. */
export function tendance(liste, type, taille = 5) {
  const lot = Math.max(1, Math.floor(taille));
  const filtrees = liste.filter((s) => s.type === type
    && s.allure != null
    && (Number(s.minutes) || 0) >= 5);

  const mediane = medianeNombres(filtrees.map((s) => s.allure));
  const gardees = mediane == null
    ? []
    : filtrees.filter((s) => s.allure <= mediane * 1.3);

  gardees.sort((a, b) => a.debut - b.debut);
  const points = gardees.map((s) => ({ id: s.id, debut: s.debut, allure: s.allure }));
  const recentes = points.slice(-lot);
  const avantPoints = points.slice(
    Math.max(0, points.length - lot * 2),
    Math.max(0, points.length - lot),
  );

  const actuelle = medianeNombres(recentes.map((p) => p.allure));
  const avant = avantPoints.length >= 2
    ? medianeNombres(avantPoints.map((p) => p.allure))
    : null;
  const ecart = avant != null && actuelle != null ? avant - actuelle : null;

  return { points, actuelle, avant, ecart, nombre: recentes.length };
}
