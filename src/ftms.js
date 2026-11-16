// Décodage des messages Bluetooth FTMS (Fitness Machine Service) d'un rameur.
//
// Fonctions pures : elles reçoivent des octets et rendent des objets, sans Bluetooth
// ni état. Elles se testent donc sur des trames enregistrées (tests/fixtures/).
//
// Sources de la disposition des octets :
// - Bluetooth SIG, Fitness Machine Service 1.0, §4.8 (Rower Data, table 4.9),
//   §4.16 (Machine Status), §4.10 (Training Status), §4.3 (Feature).
// - Fichiers GSS du Bluetooth SIG (org.bluetooth.characteristic.rower_data.yaml),
//   tels que repris par ftms-js (MIT), src/core/machineData.ts.
// - Écart constaté sur un rameur réel : le champ de résistance arrive sur 16 bits
//   alors que la norme le donne sur 8. La longueur du paquet le trahit.

/** Valeur « donnée non disponible » des champs signés sur 16 bits. */
const NA_S16 = 0x7fff;

/** Accepte un Uint8Array, un ArrayBuffer, un DataView ou une chaîne hexadécimale. */
export function versOctets(entree) {
  if (typeof entree === 'string') {
    const propre = entree.replace(/[^0-9a-f]/gi, '');
    const octets = new Uint8Array(propre.length / 2);
    for (let i = 0; i < octets.length; i++) octets[i] = parseInt(propre.slice(2 * i, 2 * i + 2), 16);
    return octets;
  }
  if (entree instanceof Uint8Array) return entree;
  if (entree instanceof DataView) return new Uint8Array(entree.buffer, entree.byteOffset, entree.byteLength);
  if (entree instanceof ArrayBuffer) return new Uint8Array(entree);
  throw new TypeError('octets attendus');
}

function lecteur(octets) {
  let pos = 0;
  return {
    get pos() { return pos; },
    reste() { return octets.length - pos; },
    u8() { return octets[pos++]; },
    u16() { const v = octets[pos] | (octets[pos + 1] << 8); pos += 2; return v; },
    s16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; },
    u24() { const v = octets[pos] | (octets[pos + 1] << 8) | (octets[pos + 2] << 16); pos += 3; return v; },
  };
}

// Longueur, en octets, de chaque groupe de champs selon son bit de drapeau (table 4.9).
// Le bit 0 est inversé : à 0, la cadence et le nombre de coups sont présents.
function longueurAttendue(drapeaux, resistanceSur16) {
  let n = 2;
  if (!(drapeaux & 1)) n += 3;           // cadence (u8) + nombre de coups (u16)
  if (drapeaux & (1 << 1)) n += 1;       // cadence moyenne
  if (drapeaux & (1 << 2)) n += 3;       // distance totale
  if (drapeaux & (1 << 3)) n += 2;       // allure instantanée
  if (drapeaux & (1 << 4)) n += 2;       // allure moyenne
  if (drapeaux & (1 << 5)) n += 2;       // puissance instantanée
  if (drapeaux & (1 << 6)) n += 2;       // puissance moyenne
  if (drapeaux & (1 << 7)) n += resistanceSur16 ? 2 : 1;
  if (drapeaux & (1 << 8)) n += 5;       // énergie : totale, par heure, par minute
  if (drapeaux & (1 << 9)) n += 1;       // fréquence cardiaque
  if (drapeaux & (1 << 10)) n += 1;      // équivalent métabolique
  if (drapeaux & (1 << 11)) n += 2;      // temps écoulé
  if (drapeaux & (1 << 12)) n += 2;      // temps restant
  return n;
}

/**
 * Décode une trame Rower Data (caractéristique 0x2AD1).
 * Rend un objet dont seuls les champs présents dans la trame sont définis.
 * Lève une erreur si la longueur ne correspond à aucune lecture possible.
 */
export function decoderRameur(entree) {
  const octets = versOctets(entree);
  if (octets.length < 2) throw new RangeError('trame trop courte');
  const drapeaux = octets[0] | (octets[1] << 8);

  let resistanceSur16;
  if (octets.length === longueurAttendue(drapeaux, false)) resistanceSur16 = false;
  else if (octets.length === longueurAttendue(drapeaux, true)) resistanceSur16 = true;
  else throw new RangeError(`longueur ${octets.length} incompatible avec les drapeaux 0x${drapeaux.toString(16)}`);

  const r = lecteur(octets);
  r.u16();
  const d = {};
  if (!(drapeaux & 1)) {
    d.cadence = r.u8() / 2;              // coups par minute, résolution 0,5
    d.coups = r.u16();
  }
  if (drapeaux & (1 << 1)) d.cadenceMoyenne = r.u8() / 2;
  if (drapeaux & (1 << 2)) d.distance = r.u24();          // mètres
  if (drapeaux & (1 << 3)) d.allure = r.u16();            // secondes aux 500 m
  if (drapeaux & (1 << 4)) d.allureMoyenne = r.u16();
  if (drapeaux & (1 << 5)) { const p = r.s16(); if (p !== NA_S16) d.puissance = p; }   // watts
  if (drapeaux & (1 << 6)) { const p = r.s16(); if (p !== NA_S16) d.puissanceMoyenne = p; }
  if (drapeaux & (1 << 7)) d.resistance = resistanceSur16 ? r.s16() : r.u8();
  if (drapeaux & (1 << 8)) {
    d.calories = r.u16();                // kcal
    d.caloriesParHeure = r.u16();
    d.caloriesParMinute = r.u8();
  }
  if (drapeaux & (1 << 9)) d.frequenceCardiaque = r.u8();  // 0 : pas de ceinture
  if (drapeaux & (1 << 10)) d.met = r.u8() / 10;
  if (drapeaux & (1 << 11)) d.tempsEcoule = r.u16();       // secondes
  if (drapeaux & (1 << 12)) d.tempsRestant = r.u16();
  return d;
}

/**
 * Décode Fitness Machine Status (0x2ADA). Les seuls cas utiles à la page sont
 * nommés ; les autres rendent leur code brut.
 */
export function decoderStatut(entree) {
  const o = versOctets(entree);
  const code = o[0];
  switch (code) {
    case 0x01: return { type: 'reinitialise' };
    case 0x02: return { type: o[1] === 1 ? 'arrete' : o[1] === 2 ? 'en-pause' : 'arrete-ou-pause' };
    case 0x04: return { type: 'demarre' };
    case 0x07: {
      const brut = o.length >= 3 ? (o[1] | (o[2] << 8)) : o[1];
      return { type: 'resistance-cible', niveau: brut / 10 };
    }
    default: return { type: 'autre', code };
  }
}

const ETATS_ENTRAINEMENT = { 0x00: 'autre', 0x01: 'repos', 0x0d: 'mode-libre' };

/** Décode Training Status (0x2AD3) : drapeaux, puis l'état. */
export function decoderEntrainement(entree) {
  const o = versOctets(entree);
  return { etat: ETATS_ENTRAINEMENT[o[1]] ?? `code-${o[1]}` };
}

/** Décode Fitness Machine Feature (0x2ACC) : ce que la machine sait mesurer et piloter. */
export function decoderCapacites(entree) {
  const o = versOctets(entree);
  const mesures = o[0] | (o[1] << 8) | (o[2] << 16) | (o[3] << 24);
  const cibles = o[4] | (o[5] << 8) | (o[6] << 16) | (o[7] << 24);
  const bit = (v, i) => Boolean((v >>> i) & 1);
  return {
    cadence: bit(mesures, 1),
    distance: bit(mesures, 2),
    allure: bit(mesures, 5),
    resistance: bit(mesures, 7),
    energie: bit(mesures, 9),
    frequenceCardiaque: bit(mesures, 10),
    tempsEcoule: bit(mesures, 12),
    puissance: bit(mesures, 14),
    resistancePilotable: bit(cibles, 2),
    puissancePilotable: bit(cibles, 3),
  };
}

/** Décode Supported Resistance Level Range (0x2AD6), résolution 0,1. */
export function decoderPlageResistance(entree) {
  const o = versOctets(entree);
  const r = lecteur(o);
  return { min: r.s16() / 10, max: r.s16() / 10, pas: r.u16() / 10 };
}
