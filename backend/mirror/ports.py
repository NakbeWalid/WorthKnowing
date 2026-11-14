"""Ports : les interfaces que le cœur du système utilise.

Le cœur (simulation, scores, règles, enquête, dérive) ne connaît que ces interfaces.
En local, elles sont servies par `adapters_local.py` (fichiers, mémoire, gabarits).
Sur AWS, Kiro les implémente dans `adapters_aws.py` (voir docs/KIRO_PROMPTS.md) :

    Repository   -> Amazon DynamoDB
    MarketData   -> Amazon S3 + Athena (Parquet)
    TextModel    -> Amazon Bedrock (Converse + Guardrails)
    EventBus     -> Amazon EventBridge + AWS Step Functions
    NewsSource   -> ingestion planifiée (EventBridge Scheduler -> Lambda -> S3)
    SocialSource -> jeu synthétique (démo) / connecteurs OAuth officiels (extension)
    WebhookSender-> Lambda de livraison + file de rebut

Le choix se fait par la variable d'environnement MIRROR_ENV (local | aws).
"""
from __future__ import annotations

from typing import Any, Callable, Protocol


class Repository(Protocol):
    """Stockage clé-valeur par table. Correspond à une table DynamoDB (pk = table, sk = key)."""

    def put(self, table: str, key: str, item: dict) -> None: ...
    def get(self, table: str, key: str) -> dict | None: ...
    def list(self, table: str, prefix: str = "") -> list[dict]: ...
    def delete(self, table: str, key: str) -> None: ...


class MarketData(Protocol):
    def known(self, symbol: str) -> bool: ...
    def asset(self, symbol: str) -> dict | None: ...
    def context(self, symbol: str, at_iso: str) -> dict | None:
        """Indicateurs calculés avec les seules données antérieures à `at_iso`."""
    def path(self, symbol: str, start: str, end: str) -> list[float]: ...


class TextModel(Protocol):
    """Rédaction contrainte. L'implémentation locale utilise des gabarits ; Bedrock la remplace.

    Dans les deux cas, la sortie repasse par les validateurs du code (aucune confiance aveugle).
    """

    name: str

    def write_trigger(self, spec: dict, facts: dict) -> dict | None: ...
    def choose_scenario(self, state: dict, candidates: list[dict]) -> dict | None: ...
    def explain(self, kind: str, dossier: dict) -> list[dict] | None: ...
    def parse_rule(self, text: str, weakness: dict) -> dict | None: ...
    def classify_relevance(self, item: dict, symbol: str, asset: dict | None) -> float | None: ...


class EventBus(Protocol):
    def subscribe(self, event_type: str, handler: Callable[[dict], Any]) -> None: ...
    def publish(self, event_type: str, payload: dict) -> None: ...


class NewsSource(Protocol):
    def items(self, start_iso: str, end_iso: str) -> list[dict]: ...


class SocialSource(Protocol):
    platforms: list[str]

    def items(self, user_id: str, platform: str, start_iso: str, end_iso: str) -> list[dict]: ...
    def coverage(self, platform: str) -> str: ...


class WebhookSender(Protocol):
    def send(self, url: str, body: bytes, headers: dict) -> int: ...
