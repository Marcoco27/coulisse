# Coulisse

Une page web libre et gratuite pour suivre ses séances sur un rameur
d'appartement connecté. Sans compte, sans abonnement, sans rien installer.

> **État : version 0.1, fonctionnelle en local.** La page s'utilise dès
> maintenant en servant ce dossier en local. Aucune version n'est encore
> publiée en ligne.

## L'idée

- **Mesurer.** Pendant la séance, l'écran affiche l'allure aux 500 m, la
  cadence, le temps et la distance.
- **Garder l'historique.** Chaque séance s'enregistre toute seule, se retrouve
  plus tard avec son résumé, et s'exporte en fichier JSON ou CSV.
- **Tenir dans la durée.** Vous fixez un nombre de séances par semaine. La page
  montre où vous en êtes, compte aussi vos autres activités, et ne vous pénalise
  pas pour une semaine de déplacement. Ses règles s'appuient sur des sources
  publiées.

## Comment ça marche

La page parle au rameur par Web Bluetooth, une fonction du navigateur Chrome.
Elle fonctionne dans Chrome sur Android et sur ordinateur. Elle ne fonctionne
pas dans Safari sur iPhone, qui ne propose pas cette fonction.

Dès la connexion, elle règle aussi la résistance du rameur au niveau conseillé
(pas encore vérifié sur l'appareil).

Le rameur doit suivre la norme FTMS (Fitness Machine Service), le langage
Bluetooth commun des machines de sport.

## Machines

Le projet se construit et s'essaie sur un Domyos Woodrower (référence
Decathlon 8604435). Tout rameur à la norme FTMS devrait fonctionner, mais rien
n'est encore vérifié sur un autre modèle.

## Vos données

Vos séances restent dans votre navigateur. La page n'a ni serveur, ni compte,
ni traceur.

## Avertissements

Cette page ne donne pas d'avis médical. Demandez conseil à un médecin avant de
reprendre une activité physique si vous avez un doute sur votre santé.

Ce projet est indépendant. Il n'a aucun lien avec Decathlon ni avec Domyos, dont
les noms ne sont cités que pour indiquer une compatibilité.

## Licence

[MIT](LICENSE). Vous pouvez utiliser, copier et modifier ce code librement.
