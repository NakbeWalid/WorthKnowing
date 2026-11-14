"""Génère les jeux de données FICTIFS de la démonstration (graine fixe, reproductible).

    python scripts/generate_synthetic_social.py

Sorties :
  data/demo/social_synthetic.json  comptes liés fictifs des personas (publications, interactions)
  data/demo/news_demo.json         titres de nouvelles fictifs, datés, étiquetés

Aucun compte réel n'est lu. Les auteurs n'existent pas. Les moments sont placés autour de
mouvements RÉELS du jeu de données (ex. forte baisse et pic de volume de NVDA début novembre 2026)
pour créer des cas « à cause connue » qui servent à valider l'enquête automatique.
"""
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "demo"
rng = random.Random(2026)
T = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")

INFLUENCEURS = ["@LeoFinances", "@MarieAnalyse", "@NadiaInvestit", "@SamCroissance"]
PROCHES = ["Karim (cousin)", "Sophie (collègue)", "Julien (ami)"]
BRUIT = [("Cinq habitudes pour mieux épargner cette année.", []), ("Retour sur ma semaine : rien à signaler.", []),
         ("Les banques canadiennes publient bientôt leurs résultats.", ["RY.TO", "TD.TO"]),
         ("L'or reste un refuge pour certains investisseurs.", ["GLD"]),
         ("Photo de vacances, aucun rapport avec la bourse.", [])]


def post(pid, platform, account, typ, when, text, symbols, engagement, interaction=None):
    return {"id": pid, "platform": platform, "account": account, "account_type": typ, "followed": True,
            "published_at": iso(when), "text": text, "symbols": symbols, "engagement": engagement,
            "user_interaction": interaction, "etiquette": "Fictif"}


def noise(prefix, start, days):
    rows = []
    for i in range(days * 2):
        text, syms = rng.choice(BRUIT)
        when = start + timedelta(hours=rng.randint(0, days * 24))
        rows.append(post(f"{prefix}-b{i}", rng.choice(["instagram", "linkedin"]), rng.choice(INFLUENCEURS), "influenceur",
                         when, text, syms, round(rng.uniform(0.1, 0.5), 2)))
    return rows


def build():
    base = T("2026-11-02T12:00:00")
    robert = noise("rob", base, 10) + [
        # Cas à cause connue : publications très partagées sur NVDA quelques heures avant le trade de démo (2026-11-10 19:30 UTC).
        post("rob-1", "instagram", "@LeoFinances", "influenceur", T("2026-11-10T16:45:00"),
             "NVDA a chuté, tout le monde en parle : je rachète massivement aujourd'hui.", ["NVDA"], 0.95, "j'aime"),
        post("rob-2", "instagram", "@MarieAnalyse", "influenceur", T("2026-11-10T13:10:00"),
             "Occasion de la décennie sur NVDA selon moi. À vous de voir.", ["NVDA"], 0.80),
        post("rob-3", "linkedin", "Julien (ami)", "proche", T("2026-11-09T21:00:00"),
             "J'ai repris du NVDA ce matin, impossible de rater ça.", ["NVDA"], 0.40),
    ]
    amira = noise("ami", base, 10) + [
        post("ami-1", "instagram", "@SamCroissance", "influenceur", T("2026-11-11T14:20:00"),
             "Le Bitcoin va repartir, j'en remets une couche ce soir.", ["BTC-USD"], 0.85, "commentaire"),
        post("ami-2", "instagram", "@NadiaInvestit", "influenceur", T("2026-11-10T15:00:00"),
             "Je vends mes NVDA, la baisse ne fait que commencer.", ["NVDA"], 0.70),
    ]
    mateo = noise("mat", base, 10) + [
        post("mat-1", "linkedin", "Sophie (collègue)", "proche", T("2026-11-11T12:30:00"),
             "Le pétrole rapporte gros en ce moment, j'ai pris du XOM.", ["XOM"], 0.50),
    ]
    social = {"robert": robert, "amira": amira, "mateo": mateo, "default": noise("def", base, 10)}
    news = [
        {"id": "n-1", "published_at": "2026-11-10T12:05:00Z", "source": "Fil de démonstration (fictif)",
         "title": "Les titres liés à l'intelligence artificielle reculent fortement cette semaine", "symbols": ["NVDA"],
         "sector": "Information Technology", "importance": 0.8, "url": None, "etiquette": "Fictif (démonstration)"},
        {"id": "n-2", "published_at": "2026-11-09T14:00:00Z", "source": "Fil de démonstration (fictif)",
         "title": "Les marchés attendent la prochaine décision de taux", "symbols": [], "theme": "macro",
         "importance": 0.5, "url": None, "etiquette": "Fictif (démonstration)"},
        {"id": "n-3", "published_at": "2026-11-11T13:00:00Z", "source": "Fil de démonstration (fictif)",
         "title": "Le secteur de l'énergie poursuit sa progression", "symbols": [], "sector": "Energy",
         "importance": 0.6, "url": None, "etiquette": "Fictif (démonstration)"},
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "social_synthetic.json").write_text(json.dumps(social, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "news_demo.json").write_text(json.dumps(news, ensure_ascii=False, indent=1), encoding="utf-8")
    print("écrit :", OUT / "social_synthetic.json", "et", OUT / "news_demo.json")


if __name__ == "__main__":
    build()
