// Stockage des séances dans le navigateur (IndexedDB).
//
// Deux magasins :
// - « seances » : une fiche par séance { id, debut, etat, resume } ;
// - « echantillons » : une ligne par seconde ramée { id, t, d, ... }, clé [id, t].
// Chaque échantillon s'écrit dès son arrivée : une coupure du Bluetooth, un
// rechargement ou une fermeture de la page ne perd au pire que la dernière seconde.
// IndexedDB plutôt que localStorage : une heure de rame fait 3 600 lignes, et
// localStorage plafonne à quelques mégaoctets pour tout l'historique.

const VERSION = 1;

export function ouvrir(nom = 'rameur') {
  return new Promise((resolve, reject) => {
    const requete = indexedDB.open(nom, VERSION);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains('seances')) db.createObjectStore('seances', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('echantillons')) db.createObjectStore('echantillons', { keyPath: ['id', 't'] });
    };
    requete.onsuccess = () => resolve(creerAcces(requete.result));
    requete.onerror = () => reject(requete.error);
  });
}

function attendre(requete) {
  return new Promise((resolve, reject) => {
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}

function fin(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function creerAcces(db) {
  const magasin = (nom, mode = 'readonly') => db.transaction(nom, mode).objectStore(nom);
  const plage = (id) => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

  return {
    async ecrireSeance(seance) { await attendre(magasin('seances', 'readwrite').put(seance)); },

    async ecrireEchantillon(id, e) { await attendre(magasin('echantillons', 'readwrite').put({ id, ...e })); },

    async seance(id) { return attendre(magasin('seances').get(id)); },

    async seances() {
      const toutes = await attendre(magasin('seances').getAll());
      return toutes.sort((a, b) => b.debut - a.debut);
    },

    async echantillons(id) {
      const lignes = await attendre(magasin('echantillons').getAll(plage(id)));
      return lignes.map(({ id: _id, ...e }) => e);
    },

    async supprimer(id) {
      const tx = db.transaction(['seances', 'echantillons'], 'readwrite');
      tx.objectStore('seances').delete(id);
      tx.objectStore('echantillons').delete(plage(id));
      await fin(tx);
    },

    /** Ajoute des séances importées. Une séance déjà présente (même id) est laissée telle quelle. */
    async importer(seances) {
      const deja = new Set((await attendre(magasin('seances').getAllKeys())));
      const tx = db.transaction(['seances', 'echantillons'], 'readwrite');
      let ajoutees = 0;
      for (const { echantillons, ...fiche } of seances) {
        if (deja.has(fiche.id)) continue;
        tx.objectStore('seances').put(fiche);
        for (const e of echantillons) tx.objectStore('echantillons').put({ id: fiche.id, ...e });
        ajoutees++;
      }
      await fin(tx);
      return ajoutees;
    },
  };
}
