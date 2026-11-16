# Rameur

Carte posée le 2026-11-15. Une carte vieillit : la vérifier plutôt que la croire.

## Rôle

Une page web libre, sous licence MIT, pour suivre ses séances sur un rameur
d'appartement connecté. Elle tourne dans Chrome, lit les données du rameur en
Bluetooth, garde l'historique des séances et aide à tenir un objectif
hebdomadaire. Elle se destine à tout propriétaire d'un rameur à la norme FTMS.
Le premier modèle visé est le Domyos Woodrower.

Ce dépôt est public, ou le deviendra. Aucun fichier suivi par git ne porte de
donnée personnelle : ni nom, ni machine, ni adresse, ni séance.

## Ce qui est établi, et d'où cela vient

- **Le Woodrower parle FTMS** (Fitness Machine Service, le langage Bluetooth
  standard des machines de sport). Source : le README du dépôt officiel
  `Decathlon/domyos-developers`, lu le 2026-11-15, qui liste « Rower :
  WoodRower » parmi les machines compatibles.
- **Une bibliothèque déclare avoir déjà parlé à ce modèle exact.** Le README de
  `Web3Dave/ftms-js`, lu le 2026-11-15, dit avoir vérifié sur un « Domyos Wood
  Rower (Decathlon 8604435) » la connexion, les données en direct, le démarrage,
  l'arrêt et la résistance. Ses tests citent le nom Bluetooth `Domyos-ROW-0000`.
  Le dépôt date du 2026-11-14 : c'est la déclaration d'un auteur, pas encore un
  constat fait ici.
- **Des trames réelles ont été lues le 2026-11-16.** Le détail est dans
  `docs/inventaire-bluetooth.md`. La console affiche une mesure à la fois puis
  s'éteint : elle ne sert pas de référence pour vérifier les totaux.
- **Le Woodrower est auto-alimenté**, d'après sa fiche commerciale, non
  vérifiée. Déduction : son Bluetooth dort tant que personne ne rame. Tout essai
  réel demande donc quelqu'un sur le rameur.
- **Un seul appareil à la fois.** Un périphérique Bluetooth de ce genre
  n'accepte en général qu'une connexion. Si une autre application est connectée,
  le rameur devient invisible.
- **Piège Domyos relevé dans `cagnulein/qdomyos-zwift`**, fichier
  `src/devices/ftmsrower/ftmsrower.cpp`, lu le 2026-11-15 : un rameur dont le nom
  Bluetooth commence par `DOMYOS-ROW-` n'envoie ses mesures que si l'on s'abonne
  au seul service FTMS (chercher la chaîne « want to be subscribed only to FTMS
  service »). Le même dépôt contient `domyosrower.cpp`, qui parle un protocole
  propriétaire plus ancien, par le service `49535343-fe7d-4ae5-8fa9-9fafd205e455`.
- **Web Bluetooth** (la fonction de Chrome qui laisse une page parler à un
  appareil Bluetooth) fonctionne dans Chrome sur Android et sur ordinateur, pas
  dans Safari sur iPhone. Elle exige une page servie en `https` ou depuis
  `localhost`, et un toucher de l'utilisateur pour ouvrir la liste des
  appareils. Une page ne voit que les services qu'elle a déclarés à l'avance.

## Arborescence

- `README.md` : la présentation publique du projet.
- `LICENSE` : la licence MIT.
- `CLAUDE.md` : cette carte.
- `docs/depots-de-reference.md` : les dépôts GitHub proches, leur licence et ce
  qu'on en tire.
- `docs/bases-scientifiques.md` : les quinze règles d'entraînement et de
  motivation de la page, R1 à R15, chacune avec sa source et la force de sa
  preuve, puis la liste de ce que la page n'écrit pas.
- `docs/inventaire-bluetooth.md` : ce que le rameur publie réellement, constaté
  sur une capture le 2026-11-16 (résistance sur 16 bits, remise à zéro après
  121 s de pause).
- `src/ftms.js` : le décodeur, en fonctions pures (mesures, statuts, capacités).
- `src/seance.js` : découpage du flux en séances, résumé (moyennes, temps de
  passage aux 500 m), exports CSV, contrôle d'un fichier importé. Fonctions pures.
- `web/stockage.js` : l'historique dans le navigateur (IndexedDB), un échantillon
  écrit par seconde ramée, dès son arrivée.
- `tests/ftms.test.js` et `tests/seance.test.js` : leurs tests, sur `tests/fixtures/rameur-protocole.json`,
  extrait d'une capture réelle sans date ni numéro de série.
- `outils/capture-ble.py` : capture depuis un ordinateur Linux par `bleak`, pas
  encore essayée sur le rameur.
- `outils/extraire-fixture.mjs` : tire un extrait publiable d'une capture.
- `outils/serveur.mjs` : serveur local sans dépendance (`node outils/serveur.mjs`,
  port 8790). Sert la page et écrit dans `donnees/` les trames qu'elle lui envoie.
- `web/` : la page (`index.html`, `style.css`, `app.js`). Écran en direct par Web
  Bluetooth, résumé de fin, historique avec export et import. Rejeu d'une capture
  par `?rejeu=1&vitesse=20`, `&depuis=S`, `&jusqua=S` ; il écrit dans une base à
  part, `rameur-rejeu`, que `?base=rameur-rejeu&vue=historique` relit.
- `donnees/` : captures complètes, ignorées par git.
- `.claude/settings.json` : retire la ligne d'attribution des commits.

Chaque dossier créé s'ajoute ici le jour même.

## Vérification

La commande est celle du lanceur de tests intégré à node :

```bash
node --test
```

Le 2026-11-16, elle affiche `tests 24`, `pass 24`. Un rapport à zéro test n'est
pas un succès. La console du rameur ne sert pas de référence : les tests
contrôlent la cohérence des chiffres entre eux, et le décodeur de `ftms-js`
0.1.2 a servi de contre-épreuve (zéro écart sur 2 545 trames).

L'écran se contrôle sur le rejeu de la capture, servi en HTTP local (le serveur
MCP Playwright n'ouvre pas `file://`). Le 2026-11-16, une séance réelle de
3 min 45 s a été suivie en direct depuis un portable sous Windows, la page étant
ouverte par `localhost` à travers la redirection de port de VS Code : 1 514
trames reçues, aucune erreur de décodage.

## Règles propres à ce dépôt

- **Aucune dépendance, aucune étape de construction.** HTML, CSS et JavaScript
  en modules, lisibles tels quels par Chrome. Une page sans dépendance marchera
  encore dans cinq ans, et n'importe qui peut la lire en entier.
- **Les dépôts de référence et leurs licences** sont dans
  `docs/depots-de-reference.md`. Un code sans licence ou sous GPL se lit pour
  comprendre et ne se recopie pas. Un code sous MIT, comme `ftms-js`, se reprend
  avec la mention de sa licence.
- **Toute règle d'entraînement ou de motivation appliquée par la page s'appuie
  sur une source publiée**, citée dans `docs/bases-scientifiques.md`. Le code
  porte le numéro de la règle en commentaire. Une valeur notée « convention »
  dans ce relevé devient un réglage. La page ne donne pas d'avis médical et ne
  promet aucun résultat.
- **Le nom de l'application ne contient ni « Domyos » ni « Decathlon »**, selon
  les règles de marque du dépôt officiel.
- **Les données de séance restent hors de git.** Les dossiers `donnees/` et
  `tmp/` sont ignorés. Seuls de courts extraits de trames, sans date
  reconnaissable, servent de tests.
- **L'interface est en français d'abord.** Les textes se regroupent, pour qu'une
  traduction reste possible.
