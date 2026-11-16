// Découpage du flux du rameur en séances, et calcul du résumé d'une séance.
//
// Fonctions pures : aucune n'écrit nulle part. La page leur passe les mesures
// décodées et enregistre ce qu'elles rendent.
//
// Ce que le rameur fait, constaté le 2026-11-16 (docs/inventaire-bluetooth.md) :
// - son chrono ne compte que le temps ramé, pauses exclues ;
// - après 121 s de pause, il envoie « arrêté » et remet tous ses compteurs à zéro.
// Une séance va donc d'un démarrage à une remise à zéro. Un rechargement de la page
// ne la coupe pas : si les compteurs reprennent là où ils en étaient, c'est la même.

/** Réglage : en dessous de cette durée ramée, une séance est jetée (quelques coups d'essai). */
export const DUREE_MINIMALE_S = 30;

/** Ce qu'on garde d'une mesure : des noms courts, car on en garde une par seconde. */
export function versEchantillon(m) {
  return {
    t: m.tempsEcoule ?? 0,
    d: m.distance ?? 0,
    cad: m.cadence ?? 0,
    all: m.allure ?? 0,
    p: m.puissance ?? 0,
    coups: m.coups ?? 0,
    kcal: m.calories ?? 0,
    res: m.resistance ?? 0,
    fc: m.frequenceCardiaque ?? 0,
  };
}

/**
 * Crée un suivi. `encours` permet de reprendre une séance restée ouverte, après un
 * rechargement : { id, debut, dernier } où `dernier` est son dernier échantillon.
 */
export function creerSuivi(encours = null) {
  let courante = encours ? { ...encours } : null;

  function fermer(evenements, raison) {
    if (!courante) return;
    evenements.push({
      type: courante.dernier.t >= DUREE_MINIMALE_S ? 'fin' : 'jetee',
      id: courante.id,
      raison,
    });
    courante = null;
  }

  return {
    get courante() { return courante; },

    /**
     * Reçoit une mesure décodée et l'heure (ms depuis 1970). Rend la liste des
     * événements à enregistrer : debut, echantillon, fin ou jetee.
     */
    mesure(m, maintenant) {
      const ev = [];
      const e = versEchantillon(m);

      if (e.t === 0 && e.d === 0) { fermer(ev, 'remise-a-zero'); return ev; }

      if (courante && (e.t < courante.dernier.t || e.d < courante.dernier.d)) {
        fermer(ev, 'compteurs-repartis');
      }

      if (!courante) {
        // Le chrono du rameur a pu démarrer avant la connexion : on recule l'heure de début d'autant.
        courante = { id: `s-${maintenant}`, debut: maintenant - e.t * 1000, dernier: null };
        ev.push({ type: 'debut', id: courante.id, debut: courante.debut });
      }

      // Le rameur répète chaque mesure environ quatre fois : on ne garde que ce qui change.
      const d = courante.dernier;
      if (!d || e.t !== d.t || e.d !== d.d || e.coups !== d.coups || e.res !== d.res) {
        courante.dernier = e;
        ev.push({ type: 'echantillon', id: courante.id, e });
      }
      return ev;
    },

    /** Statut décodé de la machine. « arrêté » ferme la séance. */
    statut(s) {
      const ev = [];
      if (s.type === 'arrete') fermer(ev, 'arret');
      return ev;
    },

    /** Ferme la séance sans attendre le rameur (déconnexion longue, fermeture de la page). */
    clore(raison = 'cloture') {
      const ev = [];
      fermer(ev, raison);
      return ev;
    },
  };
}

// ------------------------------------------------------------------ résumé

/** Temps (s) auquel la distance `cible` a été atteinte, par interpolation linéaire. */
function tempsA(echantillons, cible) {
  for (let i = 1; i < echantillons.length; i++) {
    const a = echantillons[i - 1]; const b = echantillons[i];
    if (a.d < cible && b.d >= cible) {
      if (b.d === a.d) return b.t;
      return a.t + ((cible - a.d) / (b.d - a.d)) * (b.t - a.t);
    }
  }
  return null;
}

/**
 * Résumé d'une séance à partir de ses échantillons (dans l'ordre).
 * Les moyennes ne portent que sur le temps ramé : un échantillon compte s'il fait
 * avancer le chrono du rameur, qui s'arrête pendant les pauses.
 */
export function resumer(echantillons) {
  if (!echantillons.length) return null;
  const fin = echantillons.at(-1);
  const duree = fin.t;
  const distance = fin.d;

  let sommeP = 0; let poidsP = 0; let maxP = 0; let sommeCad = 0; let poidsCad = 0;
  for (let i = 1; i < echantillons.length; i++) {
    const dt = echantillons[i].t - echantillons[i - 1].t;
    if (dt <= 0) continue;
    const e = echantillons[i];
    sommeP += e.p * dt; poidsP += dt;
    if (e.cad > 0) { sommeCad += e.cad * dt; poidsCad += dt; }
  }
  for (const e of echantillons) maxP = Math.max(maxP, e.p);

  // Niveau principal : celui où l'on a ramé le plus longtemps.
  const tempsParNiveau = new Map();
  for (let i = 1; i < echantillons.length; i++) {
    const dt = echantillons[i].t - echantillons[i - 1].t;
    if (dt > 0 && echantillons[i].res) tempsParNiveau.set(echantillons[i].res, (tempsParNiveau.get(echantillons[i].res) ?? 0) + dt);
  }
  let niveauPrincipal = null; let meilleur = -1;
  for (const [n, dt] of tempsParNiveau) if (dt > meilleur || (dt === meilleur && n > niveauPrincipal)) { niveauPrincipal = n; meilleur = dt; }

  const passages = [];
  let precedent = echantillons[0].d === 0 ? 0 : null;
  for (let cible = 500; cible <= distance; cible += 500) {
    const t = tempsA(echantillons, cible);
    if (t === null) break;
    passages.push({ distance: cible, temps: Math.round(t), troncon: precedent === null ? null : Math.round(t - precedent) });
    precedent = t;
  }

  return {
    duree,
    distance,
    allureMoyenne: distance > 0 ? Math.round((duree * 500) / distance) : null,
    cadenceMoyenne: poidsCad ? Math.round(sommeCad / poidsCad) : null,
    puissanceMoyenne: poidsP ? Math.round(sommeP / poidsP) : null,
    puissanceMax: maxP || null,
    calories: fin.kcal,
    coups: fin.coups,
    niveauPrincipal,
    passages,
  };
}

// ------------------------------------------------------------------ exports

const COLONNES_ECHANTILLON = ['t', 'd', 'cad', 'all', 'p', 'coups', 'kcal', 'res', 'fc'];
const ENTETES_ECHANTILLON = ['temps_s', 'distance_m', 'cadence', 'allure_s_500m', 'puissance_w', 'coups', 'kcal', 'resistance', 'fc'];

/** CSV d'une séance : une ligne par échantillon. */
export function seanceVersCsv(echantillons) {
  const lignes = [ENTETES_ECHANTILLON.join(',')];
  for (const e of echantillons) lignes.push(COLONNES_ECHANTILLON.map((k) => e[k]).join(','));
  return lignes.join('\n') + '\n';
}

/** CSV de l'historique : une ligne par séance. */
export function historiqueVersCsv(seances) {
  const lignes = ['debut,duree_s,distance_m,allure_moyenne_s_500m,cadence_moyenne,puissance_moyenne_w,puissance_max_w,kcal,coups'];
  for (const s of seances) {
    const r = s.resume ?? {};
    lignes.push([
      new Date(s.debut).toISOString(), r.duree, r.distance, r.allureMoyenne ?? '', r.cadenceMoyenne ?? '',
      r.puissanceMoyenne ?? '', r.puissanceMax ?? '', r.calories, r.coups,
    ].join(','));
  }
  return lignes.join('\n') + '\n';
}

export const FORMAT_EXPORT = 'rameur-historique';
export const VERSION_EXPORT = 1;

/** Contrôle un fichier importé. Rend la liste des séances, ou lève une erreur lisible. */
export function lireImport(texte) {
  let donnees;
  try { donnees = JSON.parse(texte); } catch { throw new Error('Ce fichier n’est pas du JSON.'); }
  if (donnees?.format !== FORMAT_EXPORT || !Array.isArray(donnees.seances)) {
    throw new Error('Ce fichier n’est pas un historique exporté par cette page.');
  }
  for (const s of donnees.seances) {
    if (typeof s.id !== 'string' || typeof s.debut !== 'number' || !Array.isArray(s.echantillons)) {
      throw new Error('Une séance du fichier est incomplète.');
    }
  }
  return donnees.seances;
}
