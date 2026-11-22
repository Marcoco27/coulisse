// Verse les footings Garmin dans le carnet de Coulisse.
//
//   node outils/garmin-vers-carnet.mjs [--depuis AAAA-MM-JJ] [--essai]
//
// Lit la clé personnelle Garmin dans GARMIN_PERSONAL_API_KEY, demande un jeton
// (valable 24 h, sans refresh), liste les activités de --depuis à aujourd'hui, puis
// ajoute au carnet les courses qui n'y sont pas déjà. --essai n'écrit rien.
// N'affiche jamais la clé ni le jeton, même en cas d'erreur : seulement l'étape et
// le code HTTP.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { estUneCourse, fusionner } from '../src/garmin.js';
import { cleJour } from '../src/objectif.js';

const RACINE = resolve(new URL('..', import.meta.url).pathname);
const DONNEES = resolve(process.env.RAMEUR_DONNEES ?? join(RACINE, 'donnees'));
const CARNET = join(DONNEES, 'carnet.json');

const URL_JETON = 'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token';
const URL_ACTIVITES = 'https://personal.connectapi.garmin.com/activitylist-service/activities/search/activities';
const PAGE = 100;

const ilYaNJours = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return cleJour(d); };
const formaterDate = (ms) => new Date(ms).toLocaleDateString('fr-FR');

function lireOptions(argv) {
  const options = { depuis: ilYaNJours(60), essai: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--depuis') {
      const valeur = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur ?? '')) throw new Error('--depuis attend une date AAAA-MM-JJ');
      options.depuis = valeur;
    } else if (argv[i] === '--essai') {
      options.essai = true;
    } else {
      throw new Error(`option inconnue : ${argv[i]}`);
    }
  }
  return options;
}

async function obtenirJeton(cle) {
  let reponse;
  try {
    reponse = await fetch(URL_JETON, { method: 'POST', headers: { Authorization: `ApiKey ${cle}` } });
  } catch {
    throw Object.assign(new Error('réseau indisponible'), { etape: 'jeton' });
  }
  if (!reponse.ok) throw Object.assign(new Error(`HTTP ${reponse.status}`), { etape: 'jeton' });
  return (await reponse.text()).trim();
}

async function listerActivites(jeton, depuis, jusqua) {
  const activites = [];
  for (let start = 0; ;) {
    const url = new URL(URL_ACTIVITES);
    url.searchParams.set('start', String(start));
    url.searchParams.set('limit', String(PAGE));
    url.searchParams.set('startDate', depuis);
    url.searchParams.set('endDate', jusqua);
    let reponse;
    try {
      reponse = await fetch(url, { headers: { Authorization: `Bearer ${jeton}` } });
    } catch {
      throw Object.assign(new Error('réseau indisponible'), { etape: 'activités' });
    }
    if (!reponse.ok) throw Object.assign(new Error(`HTTP ${reponse.status}`), { etape: 'activités' });
    const page = await reponse.json();
    activites.push(...page);
    if (page.length < PAGE) break;
    start += page.length;
  }
  return activites;
}

async function lireCarnet() {
  try {
    return JSON.parse(await readFile(CARNET, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { maj: 0, reglages: {}, activites: [] };
    throw e;
  }
}

/** Écrit d'abord un fichier temporaire dans le même dossier, puis le renomme. */
async function ecrireCarnet(carnet) {
  await mkdir(DONNEES, { recursive: true });
  const temporaire = `${CARNET}.${process.pid}.tmp`;
  await writeFile(temporaire, JSON.stringify(carnet, null, 1));
  await rename(temporaire, CARNET);
}

// Prévient Marc sur son téléphone, seulement quand systemd lance le script
// (INVOCATION_ID n'existe que là) : un lancement à la main ne sonne pas.
const NOTIFIER = '/home/marc/code/espace-de-travail/.claude/outils/notifier.sh';
function prevenir(titre, corps, { silencieux = false } = {}) {
  if (!process.env.INVOCATION_ID) return;
  spawnSync(NOTIFIER, [...(silencieux ? ['-s'] : []), titre, corps], { stdio: 'ignore', timeout: 30_000 });
}

async function main() {
  let options;
  try {
    options = lireOptions(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }

  const cle = process.env.GARMIN_PERSONAL_API_KEY;
  if (!cle) {
    console.error('GARMIN_PERSONAL_API_KEY est absente de l’environnement.');
    process.exitCode = 2;
    return;
  }

  try {
    const jeton = await obtenirJeton(cle);
    const activites = await listerActivites(jeton, options.depuis, cleJour(Date.now()));
    const carnet = await lireCarnet();
    const { carnet: nouveau, ajoutees, ignorees } = fusionner(carnet, activites, Date.now());

    if (!options.essai && ajoutees.length > 0) await ecrireCarnet(nouveau);

    const courses = activites.filter(estUneCourse).length;
    console.log(`${courses} course(s) chez Garmin depuis le ${options.depuis}.`);
    if (ajoutees.length === 0) {
      console.log('Aucune course à ajouter.');
    } else {
      console.log(`${options.essai ? 'À ajouter' : 'Ajoutées'} : ${ajoutees.length}`);
      for (const a of ajoutees) {
        console.log(`  ${formaterDate(a.debut)} : ${a.minutes} min, ${(a.distance / 1000).toFixed(1)} km`);
      }
    }
    if (ignorees.length > 0) {
      console.log(`Ignorées : ${ignorees.length}`);
      for (const i of ignorees) console.log(`  ${i.id} : ${i.raison}`);
    }
    if (options.essai && ajoutees.length > 0) console.log('(essai : rien n’a été écrit)');
    if (!options.essai && ajoutees.length > 0) {
      const lignes = ajoutees.map((a) => `${formaterDate(a.debut)} : ${a.minutes} min, ${(a.distance / 1000).toFixed(1)} km`);
      prevenir(`Coulisse : ${ajoutees.length} footing(s) versé(s)`, lignes.join('\n'), { silencieux: true });
    }
  } catch (e) {
    console.error(`Échec à l’étape « ${e.etape ?? 'inconnue'} » : ${e.message}`);
    prevenir('Coulisse : versement Garmin en échec', `Étape « ${e.etape ?? 'inconnue'} » : ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

