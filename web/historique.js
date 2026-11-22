// Écran Historique : dernière séance, semaines, tendances, liste et détail.
// Rendu par création d'éléments ; les données ne passent jamais par innerHTML.

import {
  unifier, comparer, grouperParMois, lisser, formaterAllure, semainesRecentes, tendance,
  elan, MINUTES_CONSEILLEES,
} from '../src/historique.js';
import { bilan, cleJour } from '../src/objectif.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const nombre = new Intl.NumberFormat('fr-FR');
const formatDateLongue = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' });
const formatDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const formatHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const formatMoisCourt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const formatDateLigne = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const LETTRES_JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const ORDRE_FAMILLES = ['rameur', 'course', 'autre'];
const NOMS_TYPE = {
  rameur: 'Rameur',
  course: 'Footing',
  renforcement: 'Renforcement',
  autre: 'Autre',
};

function mmss(secondes) {
  if (secondes == null || !Number.isFinite(secondes)) return '–';
  const s = Math.max(0, Math.round(secondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function distanceTexte(m, type) {
  if (m == null || !Number.isFinite(m)) return '–';
  if (type === 'rameur') return `${nombre.format(Math.round(m))} m`;
  return `${(m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} km`;
}

function formaterDateRelative(debut, maintenant = new Date()) {
  const d = new Date(debut);
  const auj = cleJour(maintenant);
  const jour = cleJour(d);
  if (jour === auj) return `aujourd’hui, ${formatHeure.format(d).replace(':', ' h ')}`;
  const hier = new Date(maintenant);
  hier.setDate(hier.getDate() - 1);
  if (jour === cleJour(hier)) return `hier, ${formatHeure.format(d).replace(':', ' h ')}`;
  const diff = (new Date(auj + 'T12:00:00') - new Date(jour + 'T12:00:00')) / 86400000;
  if (diff > 0 && diff < 7) {
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(d);
  }
  return formatDate.format(d);
}

function dureeCumulee(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')}`;
}

function pluriel(n, singulier, plurielMot) {
  return n > 1 ? plurielMot : singulier;
}

function dateDepuisCle(cle) {
  const [annee, mois, jour] = cle.split('-').map(Number);
  return new Date(annee, mois - 1, jour, 12);
}

function ajouterJoursCle(cle, n) {
  const d = dateDepuisCle(cle);
  return cleJour(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12));
}

function plageDates(lundi, dimanche) {
  const d1 = dateDepuisCle(lundi);
  const d2 = dateDepuisCle(dimanche);
  const jour = (d) => (d.getDate() === 1 ? '1er' : String(d.getDate()));
  const mois1 = MOIS_LONGS[d1.getMonth()];
  const mois2 = MOIS_LONGS[d2.getMonth()];
  if (d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()) {
    return `du ${jour(d1)} au ${jour(d2)} ${mois2}`;
  }
  if (d1.getFullYear() === d2.getFullYear()) {
    return `du ${jour(d1)} ${mois1} au ${jour(d2)} ${mois2}`;
  }
  return `du ${jour(d1)} ${mois1} ${d1.getFullYear()} au ${jour(d2)} ${mois2} ${d2.getFullYear()}`;
}

function couleurType(type) {
  if (type === 'rameur') return 'var(--rameur)';
  if (type === 'course') return 'var(--footing)';
  return 'var(--autre)';
}

function elNS(nom, attributs = {}) {
  const e = document.createElementNS(NS, nom);
  for (const [cle, valeur] of Object.entries(attributs)) e.setAttribute(cle, valeur);
  return e;
}

function libelleJourComplet(date, jour) {
  const parties = [formatDateLongue.format(date)];
  if (jour.types.length === 0) {
    parties.push('aucune activité');
  } else {
    parties.push(`${Math.round(jour.minutes)} min`);
    parties.push(jour.types.map((f) => NOMS_TYPE[f].toLowerCase()).join(' et '));
  }
  return parties.join(', ');
}

/** Courbe d'allure d'une séance de rameur : plus haut = plus vite, lissée sur 10 s. */
export function dessinerCourbe(conteneur, echantillons) {
  conteneur.replaceChildren();
  if (!echantillons || echantillons.length === 0) return;

  // Les dernières secondes d'une séance sont celles de l'arrêt : l'allure s'effondre.
  // On retire de la fin tout échantillon nettement plus lent que l'allure médiane.
  const allures = echantillons.map((e) => e.all).filter((a) => a > 0).sort((a, b) => a - b);
  if (allures.length > 0) {
    const mediane = allures[Math.floor(allures.length / 2)];
    let fin = echantillons.length;
    while (fin > 2 && !(echantillons[fin - 1].all > 0 && echantillons[fin - 1].all <= mediane * 1.25)) fin--;
    echantillons = echantillons.slice(0, fin);
  }

  const valeurs = echantillons.map((e) => (e.all > 0 ? e.all : null));
  const lisse = lisser(valeurs, 10);
  const points = [];
  for (let i = 0; i < echantillons.length; i++) {
    if (lisse[i] != null && echantillons[i].all > 0) {
      points.push({ t: echantillons[i].t, all: lisse[i] });
    }
  }
  if (points.length < 2) return;

  const largeur = 400;
  const hauteur = 120;
  const marge = 6;
  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const minA = Math.min(...points.map((p) => p.all));
  const maxA = Math.max(...points.map((p) => p.all));
  const spanT = maxT - minT || 1;
  const spanA = maxA - minA || 1;
  const x = (t) => marge + ((t - minT) / spanT) * (largeur - 2 * marge);
  const y = (a) => marge + ((a - minA) / spanA) * (hauteur - 2 * marge);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'historique-courbe-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Allure au 500 mètres au fil de la séance, plus haut signifie plus vite.');

  const polyline = document.createElementNS(NS, 'polyline');
  polyline.setAttribute('points', points.map((p) => `${x(p.t)},${y(p.all)}`).join(' '));
  polyline.setAttribute('class', 'historique-courbe-ligne');
  svg.append(polyline);
  conteneur.append(svg);
}

export function creerHistorique({ db, lireCarnet, ouvrirResume, maintenant = () => Date.now() }) {
  const el = {
    vide: $('historique-vide'),
    contenu: $('historique-contenu'),
    elan: $('historique-elan'),
    derniere: $('historique-derniere'),
    semaines: $('historique-semaines'),
    tendances: $('historique-tendances'),
    filtres: $('historique-filtres'),
    liste: $('historique-liste'),
    message: $('historique-message'),
    dialog: $('historique-dialog'),
    dialogTitre: $('historique-dialog-titre'),
    dialogContenu: $('historique-dialog-contenu'),
  };

  let liste = [];
  let reglages = {};
  let statuts = new Map();
  let instant = new Date();
  let periode = 12;
  let lundiChoisi = null;
  let semainesAffichees = [];
  let indexChoisi = 0;
  let filtre = 'tout';
  let moisAffiches = 3;
  let squeletteSemainesConstruit = false;
  let observerGraphique = null;
  let derniereLargeurGraphique = 0;
  const refs = {};

  if (el.dialog && typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
    let pressedOutside = false;
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    el.dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, el.dialog); });
    el.dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, el.dialog)) el.dialog.close();
    });
  }

  function creerFiltres() {
    el.filtres.replaceChildren();
    for (const [valeur, label] of [['tout', 'Tout'], ['rameur', 'Rameur'], ['course', 'Footing']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pastille-filtre';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(filtre === valeur));
      b.addEventListener('click', () => {
        filtre = valeur;
        moisAffiches = 3;
        creerFiltres();
        rendreListe();
      });
      el.filtres.append(b);
    }
  }

  function ouvrirDetail(seance) {
    if (seance.type === 'rameur') {
      ouvrirResume(seance.id);
      return;
    }
    el.dialogTitre.textContent = `${NOMS_TYPE[seance.type] ?? seance.type} du ${formatDate.format(new Date(seance.debut))}`;
    el.dialogContenu.replaceChildren();

    const dl = document.createElement('dl');
    dl.className = 'chiffres';
    const ajouter = (titre, valeur) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = titre;
      const dd = document.createElement('dd');
      dd.textContent = valeur;
      div.append(dt, dd);
      dl.append(div);
    };
    ajouter('Durée', mmss(seance.minutes * 60));
    if (seance.distance != null) ajouter('Distance', distanceTexte(seance.distance, seance.type));
    if (seance.allure != null) ajouter('Allure', `${formaterAllure(seance.allure)} ${seance.type === 'rameur' ? '/500 m' : '/km'}`);
    if (seance.puissance != null) ajouter('Puissance moyenne', `${Math.round(seance.puissance)} W`);
    if (seance.source) ajouter('Source', seance.source);
    el.dialogContenu.append(dl);

    if (seance.type === 'course') {
      const c = comparer(seance, liste);
      const p = document.createElement('p');
      p.className = 'historique-comparaison';
      p.textContent = c.texte;
      el.dialogContenu.append(p);
    }
    if (!el.dialog.open) el.dialog.showModal();
  }

  function rendreElan() {
    if (!el.elan) return;
    el.elan.replaceChildren();
    const semaines = semainesRecentes(liste, instant, 2, statuts);
    const e = elan(liste, semaines, instant);
    if (!e) {
      el.elan.hidden = true;
      return;
    }
    el.elan.hidden = false;
    el.elan.dataset.ton = e.ton;

    const surtitre = document.createElement('span');
    surtitre.className = 'historique-surtitre';
    surtitre.textContent = 'Votre semaine';
    const titre = document.createElement('h2');
    titre.className = 'elan-titre';
    titre.textContent = e.titre;
    const texte = document.createElement('p');
    texte.className = 'elan-texte';
    texte.textContent = e.texte;

    // Jauge vers les minutes conseillées, empilée par sport.
    const jauge = document.createElement('div');
    jauge.className = 'elan-jauge';
    jauge.setAttribute('role', 'img');
    jauge.setAttribute('aria-label', `${Math.round(e.total)} minutes sur ${MINUTES_CONSEILLEES} conseillées`);
    const echelle = Math.max(MINUTES_CONSEILLEES, e.total);
    for (const s of e.sports) {
      if (s.minutes <= 0) continue;
      const seg = document.createElement('span');
      seg.className = `elan-segment type-${s.type}`;
      seg.style.width = `${(s.minutes / echelle) * 100}%`;
      jauge.append(seg);
    }
    const jaugeLegende = document.createElement('p');
    jaugeLegende.className = 'elan-jauge-legende';
    const fait = document.createElement('strong');
    fait.textContent = `${Math.round(e.total)} min`;
    jaugeLegende.append(fait, ` sur ${MINUTES_CONSEILLEES} conseillées`);

    // Les deux sports, toujours présents, même à zéro.
    const sports = document.createElement('div');
    sports.className = 'elan-sports';
    for (const s of e.sports) {
      const carte = document.createElement('div');
      carte.className = `elan-sport type-${s.type}`;
      if (s.seances === 0) carte.classList.add('a-faire');
      const nom = document.createElement('span');
      nom.className = 'elan-sport-nom';
      nom.textContent = NOMS_TYPE[s.type];
      const valeur = document.createElement('span');
      valeur.className = 'elan-sport-valeur';
      valeur.textContent = `${Math.round(s.minutes)} min`;
      const detail = document.createElement('span');
      detail.className = 'elan-sport-detail';
      if (s.seances > 0) {
        detail.textContent = `${s.seances} ${pluriel(s.seances, 'séance', 'séances')}`;
      } else if (s.joursDepuis != null) {
        detail.textContent = s.joursDepuis === 0 ? 'pas encore cette semaine'
          : `dernier il y a ${s.joursDepuis} ${pluriel(s.joursDepuis, 'jour', 'jours')}`;
      } else {
        detail.textContent = 'pas encore';
      }
      carte.append(nom, valeur, detail);
      sports.append(carte);
    }

    el.elan.append(surtitre, titre, texte, jauge, jaugeLegende, sports);
    if (e.coupDePouce) {
      const p = document.createElement('p');
      p.className = 'elan-pouce';
      p.textContent = e.coupDePouce;
      el.elan.append(p);
    }
  }

  async function rendreDerniere() {
    el.derniere.replaceChildren();
    const derniere = liste.find((s) => s.type === 'rameur' || s.type === 'course') ?? liste[0];
    if (!derniere) {
      el.derniere.hidden = true;
      return;
    }
    el.derniere.hidden = false;

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'historique-derniere-bouton';
    bouton.addEventListener('click', () => ouvrirDetail(derniere));

    const entete = document.createElement('div');
    entete.className = 'historique-entete';
    const surtitre = document.createElement('span');
    surtitre.className = 'historique-surtitre';
    surtitre.textContent = 'Dernière séance';
    const pastille = document.createElement('span');
    pastille.className = `pastille type-${derniere.type}`;
    pastille.textContent = NOMS_TYPE[derniere.type] ?? derniere.type;
    const date = document.createElement('span');
    date.className = 'historique-date';
    date.textContent = formaterDateRelative(derniere.debut, instant);
    entete.append(surtitre, pastille, date);
    bouton.append(entete);

    const chiffres = document.createElement('div');
    chiffres.className = 'historique-grands-chiffres';
    const ajouterChiffre = (valeur, libelle) => {
      const div = document.createElement('div');
      div.className = 'historique-chiffre';
      const v = document.createElement('span');
      v.className = 'historique-chiffre-valeur';
      v.textContent = valeur;
      const t = document.createElement('span');
      t.className = 'historique-chiffre-titre';
      t.textContent = libelle;
      div.append(v, t);
      chiffres.append(div);
    };
    ajouterChiffre(mmss(derniere.minutes * 60), 'durée');
    if (derniere.distance != null) ajouterChiffre(distanceTexte(derniere.distance, derniere.type), 'distance');
    if (derniere.allure != null) {
      ajouterChiffre(formaterAllure(derniere.allure), `allure ${derniere.type === 'rameur' ? '/500 m' : '/km'}`);
    }
    if (derniere.puissance != null) ajouterChiffre(`${Math.round(derniere.puissance)} W`, 'puissance');
    bouton.append(chiffres);

    const c = comparer(derniere, liste);
    if (c.ecart != null) {
      const p = document.createElement('p');
      p.className = 'historique-comparaison';
      if (Math.abs(c.ecart) < 3) {
        p.classList.add('discret');
        p.textContent = 'Allure habituelle';
      } else if (c.ecart > 0) {
        p.classList.add('rapide');
        p.textContent = c.texte;
      } else {
        p.classList.add('discret');
        p.textContent = c.texte;
      }
      bouton.append(p);
    }

    if (derniere.type === 'rameur') {
      const courbe = document.createElement('div');
      courbe.className = 'historique-courbe';
      bouton.append(courbe);
      try {
        dessinerCourbe(courbe, await db.echantillons(derniere.id));
      } catch {
        // Une séance sans échantillons reste lisible sans courbe.
      }
    }
    el.derniere.append(bouton);
  }

  function construireSemaines() {
    if (squeletteSemainesConstruit) return;
    const section = el.semaines;
    section.replaceChildren();

    const entete = document.createElement('div');
    entete.className = 'historique-semaines-entete';
    const h2 = document.createElement('h2');
    h2.textContent = 'Semaine après semaine';
    const periodes = document.createElement('div');
    periodes.className = 'historique-periodes';
    periodes.setAttribute('role', 'group');
    periodes.setAttribute('aria-label', 'Période affichée');
    refs.boutonsPeriode = new Map();
    for (const [valeur, label] of [[12, '12 semaines'], [26, '6 mois'], [52, '1 an']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.periode = String(valeur);
      b.setAttribute('aria-pressed', String(periode === valeur));
      b.addEventListener('click', () => {
        periode = valeur;
        majSemaines();
      });
      refs.boutonsPeriode.set(valeur, b);
      periodes.append(b);
    }
    entete.append(h2, periodes);

    const cumul = document.createElement('p');
    cumul.className = 'historique-cumul';
    refs.cumul = cumul;

    const graphique = document.createElement('div');
    graphique.className = 'historique-graphique-conteneur';
    refs.graphiqueConteneur = graphique;

    const legende = document.createElement('div');
    legende.className = 'historique-legende';
    refs.legende = legende;

    const detail = document.createElement('div');
    detail.className = 'historique-semaine-detail';

    const nav = document.createElement('div');
    nav.className = 'historique-nav';
    const precedent = document.createElement('button');
    precedent.type = 'button';
    precedent.className = 'historique-fleche';
    precedent.setAttribute('aria-label', 'Semaine précédente');
    precedent.textContent = '‹';
    precedent.addEventListener('click', () => choisirSemaine(indexChoisi - 1));
    const titre = document.createElement('h3');
    titre.className = 'historique-semaine-titre';
    titre.setAttribute('aria-live', 'polite');
    const suivant = document.createElement('button');
    suivant.type = 'button';
    suivant.className = 'historique-fleche';
    suivant.setAttribute('aria-label', 'Semaine suivante');
    suivant.textContent = '›';
    suivant.addEventListener('click', () => choisirSemaine(indexChoisi + 1));
    nav.append(precedent, titre, suivant);
    refs.precedent = precedent;
    refs.suivant = suivant;
    refs.titre = titre;

    const sousTitre = document.createElement('p');
    sousTitre.className = 'historique-sous-titre';
    refs.sousTitre = sousTitre;

    const chiffres = document.createElement('div');
    chiffres.className = 'historique-semaine-chiffres';
    const statJours = document.createElement('div');
    statJours.className = 'historique-stat';
    const valeurJours = document.createElement('span');
    valeurJours.className = 'historique-stat-valeur';
    const libelleJours = document.createElement('span');
    libelleJours.className = 'historique-stat-libelle';
    libelleJours.textContent = 'jours actifs';
    statJours.append(valeurJours, libelleJours);
    const statDuree = document.createElement('div');
    statDuree.className = 'historique-stat';
    const valeurDuree = document.createElement('span');
    valeurDuree.className = 'historique-stat-valeur';
    const libelleDuree = document.createElement('span');
    libelleDuree.className = 'historique-stat-libelle';
    libelleDuree.textContent = "d'activité";
    statDuree.append(valeurDuree, libelleDuree);
    const statut = document.createElement('span');
    statut.className = 'historique-statut';
    statut.hidden = true;
    chiffres.append(statJours, statDuree, statut);
    refs.valeurJours = valeurJours;
    refs.valeurDuree = valeurDuree;
    refs.statut = statut;

    const jours = document.createElement('ol');
    jours.className = 'historique-jours';
    refs.jours = jours;

    const repartition = document.createElement('p');
    repartition.className = 'historique-repartition';
    repartition.hidden = true;
    refs.repartition = repartition;

    const seances = document.createElement('ul');
    seances.className = 'liste historique-semaine-seances';
    refs.seances = seances;

    const vide = document.createElement('p');
    vide.className = 'historique-semaine-vide';
    vide.hidden = true;
    refs.vide = vide;

    detail.append(nav, sousTitre, chiffres, jours, repartition, seances, vide);
    section.append(entete, cumul, graphique, legende, detail);
    squeletteSemainesConstruit = true;

    if (typeof ResizeObserver !== 'undefined') {
      observerGraphique = new ResizeObserver(() => {
        const largeur = refs.graphiqueConteneur?.clientWidth ?? 0;
        if (largeur > 0 && largeur !== derniereLargeurGraphique) {
          derniereLargeurGraphique = largeur;
          dessinerGraphique();
        }
      });
      observerGraphique.observe(graphique);
    }
  }

  function majSemaines() {
    if (!squeletteSemainesConstruit) return;
    for (const [valeur, b] of refs.boutonsPeriode) {
      b.setAttribute('aria-pressed', String(periode === valeur));
    }
    semainesAffichees = semainesRecentes(liste, instant, periode, statuts);
    if (semainesAffichees.length === 0) return;

    let index = lundiChoisi ? semainesAffichees.findIndex((w) => w.lundi === lundiChoisi) : -1;
    if (index < 0) index = semainesAffichees.length - 1;
    indexChoisi = index;
    lundiChoisi = semainesAffichees[index].lundi;

    const totalSeances = semainesAffichees.reduce((n, w) => n + w.seances.length, 0);
    const totalMinutes = semainesAffichees.reduce((n, w) => n + w.total, 0);
    const tenues = semainesAffichees.filter((w) => w.statut === 'tenue').length;
    const parties = [
      `${totalSeances} ${pluriel(totalSeances, 'séance', 'séances')}`,
      dureeCumulee(totalMinutes),
    ];
    if (tenues > 0) parties.push(`${tenues} ${pluriel(tenues, 'semaine tenue', 'semaines tenues')}`);
    refs.cumul.textContent = parties.join(' · ');

    dessinerGraphique();
    rendreLegende();
    majDetailSemaine();
  }

  function dessinerGraphique() {
    const conteneur = refs.graphiqueConteneur;
    if (!conteneur || semainesAffichees.length === 0) return;
    const largeur = conteneur.clientWidth || 320;
    if (largeur <= 0) return;
    derniereLargeurGraphique = largeur;
    conteneur.replaceChildren();

    const hauteur = 168;
    const n = semainesAffichees.length;
    const pas = largeur / n;
    const largeurBarre = Math.max(3, Math.min(26, pas * 0.68));
    const repere = Number(reglages.repereMinutes) || 150;
    const maxTotal = semainesAffichees.reduce((m, w) => Math.max(m, w.total || 0), 0);
    const max = Math.max(maxTotal, repere * 1.1, 1);
    const margeHaut = 28;
    const ligneBase = 132;
    const hauteurZone = ligneBase - margeHaut;
    const yPour = (minutes) => ligneBase - (minutes / max) * hauteurZone;

    const svg = elNS('svg', {
      viewBox: `0 0 ${largeur} ${hauteur}`,
      class: 'historique-graphique-semaines',
      role: 'img',
      'aria-label': `Minutes d'activité par semaine sur les ${n} dernières semaines. Les boutons Semaine précédente et Semaine suivante permettent de les parcourir.`,
    });

    const margeBande = Math.min(2, pas / 10);
    const largeurBande = Math.max(0, pas - margeBande * 2);
    const bande = elNS('rect', {
      x: 0,
      y: 8,
      width: largeurBande,
      height: hauteur - 16,
      rx: 6,
      class: 'historique-bande',
    });
    svg.append(bande);

    const yRepere = yPour(repere);
    svg.append(elNS('line', {
      x1: 0,
      x2: largeur,
      y1: yRepere,
      y2: yRepere,
      class: 'historique-repere-semaines',
    }));

    const groupes = [];
    for (let i = 0; i < n; i++) {
      const semaine = semainesAffichees[i];
      const x = i * pas + (pas - largeurBarre) / 2;
      const g = elNS('g', { class: 'historique-barres' });

      if ((semaine.total || 0) <= 0) {
        g.append(elNS('line', {
          x1: x,
          x2: x + largeurBarre,
          y1: ligneBase,
          y2: ligneBase,
          class: 'historique-barre-vide',
        }));
      } else {
        const familles = [
          ['rameur', semaine.minutes.rameur || 0],
          ['course', semaine.minutes.course || 0],
          ['autre', semaine.minutes.autre || 0],
        ].filter(([, m]) => m > 0);
        let cumul = 0;
        familles.forEach(([famille, minutes], indice) => {
          const h = (minutes / max) * hauteurZone;
          const estDernier = indice === familles.length - 1;
          const y = ligneBase - cumul - h;
          const hauteurSegment = cumul > 0 ? Math.max(0, h - 2) : h;
          if (hauteurSegment > 0) {
            if (estDernier) {
              const r = Math.min(4, largeurBarre / 2, hauteurSegment / 2);
              const path = elNS('path', {
                d: `M ${x} ${y + hauteurSegment} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + largeurBarre - r} ${y} Q ${x + largeurBarre} ${y} ${x + largeurBarre} ${y + r} L ${x + largeurBarre} ${y + hauteurSegment} Z`,
                class: `historique-barre type-${famille}`,
              });
              g.append(path);
            } else {
              g.append(elNS('rect', {
                x,
                y,
                width: largeurBarre,
                height: hauteurSegment,
                class: `historique-barre type-${famille}`,
              }));
            }
          }
          cumul += h;
        });
      }

      if (semaine.statut === 'tenue') {
        g.append(elNS('circle', {
          cx: x + largeurBarre / 2,
          cy: ligneBase + 8,
          r: 3.5,
          class: 'historique-point-statut',
        }));
      }
      svg.append(g);
      groupes.push(g);
    }

    const texteRepere = elNS('text', {
      x: largeur - 4,
      y: yRepere - 4,
      'text-anchor': 'end',
      class: 'historique-repere-texte',
    });
    texteRepere.textContent = `${repere} min conseillées`;
    svg.append(texteRepere);

    let dernierMois = null;
    let dernierLabelX = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = dateDepuisCle(semainesAffichees[i].lundi);
      const mois = d.getMonth();
      if (mois !== dernierMois) {
        const x = i * pas + pas / 2;
        if (dernierLabelX === -Infinity || x - dernierLabelX >= 34) {
          const texte = elNS('text', {
            x,
            y: hauteur - 4,
            'text-anchor': 'middle',
            class: 'historique-mois-texte',
          });
          texte.textContent = formatMoisCourt.format(d);
          svg.append(texte);
          dernierLabelX = x;
        }
        dernierMois = mois;
      }
    }

    refs.svg = svg;
    refs.bande = bande;
    refs.groupesBarres = groupes;
    refs.pas = pas;
    refs.margeBande = margeBande;
    conteneur.append(svg);

    let geste = false;
    const choisirDepuisX = (clientX) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = ((clientX - rect.left) / rect.width) * largeur;
      const idx = Math.max(0, Math.min(n - 1, Math.floor(x / pas)));
      if (idx !== indexChoisi) choisirSemaine(idx);
    };
    svg.addEventListener('pointerdown', (e) => {
      geste = true;
      svg.setPointerCapture(e.pointerId);
      choisirDepuisX(e.clientX);
    });
    svg.addEventListener('pointermove', (e) => {
      if (geste) choisirDepuisX(e.clientX);
    });
    const terminer = (e) => {
      if (!geste) return;
      geste = false;
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    };
    svg.addEventListener('pointerup', terminer);
    svg.addEventListener('pointercancel', terminer);

    mettreAJourSelectionGraphique();
  }

  function mettreAJourSelectionGraphique() {
    if (!refs.bande || !refs.pas) return;
    const x = indexChoisi * refs.pas + (refs.margeBande ?? 0);
    refs.bande.style.transform = `translateX(${x}px)`;
    for (let i = 0; i < refs.groupesBarres.length; i++) {
      refs.groupesBarres[i].classList.toggle('attenuee', i !== indexChoisi);
    }
  }

  function choisirSemaine(index) {
    if (semainesAffichees.length === 0) return;
    const i = Math.max(0, Math.min(semainesAffichees.length - 1, index));
    if (i === indexChoisi && lundiChoisi === semainesAffichees[i].lundi) return;
    indexChoisi = i;
    lundiChoisi = semainesAffichees[i].lundi;
    mettreAJourSelectionGraphique();
    majDetailSemaine();
  }

  function rendreLegende() {
    if (!refs.legende) return;
    refs.legende.replaceChildren();
    const familles = new Set();
    let tenue = false;
    for (const semaine of semainesAffichees) {
      for (const f of ORDRE_FAMILLES) {
        if ((semaine.minutes[f] || 0) > 0) familles.add(f);
      }
      if (semaine.statut === 'tenue') tenue = true;
    }
    for (const f of ORDRE_FAMILLES) {
      if (!familles.has(f)) continue;
      const item = document.createElement('span');
      item.className = 'historique-legende-item';
      const pastille = document.createElement('span');
      pastille.className = `historique-pastille-carree type-${f}`;
      const texte = document.createElement('span');
      texte.textContent = NOMS_TYPE[f] ?? f;
      item.append(pastille, texte);
      refs.legende.append(item);
    }
    if (tenue) {
      const item = document.createElement('span');
      item.className = 'historique-legende-item';
      const point = document.createElement('span');
      point.className = 'historique-point-legende';
      const texte = document.createElement('span');
      texte.textContent = 'Objectif tenu';
      item.append(point, texte);
      refs.legende.append(item);
    }
  }

  function majDetailSemaine() {
    if (!refs.titre || semainesAffichees.length === 0) return;
    const semaine = semainesAffichees[indexChoisi];
    const n = semainesAffichees.length;
    refs.precedent.disabled = indexChoisi <= 0;
    refs.suivant.disabled = indexChoisi >= n - 1;

    const dimanche = ajouterJoursCle(semaine.lundi, 6);
    const estCourante = indexChoisi === n - 1;
    const estDerniere = indexChoisi === n - 2;
    if (estCourante) refs.titre.textContent = 'Cette semaine';
    else if (estDerniere) refs.titre.textContent = 'La semaine dernière';
    else refs.titre.textContent = `Semaine ${plageDates(semaine.lundi, dimanche)}`;

    if (estCourante || estDerniere) {
      refs.sousTitre.hidden = false;
      refs.sousTitre.textContent = plageDates(semaine.lundi, dimanche);
    } else {
      refs.sousTitre.hidden = true;
      refs.sousTitre.textContent = '';
    }

    refs.valeurJours.textContent = semaine.objectif != null
      ? `${semaine.joursActifs} / ${semaine.objectif}`
      : `${semaine.joursActifs}`;
    refs.valeurDuree.textContent = dureeCumulee(semaine.total);

    refs.statut.hidden = true;
    refs.statut.className = 'historique-statut';
    refs.statut.textContent = '';
    if (semaine.statut) {
      refs.statut.hidden = false;
      if (semaine.statut === 'tenue') {
        refs.statut.classList.add('tenue');
        refs.statut.textContent = 'Objectif tenu';
      } else if (semaine.statut === 'en-cours') {
        const reste = semaine.objectif != null ? Math.max(0, semaine.objectif - semaine.joursActifs) : null;
        // Jours encore jouables : ceux qui restent au calendrier, aujourd'hui compris s'il est encore vide.
        const aujourdhuiCle = cleJour(instant);
        const jouables = semaine.jours.filter((j) => j.cle > aujourdhuiCle
          || (j.cle === aujourdhuiCle && j.types.length === 0)).length;
        if (reste != null && reste > jouables) {
          refs.statut.textContent = 'Hors de portée, on repart lundi';
        } else {
          refs.statut.textContent = reste != null
            ? `Encore ${reste} ${pluriel(reste, 'jour actif', 'jours actifs')}`
            : 'En cours';
        }
      } else if (semaine.statut === 'joker') {
        refs.statut.textContent = 'Réserve utilisée';
      } else if (semaine.statut === 'manquee') {
        refs.statut.textContent = 'Objectif manqué';
      } else if (semaine.statut === 'deplacement') {
        refs.statut.textContent = 'Déplacement';
      }
    }

    refs.jours.replaceChildren();
    const aujourdhui = cleJour(instant);
    for (let i = 0; i < semaine.jours.length; i++) {
      const jour = semaine.jours[i];
      const d = dateDepuisCle(jour.cle);
      const li = document.createElement('li');
      if (jour.cle === aujourdhui) li.classList.add('aujourdhui');
      if (jour.cle > aujourdhui) li.classList.add('a-venir');

      const lettre = document.createElement('span');
      lettre.className = 'historique-jour-lettre';
      lettre.textContent = LETTRES_JOURS[i];

      const caseJour = document.createElement('span');
      caseJour.className = 'historique-jour-case';
      if (jour.types.length === 0) {
        caseJour.classList.add('vide');
      } else if (jour.types.length === 1) {
        caseJour.classList.add(`type-${jour.types[0]}`);
      } else {
        caseJour.classList.add('deux-sports');
        const [a, b] = jour.types;
        caseJour.style.background = `linear-gradient(135deg, ${couleurType(a)} 0 50%, ${couleurType(b)} 50% 100%)`;
      }

      const minutes = document.createElement('span');
      minutes.className = 'historique-jour-minutes';
      minutes.textContent = jour.types.length ? `${Math.round(jour.minutes)} min` : '\u00a0';

      li.append(lettre, caseJour, minutes);
      li.setAttribute('aria-label', libelleJourComplet(d, jour));
      refs.jours.append(li);
    }

    // Rameur et footing toujours affichés, même à zéro : la semaine compte les deux.
    const familles = ORDRE_FAMILLES.filter((f) => f !== 'autre' || (semaine.minutes[f] || 0) > 0);
    refs.repartition.hidden = false;
    refs.repartition.replaceChildren(...familles.map((f) => {
      const span = document.createElement('span');
      span.className = `historique-repartition-sport type-${f}`;
      if (!(semaine.minutes[f] > 0)) span.classList.add('zero');
      span.textContent = `${NOMS_TYPE[f]} ${Math.round(semaine.minutes[f] || 0)} min`;
      return span;
    }));

    refs.seances.replaceChildren();
    if (semaine.seances.length === 0) {
      refs.seances.hidden = true;
      refs.vide.hidden = false;
      refs.vide.textContent = semaine.statut === 'deplacement'
        ? 'Semaine de déplacement : elle ne compte ni pour ni contre la série.'
        : 'Aucune activité cette semaine-là.';
    } else {
      refs.vide.hidden = true;
      refs.seances.hidden = false;
      for (const s of semaine.seances) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.addEventListener('click', () => ouvrirDetail(s));

        const date = document.createElement('span');
        date.className = 'date';
        date.textContent = formatDateLigne.format(new Date(s.debut));

        const pastille = document.createElement('span');
        pastille.className = `pastille type-${s.type}`;
        pastille.textContent = NOMS_TYPE[s.type] ?? s.type;

        const totaux = document.createElement('span');
        totaux.className = 'totaux';
        const parties = [mmss(s.minutes * 60)];
        if (s.distance != null) parties.push(distanceTexte(s.distance, s.type));
        if (s.allure != null) parties.push(`${formaterAllure(s.allure)} ${s.type === 'rameur' ? '/500 m' : '/km'}`);
        totaux.textContent = parties.join(' · ');

        b.append(date, pastille, totaux);
        li.append(b);
        refs.seances.append(li);
      }
    }
  }

  function rendreTendances() {
    el.tendances.replaceChildren();
    for (const type of ['rameur', 'course']) {
      const t = tendance(liste, type);
      if (t.points.length === 0) continue;

      const carte = document.createElement('div');
      carte.className = 'historique-tendance-carte';

      const entete = document.createElement('div');
      entete.className = 'historique-tendance-entete';
      const pastille = document.createElement('span');
      pastille.className = `pastille type-${type}`;
      pastille.textContent = NOMS_TYPE[type];
      const libelle = document.createElement('span');
      libelle.textContent = 'Allure';
      entete.append(pastille, libelle);

      const valeur = document.createElement('div');
      valeur.className = 'historique-tendance-valeur';
      valeur.textContent = formaterAllure(t.actuelle);
      const unite = document.createElement('span');
      unite.className = 'historique-tendance-unite';
      unite.textContent = type === 'rameur' ? '/500 m' : '/km';
      valeur.append(unite);

      const sousTitre = document.createElement('p');
      sousTitre.className = 'historique-tendance-sous-titre';
      sousTitre.textContent = t.nombre <= 1
        ? 'médiane de la dernière séance'
        : `médiane des ${t.nombre} dernières séances`;

      const comparaison = document.createElement('p');
      comparaison.className = 'historique-tendance-comparaison';
      if (t.ecart == null) {
        comparaison.classList.add('discret');
        comparaison.textContent = 'Pas encore assez de séances pour comparer.';
      } else if (Math.abs(t.ecart) < 2) {
        comparaison.classList.add('discret');
        comparaison.textContent = 'Stable.';
      } else {
        const precedentes = Math.min(5, Math.max(0, t.points.length - t.nombre));
        if (t.ecart > 0) {
          comparaison.classList.add('rapide');
          comparaison.textContent = `${Math.round(t.ecart)} s plus vite que les ${precedentes} précédentes`;
        } else {
          comparaison.classList.add('discret');
          comparaison.textContent = `${Math.round(-t.ecart)} s plus lent que les ${precedentes} précédentes`;
        }
      }

      carte.append(entete, valeur, sousTitre, comparaison);

      if (t.points.length >= 3) {
        const mini = document.createElement('div');
        mini.className = 'historique-mini-courbe';
        const legende = document.createElement('p');
        legende.className = 'historique-mini-legende';
        legende.textContent = 'Plus haut : plus vite.';
        carte.append(mini, legende);
        el.tendances.append(carte);
        dessinerMiniCourbe(mini, t, type);
      } else {
        el.tendances.append(carte);
      }
    }
  }

  function dessinerMiniCourbe(conteneur, t, type) {
    const largeur = conteneur.clientWidth || 220;
    const hauteur = 52;
    const points = t.points.slice(-30);
    if (points.length < 3) return;

    const marge = 4;
    const allures = points.map((p) => p.allure);
    const min = Math.min(...allures);
    const max = Math.max(...allures);
    const span = max - min || 1;
    const meme = max === min;
    const x = (i) => marge + (i / (points.length - 1)) * (largeur - 2 * marge);
    const y = (allure) => (meme
      ? hauteur / 2
      : marge + ((allure - min) / span) * (hauteur - 2 * marge));

    const svg = elNS('svg', {
      viewBox: `0 0 ${largeur} ${hauteur}`,
      class: `historique-mini-svg type-${type}`,
      role: 'img',
      'aria-label': `Allure ${type === 'rameur' ? 'au 500 mètres' : 'au kilomètre'} des dernières séances, plus haut signifie plus vite.`,
    });

    const polyline = elNS('polyline', {
      points: points.map((p, i) => `${x(i)},${y(p.allure)}`).join(' '),
      class: 'historique-mini-ligne',
    });
    svg.append(polyline);

    const recentStart = Math.max(0, points.length - t.nombre);
    points.forEach((p, i) => {
      const cercle = elNS('circle', {
        cx: x(i),
        cy: y(p.allure),
        r: 2.5,
        class: 'historique-mini-point',
      });
      if (i < recentStart) cercle.setAttribute('opacity', '0.45');
      svg.append(cercle);
    });

    conteneur.replaceChildren(svg);
  }

  function rendreListe() {
    el.liste.replaceChildren();
    const filtrees = liste.filter((s) => {
      if (filtre === 'tout') return true;
      if (filtre === 'rameur') return s.type === 'rameur';
      return s.type === 'course';
    });
    const groupes = grouperParMois(filtrees);
    if (groupes.length === 0) {
      const p = document.createElement('p');
      p.className = 'discret';
      p.textContent = 'Aucune séance pour ce filtre.';
      el.liste.append(p);
      return;
    }

    for (const groupe of groupes.slice(0, moisAffiches)) {
      const section = document.createElement('section');
      section.className = 'historique-groupe-mois';

      const entete = document.createElement('div');
      entete.className = 'historique-groupe-entete';
      const h3 = document.createElement('h3');
      h3.textContent = groupe.titre;
      const total = document.createElement('span');
      total.className = 'historique-groupe-total';
      total.textContent = `${groupe.nombre} ${pluriel(groupe.nombre, 'séance', 'séances')} · ${dureeCumulee(groupe.totalMinutes)}`;
      entete.append(h3, total);
      section.append(entete);

      const ul = document.createElement('ul');
      ul.className = 'liste historique-liste-seances';
      for (const s of groupe.seances) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.addEventListener('click', () => ouvrirDetail(s));

        const date = document.createElement('span');
        date.className = 'date';
        date.textContent = formatDateLigne.format(new Date(s.debut));

        const type = document.createElement('span');
        type.className = `pastille type-${s.type}`;
        type.textContent = NOMS_TYPE[s.type] ?? s.type;

        const totaux = document.createElement('span');
        totaux.className = 'totaux';
        const parties = [mmss(s.minutes * 60)];
        if (s.distance != null) parties.push(distanceTexte(s.distance, s.type));
        if (s.allure != null) parties.push(`${formaterAllure(s.allure)} ${s.type === 'rameur' ? '/500 m' : '/km'}`);
        totaux.textContent = parties.join(' · ');

        b.append(date, type, totaux);
        li.append(b);
        ul.append(li);
      }
      section.append(ul);
      el.liste.append(section);
    }

    if (groupes.length > moisAffiches) {
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'historique-voir-plus';
      const reste = groupes.length - moisAffiches;
      plus.textContent = `Voir plus (${reste} mois plus anciens)`;
      plus.addEventListener('click', () => {
        moisAffiches += 3;
        rendreListe();
      });
      el.liste.append(plus);
    }
  }

  async function afficher() {
    const seancesRameur = (await db.seances()) ?? [];
    const carnet = await lireCarnet();
    const activites = carnet?.activites ?? [];
    liste = unifier(seancesRameur, activites);
    instant = maintenant();
    if (!(instant instanceof Date)) instant = new Date(instant);

    if (el.message) el.message.hidden = false;
    const vide = liste.length === 0;
    el.vide.hidden = !vide;
    el.contenu.hidden = vide;

    if (vide) {
      el.derniere.replaceChildren();
      el.tendances.replaceChildren();
      el.liste.replaceChildren();
      return;
    }

    const reglagesCarnet = carnet?.reglages ?? {};
    const b = bilan(liste, reglagesCarnet, instant);
    reglages = b.reglages;

    statuts = new Map();
    if (Array.isArray(carnet?.reglages?.objectifs) && carnet.reglages.objectifs.length > 0) {
      for (const s of [...b.semaines, b.courante]) {
        statuts.set(s.lundi, { statut: s.statut, objectif: s.objectif });
      }
    }

    rendreElan();
    await rendreDerniere();
    construireSemaines();
    majSemaines();
    rendreTendances();
    creerFiltres();
    rendreListe();
  }

  return { afficher };
}
