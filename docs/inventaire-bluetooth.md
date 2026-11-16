# Inventaire Bluetooth du rameur

Constaté le 2026-11-16 sur un Domyos Woodrower (modèle 8604435), à partir d'une
capture de dix minutes faite avec la page de démonstration de `ftms-js` dans
Chrome. L'extrait publié est `tests/fixtures/rameur-protocole.json`.

## Verdict

**Le rameur suit la norme FTMS, à un écart près.** Il envoie ses mesures par la
caractéristique Rower Data (`0x2AD1`). Toutes les trames se décodent selon la
table 4.9 de la norme, sauf le champ de résistance : la norme le prévoit sur un
octet, le rameur l'envoie sur deux. `ftms-js` relève le même écart sur un rameur
Domyos. Le décodeur (`src/ftms.js`) choisit la bonne lecture d'après la longueur
de la trame.

**La résistance est pilotable.** La caractéristique `0x2ACC` l'annonce (bit 2 des
réglages de cible). Ce point reste à éprouver en écrivant une commande : la
version 0.1 ne le fait pas.

## Identité annoncée

| Champ | Valeur |
|---|---|
| Nom Bluetooth | `Domyos-ROW-` suivi de quatre chiffres |
| Fabricant | `DECATHLON` |
| Modèle | `8604435` |
| Matériel | `1.0.0` |
| Micrologiciel | Console 2.5.0, Bluetooth 2.6.0, B805 2.5.0 |

## Caractéristiques lues

Seules les caractéristiques du service FTMS (`0x1826`) que lit `ftms-js` ont été
vues. La liste complète des services n'a pas été dressée : la capture depuis un
ordinateur sous Linux (`outils/capture-ble.py`) n'a pas encore servi.

| Caractéristique | Rôle | Constaté |
|---|---|---|
| `0x2ACC` Feature | ce que la machine sait faire | `a6 56 00 00 04 00 00 00` |
| `0x2AD6` Resistance Range | plage de résistance | 1 à 15, pas de 1 |
| `0x2AD1` Rower Data | mesures, en notification | trames de 23 octets |
| `0x2ADA` Machine Status | démarrage, pause, arrêt, résistance | voir plus bas |
| `0x2AD3` Training Status | état de l'entraînement | `repos` ou `mode libre` |

**Ce que la machine dit mesurer** (`0x2ACC`) : cadence, distance, allure,
résistance, énergie, fréquence cardiaque, temps écoulé, puissance.

## Contenu d'une trame de mesure

Drapeaux constants `0x0BAE`. Chaque trame porte, dans l'ordre : cadence (coups
par minute, au demi-coup), nombre de coups, cadence moyenne, distance (mètres),
allure (secondes aux 500 m), puissance (watts), résistance, calories (totales,
par heure, par minute), fréquence cardiaque, temps écoulé (secondes).

Absents : allure moyenne, puissance moyenne, temps restant. La page les calcule
elle-même si elle en a besoin.

La fréquence cardiaque vaut 0 sans ceinture cardiaque.

## Rythme

Une trame toutes les 250 ms environ, soit quatre par seconde. Les valeurs ne
changent qu'environ une fois par seconde : chaque mesure est répétée. Sur dix
minutes, 2 545 trames, dont 472 différentes de la précédente.

## Comportement à l'arrêt

C'est le point qui commande le plus la conception de la page.

1. **Quand on cesse de ramer**, le rameur envoie `pause` (`02 02`) et l'état
   d'entraînement passe à `repos`. Le temps écoulé s'arrête. Les compteurs
   gardent leur valeur. La connexion ne tombe pas : les trames continuent.
2. **Quand on reprend**, il envoie `démarré` (`04`) et le temps repart d'où il
   s'était arrêté. Le temps écoulé ne compte donc que le temps ramé : 291 s
   annoncés pour 290 s mesurés entre les statuts.
3. **Après 121 secondes de pause**, il envoie `arrêté` (`02 01`) et remet tous les
   compteurs à zéro. Constaté deux fois, à la seconde près. La page doit donc
   avoir enregistré la séance avant cette remise à zéro, et traiter une remise à
   zéro comme la fin d'une séance.

## Changement de résistance

Un changement fait sur la console arrive comme un statut `résistance cible`
(`07`, suivi du niveau en dixièmes), puis la trame de mesure suivante porte le
nouveau niveau. Les deux concordent dans toute la capture.

## Comment ces constats ont été vérifiés

- `node --test` : le décodeur lit toutes les trames de l'extrait, les totaux de
  la séance gardée sont fixés dans les tests, et le temps écoulé concorde avec
  les statuts de pause.
- Contre-épreuve : le décodeur de `ftms-js` 0.1.2 donne les mêmes valeurs, champ
  par champ, sur les 2 545 trames de la capture complète.
- La console ne sert pas de référence. Elle affiche une mesure à la fois puis
  s'éteint. Les totaux envoyés en Bluetooth sont ceux qu'elle calcule.
