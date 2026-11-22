// Sauvegarde de l'historique hors du navigateur, sur le serveur qui sert la page.
//
// Facultative : si la page est servie sans ce serveur (un hébergement statique, par
// exemple), /api/ ne répond pas et la page garde son historique dans le navigateur
// seulement, avec l'export et l'import pour le faire suivre.
//
// Règles de fusion, pour un seul utilisateur :
// - une séance terminée existe des deux côtés ; celle qui manque d'un côté y est copiée ;
// - le carnet : réglages du plus récent (d'après « maj »), activités fusionnées par id,
//   suppressions conservées des deux côtés.

import { fusionnerCarnets } from '../src/carnet.js';

function normaliser(v) {
  if (Array.isArray(v)) return v.map(normaliser);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((cle) => [cle, normaliser(v[cle])]));
  }
  return v;
}

/** Vrai si les deux carnets ont le même contenu, quel que soit l'ordre des clés. */
function memeCarnet(a, b) {
  return JSON.stringify(normaliser(a)) === JSON.stringify(normaliser(b));
}

export function creerSynchro(db) {
  let active = null; // null : pas encore su ; true / false ensuite

  async function appel(methode, chemin, corps) {
    const r = await fetch(chemin, {
      method: methode,
      headers: corps ? { 'content-type': 'application/json' } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
    });
    if (!r.ok) throw new Error(`${methode} ${chemin} : ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  return {
    get active() { return active; },

    /** À l'ouverture : vérifie que le serveur répond, puis fusionne dans les deux sens. */
    async demarrer() {
      try {
        const distantes = await appel('GET', '/api/seances');
        active = true;
        const locales = await db.seances();
        const ici = new Set(locales.map((s) => s.id));
        const labas = new Set(distantes.map((s) => s.id));

        const aRecuperer = [];
        for (const s of distantes) if (!ici.has(s.id)) aRecuperer.push(await appel('GET', `/api/seances/${s.id}`));
        if (aRecuperer.length) await db.importer(aRecuperer);

        let envoyees = 0;
        for (const s of locales) {
          if (s.etat === 'terminee' && !labas.has(s.id)) { await this.envoyerSeance(s.id); envoyees++; }
        }

        const carnetDistant = await appel('GET', '/api/carnet');
        const carnetLocal = await db.carnet();
        const carnet = fusionnerCarnets(carnetLocal, carnetDistant);
        if (!memeCarnet(carnet, carnetLocal)) await db.ecrireCarnet(carnet);
        if (!memeCarnet(carnet, carnetDistant)) await appel('PUT', '/api/carnet', carnet);

        return { recuperees: aRecuperer.length, envoyees, carnet };
      } catch {
        active = false;
        return null;
      }
    },

    async envoyerSeance(id) {
      if (active === false) return;
      const fiche = await db.seance(id);
      if (!fiche) return;
      await appel('PUT', `/api/seances/${id}`, { ...fiche, echantillons: await db.echantillons(id) });
    },

    async supprimerSeance(id) {
      if (active === false) return;
      await appel('DELETE', `/api/seances/${id}`);
    },

    async envoyerCarnet(carnet) {
      if (active === false) return;
      const distant = await appel('GET', '/api/carnet');
      const fusionne = fusionnerCarnets(carnet, distant);
      await appel('PUT', '/api/carnet', fusionne);
      return fusionne;
    },
  };
}
