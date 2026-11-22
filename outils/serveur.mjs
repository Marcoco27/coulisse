// Serveur local, sans dépendance.
//
//   node outils/serveur.mjs [port]      (8790 par défaut)
//
// Trois rôles :
// - servir la page et le code du dépôt, en lecture ;
// - recevoir en POST /capture les trames brutes d'une séance (donnees/direct-*.jsonl) ;
// - garder une sauvegarde de l'historique hors du navigateur (API /api/…, fichiers
//   dans donnees/seances/ et donnees/carnet.json). Le dossier donnees/ est ignoré
//   par git ; il part dans la sauvegarde de la machine qui sert la page.
//
// N'écoute que sur 127.0.0.1. Web Bluetooth exige https ou localhost : on ouvre donc
// la page par localhost, au besoin à travers une redirection de port (VS Code, ssh -L).

import { createServer } from 'node:http';
import { readFile, writeFile, appendFile, mkdir, readdir, rename } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const RACINE = resolve(new URL('..', import.meta.url).pathname);
// RAMEUR_DONNEES permet de pointer ailleurs, pour les essais.
const DONNEES = resolve(process.env.RAMEUR_DONNEES ?? join(RACINE, 'donnees'));
const SEANCES = join(DONNEES, 'seances');
const CORBEILLE = join(SEANCES, 'corbeille');
const CARNET = join(DONNEES, 'carnet.json');
const PORT = Number(process.argv[2] ?? 8790);
// RAMEUR_HOTE : adresses d'écoute séparées par des virgules (le service ajoute l'adresse
// Tailscale d'atlas). Par défaut, la machine seule.
const HOTES = (process.env.RAMEUR_HOTE ?? '127.0.0.1').split(',').map((h) => h.trim()).filter(Boolean);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
const ID_SEANCE = /^s-\d{10,16}$/;
const fichierCapture = join(DONNEES, `direct-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

async function lireCorps(req, limite = 20 * 1024 * 1024) {
  let corps = '';
  for await (const morceau of req) {
    corps += morceau;
    if (corps.length > limite) throw Object.assign(new Error('trop gros'), { statut: 413 });
  }
  return corps;
}

/** Écrit d'abord un fichier temporaire, puis le renomme : jamais de fichier à moitié écrit. */
async function ecrireSur(chemin, contenu) {
  const temporaire = `${chemin}.${process.pid}.tmp`;
  await writeFile(temporaire, contenu);
  await rename(temporaire, chemin);
}

const json = (res, statut, valeur) => {
  res.writeHead(statut, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(valeur === undefined ? '' : JSON.stringify(valeur));
};

async function api(req, res, chemin) {
  await mkdir(CORBEILLE, { recursive: true });

  if (chemin === '/api/seances' && req.method === 'GET') {
    const fiches = [];
    for (const nom of await readdir(SEANCES)) {
      if (!nom.endsWith('.json')) continue;
      const { echantillons, ...fiche } = JSON.parse(await readFile(join(SEANCES, nom), 'utf8'));
      fiches.push(fiche);
    }
    return json(res, 200, fiches);
  }

  const m = chemin.match(/^\/api\/seances\/([^/]+)$/);
  if (m) {
    if (!ID_SEANCE.test(m[1])) return json(res, 400, { erreur: 'identifiant de séance invalide' });
    const fichier = join(SEANCES, `${m[1]}.json`);
    if (req.method === 'GET') return json(res, 200, JSON.parse(await readFile(fichier, 'utf8')));
    if (req.method === 'PUT') {
      const seance = JSON.parse(await lireCorps(req));
      if (seance.id !== m[1] || !Array.isArray(seance.echantillons)) return json(res, 400, { erreur: 'séance incomplète' });
      await ecrireSur(fichier, JSON.stringify(seance));
      return json(res, 204);
    }
    if (req.method === 'DELETE') {
      // Une séance supprimée part à la corbeille, jamais à la poubelle.
      try { await rename(fichier, join(CORBEILLE, `${m[1]}.json`)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return json(res, 204);
    }
  }

  if (chemin === '/api/carnet') {
    if (req.method === 'GET') {
      try { return json(res, 200, JSON.parse(await readFile(CARNET, 'utf8'))); } catch (e) { if (e.code === 'ENOENT') return json(res, 200, null); throw e; }
    }
    if (req.method === 'PUT') {
      const carnet = JSON.parse(await lireCorps(req, 2 * 1024 * 1024));
      if (typeof carnet?.maj !== 'number') return json(res, 400, { erreur: 'carnet sans date de mise à jour' });
      await ecrireSur(CARNET, JSON.stringify(carnet, null, 1));
      return json(res, 204);
    }
  }

  return json(res, 404, { erreur: 'inconnu' });
}

async function traiter(req, res) {
  try {
    const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);

    if (req.method === 'POST' && chemin === '/capture') {
      const lignes = JSON.parse(await lireCorps(req)).map((e) => JSON.stringify(e)).join('\n') + '\n';
      await mkdir(DONNEES, { recursive: true });
      await appendFile(fichierCapture, lignes);
      res.writeHead(204).end();
      return;
    }

    if (chemin.startsWith('/api/')) { await api(req, res, chemin); return; }

    // La page vit dans web/ et charge son code par chemins relatifs, comme sur GitHub Pages.
    if (chemin === '/') { res.writeHead(302, { Location: '/web/' + new URL(req.url, 'http://x').search }).end(); return; }
    const cible = normalize(join(RACINE, chemin.endsWith('/') ? chemin + 'index.html' : chemin));
    if (!cible.startsWith(RACINE) || cible.startsWith(DONNEES) || cible.includes('/.git/')) {
      res.writeHead(403).end('interdit');
      return;
    }
    const contenu = await readFile(cible);
    res.writeHead(200, { 'content-type': TYPES[extname(cible)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(contenu);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404).end('introuvable'); return; }
    if (e instanceof SyntaxError) { res.writeHead(400).end('JSON invalide'); return; }
    console.error(e);
    res.writeHead(e.statut ?? 500).end('erreur');
  }
}

// Une écoute par adresse : le service ouvre la machine elle-même (le rameur, par le
// transfert de port de VS Code) et l'adresse Tailscale (l'iPhone, le portable en direct).
for (const hote of HOTES) {
  createServer(traiter).listen(PORT, hote, () => {
    console.log(`http://${hote}:${PORT}/  (trames reçues → ${fichierCapture})`);
  });
}
