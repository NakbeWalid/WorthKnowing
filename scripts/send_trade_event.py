"""Joue le rôle de la plateforme hôte en ligne de commande (aucune transaction réelle).

    python scripts/send_trade_event.py --user robert-xxxxxx --symbol NVDA --side buy --amount 9000 \
        --portfolio 60000 --weight 15 --at 2026-11-10T14:30:00-05:00 [--check]
"""
import argparse
import json
import time
import urllib.request
import uuid

p = argparse.ArgumentParser()
p.add_argument("--base", default="http://localhost:8000")
p.add_argument("--key", default="dev-host-key")
p.add_argument("--user", required=True)
p.add_argument("--symbol", required=True)
p.add_argument("--side", default="buy", choices=["buy", "sell"])
p.add_argument("--amount", type=float, required=True)
p.add_argument("--portfolio", type=float)
p.add_argument("--weight", type=float)
p.add_argument("--at", default="2026-11-10T14:30:00-05:00")
p.add_argument("--check", action="store_true", help="appeler d'abord la vérification avant le trade")
a = p.parse_args()


def call(path, body=None):
    req = urllib.request.Request(a.base + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "X-Api-Key": a.key},
                                 method="GET" if body is None else "POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


base = {"user_id": a.user, "side": a.side, "symbol": a.symbol, "amount": a.amount, "amount_currency": "CAD"}
if a.portfolio:
    base["portfolio_value"] = a.portfolio
if a.weight:
    base["position_weight_after_pct"] = a.weight
if a.check:
    print(json.dumps(call("/v1/trade-intents:check", {**base, "at": a.at}), ensure_ascii=False, indent=1))
eid = "evt-" + uuid.uuid4().hex[:8]
print(call("/v1/trade-events", {**base, "event_id": eid, "executed_at": a.at}))
for _ in range(20):
    r = call(f"/v1/trade-events/{eid}")
    if r["status"] == "processed":
        print(json.dumps(r, ensure_ascii=False, indent=1))
        break
    time.sleep(0.4)
