# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22"]
# ///
"""Inventaire et capture brute d'un rameur Bluetooth (norme FTMS).

Usage :
    uv run outils/capture-ble.py balayer            # liste les appareils proches
    uv run outils/capture-ble.py capturer [--nom X] [--duree 420]

`capturer` se connecte au premier appareil qui annonce le service FTMS (0x1826)
ou dont le nom contient X, écrit l'inventaire complet (services,
caractéristiques, propriétés, valeurs lisibles) puis enregistre chaque trame
reçue, telle quelle, avec son heure. Rien n'est décodé ici : le décodeur est
une fonction pure, testée ensuite sur ces trames.

Sortie : donnees/capture-AAAAMMJJ-HHMMSS.jsonl, ignoré par git.
Une ligne par événement : {"t": secondes depuis le début, "type": ..., ...}.
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from bleak import BleakClient, BleakScanner

FTMS = "00001826-0000-1000-8000-00805f9b34fb"

# Caractéristiques FTMS auxquelles on s'abonne. Un rameur Domyos n'envoie ses
# mesures que si l'on s'abonne au seul service FTMS (constat de qdomyos-zwift,
# fichier ftmsrower.cpp) : on ne s'abonne donc à rien d'autre par défaut.
ABONNEMENTS = {
    "00002ad1-0000-1000-8000-00805f9b34fb": "rower_data",
    "00002ada-0000-1000-8000-00805f9b34fb": "machine_status",
    "00002ad3-0000-1000-8000-00805f9b34fb": "training_status",
}

RACINE = Path(__file__).resolve().parent.parent


def court(uuid: str) -> str:
    """0x2AD1 plutôt que l'UUID complet, quand c'est un UUID standard."""
    u = uuid.lower()
    if u.endswith("-0000-1000-8000-00805f9b34fb") and u.startswith("0000"):
        return "0x" + u[4:8].upper()
    return u


async def balayer(duree: float) -> None:
    trouves = await BleakScanner.discover(timeout=duree, return_adv=True)
    for adresse, (appareil, annonce) in sorted(
        trouves.items(), key=lambda kv: kv[1][1].rssi, reverse=True
    ):
        services = ", ".join(court(s) for s in annonce.service_uuids) or "-"
        print(f"{annonce.rssi:>4} dBm  {adresse}  {appareil.name or '?':<24} {services}")


async def trouver(nom: str | None, duree: float):
    def filtre(appareil, annonce):
        if nom:
            return nom.lower() in (appareil.name or "").lower()
        return FTMS in [s.lower() for s in annonce.service_uuids]

    return await BleakScanner.find_device_by_filter(filtre, timeout=duree)


async def capturer(nom: str | None, duree: int, tout: bool) -> None:
    print("Recherche du rameur (il faut ramer pour le réveiller)…", flush=True)
    appareil = await trouver(nom, 30)
    if appareil is None:
        sys.exit("Aucun rameur trouvé en 30 s. Est-il réveillé, et libre de toute autre connexion ?")

    dossier = RACINE / "donnees"
    dossier.mkdir(exist_ok=True)
    chemin = dossier / f"capture-{datetime.now():%Y%m%d-%H%M%S}.jsonl"
    debut = time.monotonic()
    sortie = chemin.open("w", encoding="utf-8")

    def ecrire(evenement: dict) -> None:
        evenement = {"t": round(time.monotonic() - debut, 3), **evenement}
        sortie.write(json.dumps(evenement, ensure_ascii=False) + "\n")
        sortie.flush()

    deconnecte = asyncio.Event()

    def sur_deconnexion(_client):
        ecrire({"type": "deconnexion"})
        print("\nDéconnexion.", flush=True)
        deconnecte.set()

    async with BleakClient(appareil, disconnected_callback=sur_deconnexion) as client:
        ecrire({"type": "connexion", "nom": appareil.name, "adresse": appareil.address})
        print(f"Connecté à {appareil.name}. Inventaire…", flush=True)

        for service in client.services:
            ecrire({"type": "service", "uuid": court(service.uuid)})
            print(f"  service {court(service.uuid)}")
            for car in service.characteristics:
                entree = {
                    "type": "caracteristique",
                    "service": court(service.uuid),
                    "uuid": court(car.uuid),
                    "proprietes": car.properties,
                }
                if "read" in car.properties:
                    try:
                        entree["valeur"] = (await client.read_gatt_char(car)).hex()
                    except Exception as e:  # une lecture refusée se note, sans arrêter
                        entree["erreur"] = str(e)
                ecrire(entree)
                print(f"    {court(car.uuid):<40} {','.join(car.properties):<30} {entree.get('valeur', '')}")

        cibles = []
        for service in client.services:
            for car in service.characteristics:
                if not ({"notify", "indicate"} & set(car.properties)):
                    continue
                if tout or car.uuid.lower() in ABONNEMENTS:
                    cibles.append(car)

        compte = {"n": 0}

        def recepteur(car):
            etiquette = ABONNEMENTS.get(car.uuid.lower(), court(car.uuid))

            def sur_trame(_c, donnees: bytearray):
                compte["n"] += 1
                ecrire({"type": "trame", "car": etiquette, "hex": donnees.hex()})
                print(f"\r{compte['n']} trames reçues", end="", flush=True)

            return sur_trame

        for car in cibles:
            await client.start_notify(car, recepteur(car))
            ecrire({"type": "abonnement", "uuid": court(car.uuid)})

        print(f"\nCapture en cours pendant {duree} s. Ctrl+C pour arrêter plus tôt.", flush=True)
        try:
            await asyncio.wait_for(deconnecte.wait(), timeout=duree)
        except asyncio.TimeoutError:
            pass

    sortie.close()
    print(f"\n{compte['n']} trames écrites dans {chemin.relative_to(RACINE)}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sous = p.add_subparsers(dest="commande", required=True)
    b = sous.add_parser("balayer")
    b.add_argument("--duree", type=float, default=15)
    c = sous.add_parser("capturer")
    c.add_argument("--nom", help="morceau du nom Bluetooth, à défaut du service FTMS")
    c.add_argument("--duree", type=int, default=420, help="secondes, 7 minutes par défaut")
    c.add_argument("--tout", action="store_true", help="s'abonner à toutes les caractéristiques, pas seulement FTMS")
    args = p.parse_args()
    try:
        if args.commande == "balayer":
            asyncio.run(balayer(args.duree))
        else:
            asyncio.run(capturer(args.nom, args.duree, args.tout))
    except KeyboardInterrupt:
        print("\nArrêt demandé.")


if __name__ == "__main__":
    main()
