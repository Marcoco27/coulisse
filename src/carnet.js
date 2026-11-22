// Fusion du carnet entre le navigateur et le serveur : fonction pure, sans réseau ni disque.
//
// Le carnet est un document unique
//   { id: 'carnet', maj, reglages, supprimees, activites }
// « maj » sert seulement à choisir les réglages et la version d'une même activité :
// les activités sont toujours réunies par identifiant, et les suppressions sont conservées.

/**
 * Fusionne deux carnets sans modifier les objets reçus.
 * - réglages : ceux du carnet au maj le plus grand ;
 * - supprimees : union des identifiants supprimés ;
 * - activites : union par id, la version du carnet le plus récent gagnant à id égal ;
 * - les activités dont l'id est dans supprimees sont retirées ;
 * - maj : le plus grand des deux.
 */
export function fusionnerCarnets(a, b) {
  const ca = a ?? null;
  const cb = b ?? null;
  const majA = ca?.maj ?? 0;
  const majB = cb?.maj ?? 0;
  const maj = Math.max(majA, majB);

  const recent = !ca ? cb : !cb ? ca : (majA >= majB ? ca : cb);
  const reglages = recent?.reglages ?? {};

  const supprimees = [];
  const supprimeesSet = new Set();
  for (const carnet of [ca, cb]) {
    for (const id of carnet?.supprimees ?? []) {
      if (!supprimeesSet.has(id)) {
        supprimeesSet.add(id);
        supprimees.push(id);
      }
    }
  }

  const parId = new Map();
  // Du plus ancien au plus récent pour qu'à id égal la version récente écrase l'ancienne.
  const carnets = majA >= majB ? [cb, ca] : [ca, cb];
  for (const carnet of carnets) {
    for (const activite of carnet?.activites ?? []) {
      if (activite && activite.id != null) parId.set(activite.id, activite);
    }
  }

  const activites = [...parId.values()]
    .filter((activite) => !supprimeesSet.has(activite.id))
    .sort((x, y) => x.debut - y.debut);

  return { id: 'carnet', maj, reglages, supprimees, activites };
}
