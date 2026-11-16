// L'objectif de la semaine : compte des jours actifs, réserve, série, progression.
//
// Fonctions pures. Chaque règle porte en commentaire son numéro dans
// docs/bases-scientifiques.md. Une valeur notée « convention » dans ce relevé est un
// réglage, avec sa valeur par défaut ici.

export const REGLAGES_PAR_DEFAUT = {
  objectifs: [],            // [{ depuis: 'AAAA-MM-JJ' (un lundi), seances: n }] — R1, R10
  jokersParBloc: 3,         // R7 : convention, réglée par l'utilisateur
  semainesParBloc: 12,      // R7 : convention, même proportion qu'une semaine sur quatre
  repereMinutes: 150,       // R2
  repereRenforcement: 2,    // R5
  dureeSeanceCourteMin: 10, // R4 : convention
  revisionToutesLes: 4,     // R10 : convention, en semaines
  derniereRevision: null,   // lundi de la semaine où l'objectif a été revu
  dureeCibleMin: 15,        // progression : durée d'une séance « complète » (choix de l'utilisateur)
  seancesParPalier: 3,      // progression : séances complètes avant de monter d'un niveau (choix de l'utilisateur)
  deplacements: [],         // lundis des semaines déclarées en déplacement — R8
};

const JOUR_MS = 86_400_000;

// ------------------------------------------------------------------ dates (heure locale)

function aMinuit(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** Clé AAAA-MM-JJ d'une date, en heure locale. */
export function cleJour(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function depuisCle(cle) { const [a, m, j] = cle.split('-').map(Number); return new Date(a, m - 1, j); }

/** Lundi de la semaine d'une date (la semaine va du lundi au dimanche). */
export function lundiDe(d) {
  const x = aMinuit(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return cleJour(x);
}

function ajouterJours(cle, n) { const x = depuisCle(cle); x.setDate(x.getDate() + n); return cleJour(x); }

/** Nombre de semaines entre deux lundis. Arrondi : un changement d'heure ne fait pas 6,96 semaines. */
function ecartSemaines(lundiA, lundiB) {
  return Math.round((depuisCle(lundiB) - depuisCle(lundiA)) / (7 * JOUR_MS));
}

// ------------------------------------------------------------------ objectif en vigueur

export function objectifPour(reglages, lundi) {
  let valeur = null;
  for (const o of [...reglages.objectifs].sort((a, b) => a.depuis.localeCompare(b.depuis))) {
    if (o.depuis <= lundi) valeur = o.seances;
  }
  return valeur;
}

// ------------------------------------------------------------------ bilan

/**
 * activites : [{ debut (ms), minutes, type: 'rameur' | 'course' | 'renforcement' | 'autre' }]
 * Rend le bilan de la semaine en cours et l'historique des semaines depuis le premier objectif.
 */
export function bilan(activites, reglagesPartiels, maintenant) {
  const reglages = { ...REGLAGES_PAR_DEFAUT, ...reglagesPartiels };
  const lundiCourant = lundiDe(maintenant);
  const premiers = reglages.objectifs.map((o) => o.depuis).sort();
  const lundiDepart = premiers[0] ?? lundiCourant;
  const deplacements = new Set(reglages.deplacements);

  // Regroupement par semaine et par jour.
  const parSemaine = new Map();
  for (const a of activites) {
    const lundi = lundiDe(a.debut);
    if (!parSemaine.has(lundi)) parSemaine.set(lundi, []);
    parSemaine.get(lundi).push(a);
  }
  const resumeSemaine = (lundi) => {
    const liste = parSemaine.get(lundi) ?? [];
    const jours = new Set(liste.map((a) => cleJour(a.debut)));          // R3 : toute activité compte, sans durée minimale
    const joursRenfo = new Set(liste.filter((a) => a.type === 'renforcement').map((a) => cleJour(a.debut)));
    return {
      lundi,
      jours: jours.size,
      joursActifs: [...Array(7)].map((_, i) => jours.has(ajouterJours(lundi, i))),
      minutes: Math.round(liste.reduce((s, a) => s + a.minutes, 0)), // R2, R13 : toutes les minutes comptent comme modérées
      renforcement: joursRenfo.size,                                  // R5 : le rameur n'y compte pas
    };
  };

  // Semaines passées, du premier objectif à la semaine précédente.
  const semaines = [];
  const nbSemaines = Math.max(0, ecartSemaines(lundiDepart, lundiCourant));
  const jokersUtilises = new Map(); // bloc -> nombre
  for (let i = 0; i < nbSemaines; i++) {
    const lundi = ajouterJours(lundiDepart, 7 * i);
    const s = resumeSemaine(lundi);
    const objectif = objectifPour(reglages, lundi);
    const bloc = Math.floor(i / reglages.semainesParBloc);
    if (deplacements.has(lundi)) s.statut = 'deplacement';             // R8 : neutre
    else if (objectif === null || s.jours >= objectif) s.statut = 'tenue';
    else if ((jokersUtilises.get(bloc) ?? 0) < reglages.jokersParBloc) { // R7
      s.statut = 'joker';
      jokersUtilises.set(bloc, (jokersUtilises.get(bloc) ?? 0) + 1);
    } else s.statut = 'manquee';
    s.objectif = objectif;
    semaines.push(s);
  }

  // Semaine en cours.
  const courante = resumeSemaine(lundiCourant);
  courante.objectif = objectifPour(reglages, lundiCourant);
  courante.deplacement = deplacements.has(lundiCourant);
  courante.statut = courante.deplacement ? 'deplacement'
    : courante.objectif !== null && courante.jours >= courante.objectif ? 'tenue' : 'en-cours';

  // R6 : total des semaines tenues (ne retombe jamais à zéro), puis série en cours.
  const toutes = [...semaines, courante];
  const semainesTenues = toutes.filter((s) => s.statut === 'tenue').length;
  let serie = 0;
  for (let i = toutes.length - 1; i >= 0; i--) {
    const st = toutes[i].statut;
    if (st === 'manquee') break;
    if (st === 'tenue') serie++;
    // 'joker', 'deplacement', 'en-cours' : ne cassent pas la série, ne l'allongent pas.
  }

  // R7 : réserve restante dans le bloc en cours.
  const blocCourant = Math.floor(nbSemaines / reglages.semainesParBloc);
  const reserve = reglages.jokersParBloc - (jokersUtilises.get(blocCourant) ?? 0);
  const semainesAvantNouveauBloc = reglages.semainesParBloc - (nbSemaines % reglages.semainesParBloc);

  // R10 : proposer de revoir l'objectif toutes les quatre semaines.
  const reference = reglages.derniereRevision ?? lundiDepart;
  const revisionDue = premiers.length > 0 && ecartSemaines(reference, lundiCourant) >= reglages.revisionToutesLes;

  // R9 : hier sans activité, aujourd'hui non plus. Le message, lui, est écrit par la page.
  const aujourdhui = cleJour(maintenant);
  const hier = ajouterJours(aujourdhui, -1);
  const joursActifs = new Set(activites.map((a) => cleJour(a.debut)));
  const hierSansSeance = !joursActifs.has(hier) && !joursActifs.has(aujourdhui) && activites.some((a) => a.debut < aMinuit(maintenant).getTime());

  return {
    courante,
    semaines,
    semainesTenues,
    serie,
    reserve,
    jokersParBloc: reglages.jokersParBloc,
    semainesAvantNouveauBloc,
    revisionDue,
    hierSansSeance,
    aujourdhuiActif: joursActifs.has(aujourdhui),
    reglages,
  };
}

// ------------------------------------------------------------------ progression du niveau de force
// Règle choisie par l'utilisateur le 2026-11-16, sans fondement dans le relevé :
// monter d'un niveau après trois séances complètes au même niveau ou au-dessus.

/**
 * seances : séances de rameur dans l'ordre chronologique, { duree (s), niveau }.
 * Rend { niveau, raison } ou null s'il n'y a encore aucune séance.
 */
export function suggererNiveau(seances, reglagesPartiels, niveauMax = 15) {
  const r = { ...REGLAGES_PAR_DEFAUT, ...reglagesPartiels };
  const avecNiveau = seances.filter((s) => s.niveau);
  if (!avecNiveau.length) return null;
  const completes = avecNiveau.filter((s) => s.duree >= r.dureeCibleMin * 60);
  if (!completes.length) {
    return { niveau: avecNiveau.at(-1).niveau, raison: `Aucune séance de ${r.dureeCibleMin} minutes encore : même niveau que la dernière fois.` };
  }
  const niveau = completes.at(-1).niveau;
  let suite = 0;
  for (let i = completes.length - 1; i >= 0 && completes[i].niveau >= niveau; i--) suite++;
  if (suite >= r.seancesParPalier && niveau < niveauMax) {
    return { niveau: niveau + 1, raison: `${suite} séances complètes au niveau ${niveau} : on monte d'un cran.` };
  }
  const reste = r.seancesParPalier - suite;
  return {
    niveau,
    raison: niveau >= niveauMax ? 'Niveau maximal.' : `Encore ${reste} séance${reste > 1 ? 's' : ''} complète${reste > 1 ? 's' : ''} au niveau ${niveau} avant de monter.`,
  };
}
