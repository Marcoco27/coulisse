// Serveur local de développement, sans dépendance.
//
//   node outils/serveur.mjs [port]      (8790 par défaut)
//
// Sert le dépôt en lecture, et reçoit en POST /capture les trames brutes que la page
// lui envoie pendant une séance : elles s'écrivent dans donnees/, ignoré par git.
// N'écoute que sur 127.0.0.1. Web Bluetooth exige https ou localhost : on ouvre donc
// la page par localhost, au besoin à travers une redirection de port (VS Code, ssh -L).

import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const RACINE = resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.argv[2] ?? 8790);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
const fichierCapture = join(RACINE, 'donnees', `direct-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/capture') {
      let corps = '';
      for await (const morceau of req) corps += morceau;
      const lignes = JSON.parse(corps).map((e) => JSON.stringify(e)).join('\n') + '\n';
      await mkdir(join(RACINE, 'donnees'), { recursive: true });
      await appendFile(fichierCapture, lignes);
      res.writeHead(204).end();
      return;
    }
    const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const cible = normalize(join(RACINE, chemin === '/' ? '/web/index.html' : chemin));
    if (!cible.startsWith(RACINE) || cible.includes('/donnees/') || cible.includes('/.git/')) {
      res.writeHead(403).end('interdit');
      return;
    }
    const contenu = await readFile(cible);
    res.writeHead(200, { 'content-type': TYPES[extname(cible)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(contenu);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'introuvable' : 'erreur');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`http://localhost:${PORT}/  (trames reçues → ${fichierCapture})`);
});
