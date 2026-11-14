"""Adaptateurs locaux : fichiers JSON, mémoire, gabarits. Aucune dépendance AWS."""
from __future__ import annotations

import json
import threading
import urllib.request
from pathlib import Path
from typing import Any, Callable


class JsonRepository:
    """Stockage en mémoire, sauvegardé dans un fichier JSON (facultatif)."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else None
        self._lock = threading.RLock()
        self._data: dict[str, dict[str, dict]] = {}
        if self.path and self.path.exists():
            self._data = json.loads(self.path.read_text(encoding="utf-8"))

    def _flush(self) -> None:
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self._data, ensure_ascii=False), encoding="utf-8")

    def put(self, table: str, key: str, item: dict) -> None:
        with self._lock:
            self._data.setdefault(table, {})[key] = json.loads(json.dumps(item, ensure_ascii=False))
            self._flush()

    def get(self, table: str, key: str) -> dict | None:
        with self._lock:
            item = self._data.get(table, {}).get(key)
            return json.loads(json.dumps(item)) if item is not None else None

    def list(self, table: str, prefix: str = "") -> list[dict]:
        with self._lock:
            rows = self._data.get(table, {})
            return [json.loads(json.dumps(v)) for k, v in sorted(rows.items()) if k.startswith(prefix)]

    def delete(self, table: str, key: str) -> None:
        with self._lock:
            self._data.get(table, {}).pop(key, None)
            self._flush()


class InProcessBus:
    """Bus d'événements local. `sync=True` exécute les traitements immédiatement (tests)."""

    def __init__(self, sync: bool = True):
        self.sync = sync
        self._handlers: dict[str, list[Callable[[dict], Any]]] = {}

    def subscribe(self, event_type: str, handler: Callable[[dict], Any]) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    def publish(self, event_type: str, payload: dict) -> None:
        for h in self._handlers.get(event_type, []):
            if self.sync:
                h(payload)
            else:
                threading.Thread(target=h, args=(payload,), daemon=True).start()


class TemplateTextModel:
    """Modèle de texte local : ne rédige rien lui-même (renvoie None partout).

    Le cœur utilise alors ses gabarits déterministes. C'est aussi le repli quand
    Bedrock échoue ou qu'une sortie est rejetée par un validateur.
    """

    name = "gabarits-locaux"

    def write_trigger(self, spec, facts):
        return None

    def choose_scenario(self, state, candidates):
        return None

    def explain(self, kind, dossier):
        return None

    def parse_rule(self, text, weakness):
        return None

    def classify_relevance(self, item, symbol, asset):
        return None


class FileNewsSource:
    """Nouvelles de démonstration (FICTIVES, étiquetées). Remplacée par l'ingestion réelle sur AWS."""

    def __init__(self, path: str | Path):
        p = Path(path)
        self._items = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

    def items(self, start_iso: str, end_iso: str) -> list[dict]:
        return [i for i in self._items if start_iso <= i["published_at"] <= end_iso]


class SyntheticSocialSource:
    """Comptes liés FICTIFS (jeu synthétique généré par scripts/generate_synthetic_social.py)."""

    platforms = ["instagram", "linkedin"]

    def __init__(self, path: str | Path):
        p = Path(path)
        self._data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    def items(self, user_id: str, platform: str, start_iso: str, end_iso: str) -> list[dict]:
        key = user_id.split("-")[0]  # « amira-xxxx » -> jeu du persona « amira »
        rows = self._data.get(key, self._data.get("default", []))
        return [r for r in rows if r["platform"] == platform and start_iso <= r["published_at"] <= end_iso]

    def coverage(self, platform: str) -> str:
        # Reflète la limite réelle des API officielles : interactions visibles, consultations non.
        return "partielle" if platform == "linkedin" else "interactions et comptes suivis"


class HttpWebhookSender:
    def send(self, url: str, body: bytes, headers: dict) -> int:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=5) as r:  # noqa: S310 (URL fournie par l'hôte)
            return r.status
