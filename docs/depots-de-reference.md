# Dépôts de référence

Relevé du 2026-11-15, par deux recherches sur GitHub. Chaque ligne dit ce que le
dépôt est, sa licence, et ce qu'on en tire. Les étoiles et les dates vieillissent :
les revérifier avant de s'y fier.

Règle de reprise : un code sans licence ou sous GPL se lit pour comprendre et ne
se recopie pas. Un code sous MIT se reprend avec la mention de sa licence.

## Ceux qui parlent à ce rameur précis

| Dépôt | Ce que c'est | Licence | Ce qu'on en tire |
|---|---|---|---|
| `Web3Dave/ftms-js` | Bibliothèque TypeScript pour navigateur, sans dépendance, qui parle FTMS par Web Bluetooth. Son README déclare avoir vérifié sur un « Domyos Wood Rower (Decathlon 8604435) » la connexion, les données en direct, le démarrage, l'arrêt et la résistance. Page de démonstration : `https://web3dave.github.io/ftms-js/`. Créé le 2026-11-14, version 0.1. | MIT | La référence la plus proche de notre projet. Sa page de démonstration sert d'essai immédiat, ses décodeurs de contre-épreuve. |
| `slavayssiere/rower-app` | Application Android en Kotlin pour le Woodrower. Contient `FtmsParser.kt`, `WoodrowerBleManager.kt`, un export vers Strava et Garmin, et des séances réelles au format TCX dans `inputs/`. Créé le 2026-10-09, sans README. | aucune | À lire pour voir comment une application parle à ce modèle. |
| `mathias-palm/Woodrover_HIIT` | Application Android en Kotlin pour le Woodrower 2, tournée vers le fractionné. | GPL-3.0 | À lire. |
| `ptc/ruderkraft.app` | Application Android pour le Woodrower : données en direct et séances à résistance variable. Le dépôt ne contient qu'un README, des captures d'écran et un fichier APK. | aucune, code fermé | Confirme que la résistance se pilote. Montre un écran possible. |
| RowerTrain | Application fermée, payante en version complète, conçue d'abord pour les rameurs Domyos. Son site, dans `iliuta/iliuta.github.io`, cite le Woodrower parmi les modèles connus. | fermée | Le point de comparaison : ce qu'un produit fini propose. |

## Ceux qui documentent le protocole

| Dépôt | Ce que c'est | Licence | Ce qu'on en tire |
|---|---|---|---|
| `Decathlon/domyos-developers` | Dépôt officiel. Liste le WoodRower parmi les machines FTMS et donne un exemple Web Bluetooth. Fixe aussi les règles de marque. | CC-BY-4.0 | La preuve officielle et la forme de l'appel `requestDevice`. |
| `cagnulein/qdomyos-zwift` | Pont entre machines de sport et Zwift, 909 étoiles, actif. `src/devices/ftmsrower/ftmsrower.cpp` décode la caractéristique `0x2AD1` et porte le piège des rameurs `DOMYOS-ROW-`. | GPL-3.0 | Le dictionnaire des bizarreries Domyos. |
| `DylanBeMe/fellwater` | Application Android pour rameurs Tunturi et FTMS. Ses notes de protocole, dans `docs/protocol/`, relèvent que l'application Domyos reconnaît les préfixes de nom `domyos-row-` et `domyos-wr`. | aucune | Une lecture claire du protocole. Son mode « ramer contre soi-même » existe déjà. |

## Ceux qui ressemblent à notre page

| Dépôt | Ce que c'est | Licence | Ce qu'on en tire |
|---|---|---|---|
| `GiBruGa/Pennach` | Page web de suivi pour un rameur Merach, par Web Bluetooth et FTMS, avec un cahier des charges dans `SPEC.md`. Écrit avec npm et TypeScript. | aucune | Le cahier des charges le plus proche du nôtre. |
| `atomberg/ftms-rower-display` | Affichage web minimal pour rameurs FTMS. | MIT | Un exemple court. |
| `aldoushx/domyos_rower` | Intégration Home Assistant en français, testée sur un Rower 500, autre modèle. | aucune | Des idées de séances programmées et d'export. |
