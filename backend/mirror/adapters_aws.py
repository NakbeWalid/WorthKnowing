"""Adaptateurs AWS — À IMPLÉMENTER PAR KIRO (voir docs/KIRO_PROMPTS.md).

Chaque classe implémente un port de `ports.py` avec exactement les mêmes signatures que
son équivalent local (`adapters_local.py`, `market.py`). Le cœur ne change pas.
Tous les tests de `backend/tests/` doivent continuer de passer en local, et les tests
d'intégration AWS s'ajoutent dans `backend/tests_aws/`.
"""
from __future__ import annotations

TODO = "À implémenter par Kiro : voir docs/KIRO_PROMPTS.md, prompt {n}."


class DynamoRepository:            # port Repository  — prompt 2
    def __init__(self, table_name: str):
        raise NotImplementedError(TODO.format(n=2))


class AthenaMarketData:            # port MarketData  — prompt 3
    def __init__(self, database: str, workgroup: str):
        raise NotImplementedError(TODO.format(n=3))


class BedrockTextModel:            # port TextModel   — prompt 4
    name = "bedrock"

    def __init__(self, model_id: str, guardrail_id: str | None = None):
        raise NotImplementedError(TODO.format(n=4))


class EventBridgeBus:              # port EventBus    — prompt 6
    def __init__(self, bus_name: str):
        raise NotImplementedError(TODO.format(n=6))


class S3NewsSource:                # port NewsSource  — prompt 7
    def __init__(self, bucket: str, prefix: str):
        raise NotImplementedError(TODO.format(n=7))


class LambdaWebhookSender:         # port WebhookSender — prompt 6
    def __init__(self, queue_url: str):
        raise NotImplementedError(TODO.format(n=6))


def build_aws_service():
    """Assemble MirrorService avec les adaptateurs AWS (variables d'environnement). Prompt 5."""
    raise NotImplementedError(TODO.format(n=5))
