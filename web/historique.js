// Écran Historique : dernière séance, calendrier, progression, liste et détail.
// Rendu par création d'éléments ; les données ne passent jamais par innerHTML.

import {
  unifier, comparer, calendrier, medianesMensuelles, grouperParMois, lisser, formaterAllure,
} from '../src/historique.js';
import { cleJour } from '../src/objectif.js';

const $ = (id) => document.getElementById(id);
const nombre = new Intl.NumberFormat('fr-FR');
const formatDateLongue = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' });
const formatDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const formatHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const formatMoisCourt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const NOMS_TYPE = { rameur: 'Rameur', course: 'Course à pied', renforcement: 'Renforcement', autre: 'Autre' };

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

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'historique-courbe-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Allure au 500 mètres au fil de la séance, plus haut signifie plus vite.');

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', points.map((p) => `${x(p.t)},${y(p.all)}`).join(' '));
  polyline.setAttribute('class', 'historique-courbe-ligne');
  svg.append(polyline);
  conteneur.append(svg);
}

export function creerHistorique({ db, lireCarnet, ouvrirResume }) {
  const el = {
    vide: $('historique-vide'),
    contenu: $('historique-contenu'),
    actions: $('historique-actions'),
    message: $('historique-message'),
    derniere: $('historique-derniere'),
    calendrier: $('historique-calendrier'),
    progression: $('historique-progression'),
    filtres: $('historique-filtres'),
    liste: $('historique-liste'),
    dialog: $('historique-dialog'),
    dialogTitre: $('historique-dialog-titre'),
    dialogContenu: $('historique-dialog-contenu'),
  };

  let liste = [];
  let filtre = 'tout';
  let periode = '1an';
  let jourSelectionne = null;
  let moisAffiches = 3;
  const jourBoutons = new Map();

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
    bouton.className = 'carte historique-derniere-bouton';
    bouton.addEventListener('click', () => ouvrirDetail(derniere));

    const entete = document.createElement('div');
    entete.className = 'historique-entete';
    const pastille = document.createElement('span');
    pastille.className = `pastille type-${derniere.type}`;
    pastille.textContent = NOMS_TYPE[derniere.type] ?? derniere.type;
    const date = document.createElement('span');
    date.className = 'historique-date';
    date.textContent = formaterDateRelative(derniere.debut);
    entete.append(pastille, date);
    bouton.append(entete);

    const chiffres = document.createElement('div');
    chiffres.className = 'historique-grands-chiffres';
    const ajouterChiffre = (titre, valeur) => {
      const div = document.createElement('div');
      div.className = 'historique-chiffre';
      const v = document.createElement('span');
      v.className = 'historique-chiffre-valeur';
      v.textContent = valeur;
      const t = document.createElement('span');
      t.className = 'historique-chiffre-titre';
      t.textContent = titre;
      div.append(v, t);
      chiffres.append(div);
    };
    ajouterChiffre('Durée', mmss(derniere.minutes * 60));
    if (derniere.distance != null) ajouterChiffre('Distance', distanceTexte(derniere.distance, derniere.type));
    if (derniere.allure != null) ajouterChiffre('Allure', `${formaterAllure(derniere.allure)} ${derniere.type === 'rameur' ? '/500 m' : '/km'}`);
    if (derniere.puissance != null) ajouterChiffre('Puissance', `${Math.round(derniere.puissance)} W`);
    bouton.append(chiffres);

    if (derniere.type === 'rameur' || derniere.type === 'course') {
      const c = comparer(derniere, liste);
      if (c.texte) {
        const p = document.createElement('p');
        p.className = 'historique-comparaison';
        p.textContent = c.texte;
        bouton.append(p);
      }
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

  function libelleJour(jour) {
    const d = new Date(jour.cle + 'T12:00:00');
    const parties = [formatDateLongue.format(d)];
    if (jour.minutesRameur > 0) parties.push(`${nombre.format(Math.round(jour.minutesRameur))} min de rameur`);
    if (jour.minutesFooting > 0) parties.push(`${nombre.format(Math.round(jour.minutesFooting))} min de course`);
    if (jour.seances.length === 0) parties.push('aucune séance');
    return parties.join(', ');
  }

  function rendreJour() {
    const zone = el.calendrier.querySelector('.historique-jour-liste');
    if (!zone) return;
    zone.replaceChildren();
    if (!jourSelectionne) {
      const p = document.createElement('p');
      p.className = 'discret';
      p.textContent = 'Touchez un jour du calendrier pour voir ses séances.';
      zone.append(p);
      return;
    }
    const seances = liste.filter((s) => cleJour(new Date(s.debut)) === jourSelectionne);
    const titre = document.createElement('p');
    titre.className = 'historique-jour-titre';
    titre.textContent = formatDate.format(new Date(jourSelectionne + 'T12:00:00'));
    zone.append(titre);
    if (seances.length === 0) {
      const p = document.createElement('p');
      p.className = 'discret';
      p.textContent = 'Aucune séance ce jour-là.';
      zone.append(p);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'liste historique-jour-seances';
    for (const s of seances) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.addEventListener('click', () => ouvrirDetail(s));
      const date = document.createElement('span');
      date.className = 'date';
      date.textContent = NOMS_TYPE[s.type] ?? s.type;
      const totaux = document.createElement('span');
      totaux.className = 'totaux';
      totaux.textContent = [
        mmss(s.minutes * 60),
        s.distance != null ? distanceTexte(s.distance, s.type) : null,
        s.allure != null ? `${formaterAllure(s.allure)} ${s.type === 'rameur' ? '/500 m' : '/km'}` : null,
      ].filter(Boolean).join(' · ');
      b.append(date, totaux);
      li.append(b);
      ul.append(li);
    }
    zone.append(ul);
  }

  function rendreCalendrier() {
    el.calendrier.replaceChildren();
    const semaines = calendrier(liste, new Date());
    const debut = new Date(semaines[0][0].cle + 'T00:00:00');
    const fin = new Date(semaines[52][6].cle + 'T23:59:59');
    const dansAnnee = liste.filter((s) => {
      const d = new Date(s.debut);
      return d >= debut && d <= fin;
    });
    const totalSeances = dansAnnee.length;
    const totalMinutes = dansAnnee.reduce((a, s) => a + (s.minutes || 0), 0);
    const totalDistance = dansAnnee.reduce((a, s) => a + (s.distance || 0), 0);

    const totaux = document.createElement('div');
    totaux.className = 'historique-totaux';
    const ajouterTotal = (titre, valeur) => {
      const div = document.createElement('div');
      div.className = 'historique-total';
      const v = document.createElement('span');
      v.className = 'historique-total-valeur';
      v.textContent = valeur;
      const t = document.createElement('span');
      t.className = 'historique-total-titre';
      t.textContent = titre;
      div.append(v, t);
      totaux.append(div);
    };
    ajouterTotal('Séances', nombre.format(totalSeances));
    ajouterTotal('Heures', nombre.format(Math.round(totalMinutes / 60)));
    ajouterTotal('Kilomètres', nombre.format(Math.round(totalDistance / 1000)));
    el.calendrier.append(totaux);

    const defilement = document.createElement('div');
    defilement.className = 'historique-calendrier-defilement';
    const interieur = document.createElement('div');
    interieur.className = 'historique-calendrier-interieur';

    const mois = document.createElement('div');
    mois.className = 'historique-mois';
    for (let i = 0; i < semaines.length; i++) {
      const caseMois = document.createElement('span');
      caseMois.className = 'historique-mois-case';
      const premier = new Date(semaines[i][0].cle + 'T12:00:00');
      const precedent = i > 0 ? new Date(semaines[i - 1][0].cle + 'T12:00:00') : null;
      if (!precedent || premier.getMonth() !== precedent.getMonth()) {
        caseMois.textContent = formatMoisCourt.format(premier).replace(/^./, (c) => c.toUpperCase());
      }
      mois.append(caseMois);
    }
    interieur.append(mois);

    const grille = document.createElement('div');
    grille.className = 'historique-calendrier-grille';
    grille.setAttribute('role', 'grid');
    grille.setAttribute('aria-label', 'Calendrier des séances sur une année glissante');
    jourBoutons.clear();
    for (let i = 0; i < semaines.length; i++) {
      for (let j = 0; j < 7; j++) {
        const jour = semaines[i][j];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `historique-jour cran-${jour.cran}`;
        if (jour.minutesRameur > 0 && jour.minutesFooting > 0) b.classList.add('les-deux');
        else if (jour.minutesRameur > 0) b.classList.add('type-rameur');
        else if (jour.minutesFooting > 0) b.classList.add('type-course');
        b.setAttribute('role', 'gridcell');
        b.setAttribute('aria-label', libelleJour(jour));
        if (jour.cle === jourSelectionne) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', () => {
          jourSelectionne = jour.cle;
          for (const [cle, btn] of jourBoutons) {
            if (cle === jourSelectionne) btn.setAttribute('aria-pressed', 'true');
            else btn.removeAttribute('aria-pressed');
          }
          rendreJour();
        });
        jourBoutons.set(jour.cle, b);
        grille.append(b);
      }
    }
    interieur.append(grille);
    defilement.append(interieur);
    el.calendrier.append(defilement);

    const zone = document.createElement('div');
    zone.className = 'historique-jour-liste';
    zone.setAttribute('aria-live', 'polite');
    el.calendrier.append(zone);

    const aujourdhui = cleJour(new Date());
    if (semaines.some((w) => w.some((d) => d.cle === aujourdhui))) {
      jourSelectionne = aujourdhui;
      jourBoutons.get(aujourdhui)?.setAttribute('aria-pressed', 'true');
    } else {
      jourSelectionne = null;
    }
    rendreJour();

    requestAnimationFrame(() => {
      defilement.scrollLeft = defilement.scrollWidth;
    });
  }

  function rendreProgression() {
    el.progression.replaceChildren();
    const h2 = document.createElement('h2');
    h2.textContent = 'Progression';
    el.progression.append(h2);

    const selecteur = document.createElement('div');
    selecteur.className = 'historique-segmente';
    selecteur.setAttribute('role', 'group');
    selecteur.setAttribute('aria-label', 'Période de progression');
    for (const [valeur, label] of [['3mois', '3 mois'], ['1an', '1 an'], ['tout', 'Tout']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(periode === valeur));
      b.addEventListener('click', () => {
        periode = valeur;
        rendreProgression();
      });
      selecteur.append(b);
    }
    el.progression.append(selecteur);

    const grille = document.createElement('div');
    grille.className = 'historique-graphiques';
    el.progression.append(grille);

    const maintenant = new Date();
    let limite = -Infinity;
    if (periode === '3mois') {
      const d = new Date(maintenant);
      d.setMonth(d.getMonth() - 3);
      limite = d.getTime();
    } else if (periode === '1an') {
      const d = new Date(maintenant);
      d.setFullYear(d.getFullYear() - 1);
      limite = d.getTime();
    }

    for (const type of ['rameur', 'course']) {
      const points = liste
        .filter((s) => s.type === type && s.allure != null && s.debut >= limite)
        .sort((a, b) => a.debut - b.debut);
      const carte = document.createElement('div');
      carte.className = 'historique-graphique-carte';
      const info = document.createElement('p');
      info.className = 'historique-graphique-info';
      info.textContent = 'Touchez un point pour voir la séance.';
      carte.append(info);
      carte.append(creerGraphiqueProgression(points, type, info));
      grille.append(carte);
    }
  }

  function creerGraphiqueProgression(points, type, info) {
    const largeur = 360;
    const hauteur = 140;
    const marge = { haut: 10, bas: 10, gauche: 10, droite: 10 };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
    svg.setAttribute('class', 'historique-graphique');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', type === 'rameur'
      ? 'Allure au 500 mètres du rameur, un point par séance et une ligne de médiane mensuelle.'
      : 'Allure au kilomètre du footing, un point par séance et une ligne de médiane mensuelle.');

    if (points.length === 0) {
      const texte = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      texte.setAttribute('x', largeur / 2);
      texte.setAttribute('y', hauteur / 2);
      texte.setAttribute('text-anchor', 'middle');
      texte.setAttribute('class', 'historique-graphique-vide');
      texte.textContent = 'Pas encore de séance';
      svg.append(texte);
      return svg;
    }

    const minX = Math.min(...points.map((p) => p.debut));
    const maxX = Math.max(...points.map((p) => p.debut));
    const minY = Math.min(...points.map((p) => p.allure));
    const maxY = Math.max(...points.map((p) => p.allure));
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const x = (debut) => marge.gauche + ((debut - minX) / spanX) * (largeur - marge.gauche - marge.droite);
    const y = (allure) => (maxY === minY
      ? hauteur / 2
      : marge.haut + ((allure - minY) / spanY) * (hauteur - marge.haut - marge.bas));

    const pointsParMois = new Map();
    for (const p of points) {
      const d = new Date(p.debut);
      const cle = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!pointsParMois.has(cle)) pointsParMois.set(cle, []);
      pointsParMois.get(cle).push(p);
    }
    const ligne = [];
    for (const m of medianesMensuelles(points)) {
      const pts = pointsParMois.get(m.mois) ?? [];
      if (!pts.length) continue;
      const moyenneX = pts.reduce((a, p) => a + p.debut, 0) / pts.length;
      ligne.push([x(moyenneX), y(m.mediane)]);
    }
    if (ligne.length > 1) {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', ligne.map(([px, py]) => `${px},${py}`).join(' '));
      polyline.setAttribute('class', 'historique-mediane');
      svg.append(polyline);
    }

    for (const p of points) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x(p.debut));
      c.setAttribute('cy', y(p.allure));
      c.setAttribute('r', 2.5);
      c.setAttribute('class', `historique-point type-${type}`);
      svg.append(c);
    }

    const repere = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    repere.setAttribute('class', 'historique-repere');
    repere.setAttribute('y1', marge.haut);
    repere.setAttribute('y2', hauteur - marge.bas);
    repere.setAttribute('visibility', 'hidden');
    svg.append(repere);

    const cercleActif = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    cercleActif.setAttribute('r', 4);
    cercleActif.setAttribute('class', 'historique-point-actif');
    cercleActif.setAttribute('visibility', 'hidden');
    svg.append(cercleActif);

    const maj = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * largeur;
      let meilleur = null;
      let distance = Infinity;
      for (const p of points) {
        const d = Math.abs(x(p.debut) - px);
        if (d < distance) {
          distance = d;
          meilleur = p;
        }
      }
      if (!meilleur) return;
      const cx = x(meilleur.debut);
      repere.setAttribute('x1', cx);
      repere.setAttribute('x2', cx);
      repere.setAttribute('visibility', 'visible');
      cercleActif.setAttribute('cx', cx);
      cercleActif.setAttribute('cy', y(meilleur.allure));
      cercleActif.setAttribute('visibility', 'visible');
      info.textContent = `${formatDate.format(new Date(meilleur.debut))} · ${formaterAllure(meilleur.allure)} ${type === 'rameur' ? '/500 m' : '/km'}`;
    };

    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      maj(e.clientX);
    });
    svg.addEventListener('pointermove', (e) => maj(e.clientX));
    svg.addEventListener('pointerup', (e) => {
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    });
    return svg;
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
      const parties = [`${groupe.nombre} séance${groupe.nombre > 1 ? 's' : ''}`];
      if (groupe.totalMinutes > 0) parties.push(mmss(groupe.totalMinutes * 60));
      if (groupe.totalDistance > 0) parties.push(distanceTexte(groupe.totalDistance, 'course'));
      total.textContent = parties.join(' · ');
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
        date.textContent = formatDate.format(new Date(s.debut));
        const type = document.createElement('span');
        type.className = `pastille type-${s.type}`;
        type.textContent = NOMS_TYPE[s.type] ?? s.type;
        const totaux = document.createElement('span');
        totaux.className = 'totaux';
        totaux.textContent = [
          mmss(s.minutes * 60),
          s.distance != null ? distanceTexte(s.distance, s.type) : null,
          s.allure != null ? `${formaterAllure(s.allure)} ${s.type === 'rameur' ? '/500 m' : '/km'}` : null,
        ].filter(Boolean).join(' · ');
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
    const seancesRameur = await db.seances();
    const carnet = await lireCarnet();
    const activites = carnet?.activites ?? [];
    liste = unifier(seancesRameur, activites);

    const vide = liste.length === 0;
    el.vide.hidden = !vide;
    el.contenu.hidden = vide;
    el.actions.hidden = vide;
    el.message.hidden = vide;

    if (vide) {
      el.derniere.replaceChildren();
      el.calendrier.replaceChildren();
      el.progression.replaceChildren();
      el.liste.replaceChildren();
      return;
    }

    creerFiltres();
    await rendreDerniere();
    rendreCalendrier();
    rendreProgression();
    rendreListe();
  }

  return { afficher };
}
