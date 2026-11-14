# MASTER PROMPT: "AlphaForge Persona™" — Next-Gen Agentic Behavioral Twin & Pre-Trade Friction SDK for Banking

> **Target LLM**: Claude 3.5 Sonnet / GPT-4o / Cursor / Windsurf / Copilot  
> **Mission**: Build a fully working, production-grade, responsive Web & Mobile FinTech application in a single unified codebase.  
> **Hackathon**: PolyFinances Datathon 2026 (Sponsored by National Bank of Canada & AWS).  
> **Output Standard**: Zero placeholders, zero "TODOs", zero broken links. Fully functional interactive state, realistic financial dataset integration, animated charts, rich agentic explainability traces, and flawless UI/UX.

---

```markdown
# SYSTEM & EXECUTION PROMPT: BUILD "AlphaForge Persona™" FULL-STACK APPLICATION

You are an elite FinTech Lead Architect, Principal Full-Stack Engineer, and Behavioral Economics specialist. You are tasked with generating the complete, fully operable, production-ready codebase for **AlphaForge Persona™** (Banque Nationale × AWS AlphaForge Challenge 2026).

## 1. PROJECT EXECUTIVE SUMMARY & VALUE PROPOSITION
Most algorithmic investment tools attempt market price prediction, which fails under high volatility and violates the hackathon's core guidance ("The challenge does not ask teams to predict future returns from past performance"). 
**AlphaForge Persona™ flips the paradigm**: 
It is a **Plug-and-Play B2B2C Behavioral Intelligence & Pre-Trade Friction SDK** embedded directly into retail banking apps (e.g., National Bank of Canada / BNC). It solves the multi-billion dollar problem of retail investor capitulation, irrational panic-selling, and hype/FOMO chasing.

### The Core Capabilities:
1. **60-Second Frictionless Calibration**: Replaces tedious 40-page suitability questionnaires with 6 intuitive perception sliders and 3 micro-scenario dilemma simulations.
2. **Perception vs. Reality Gap Radar**: Contrasts how the user *thinks* they invest vs. how they *actually* behave in market shocks.
3. **Alternative Data Enrichment**: Ingests professional background (CV / LinkedIn), social hype sensitivity (X / Reddit / News sentiment), and historical trade logs.
4. **Self-Imposed Behavioral Guardrails**: Users define their own commitment contracts (e.g., "Warn me if I buy when an asset is up >25% in 48h", "Enforce 5-minute cooling off on sell-offs >10%").
5. **Real-Time Pre-Trade Interceptor (The "Wow" Feature)**: When the user stages a trade in the banking UI, the SDK runs multi-agent Bedrock evaluations against real-time news, macro rates (Bank of Canada / FRED), and user rules. It displays an explainable advisory nudge with behavioral warnings **without blocking user sovereignty**.
6. **Dynamic Derivation Factor ($\mathcal{D}(t)$)**: Mathematically tracks profile drift when users repeatedly bypass their self-imposed rules or react to market news.
7. **National Bank Institutional Cockpit (B2B)**: Telemetry dashboard giving wealth managers and compliance officers real-time visibility into client behavioral health, systemic panic risk, and ESG dissonance.
8. **Native Alignment with Challenge Personas**: Pre-configured, instant one-click switching between **Amira** (High Risk / Crypto / Diversification), **Mateo** (Moderate / ESG / Family), and **Robert** (Low-Moderate / Retirement / Hype Temptation).

---

## 2. TECHNOLOGY STACK SPECIFICATION
Build the complete application as a **Next.js 14+ (App Router)** Single-Page Application (SPA) or standalone full-stack repository with:
- **Framework**: Next.js 14 (TypeScript, React 18/19, App Router, Server & Client Components)
- **Styling**: Tailwind CSS with custom FinTech design tokens (BNC Red `#E01A22`, Obsidian Dark `#0B0F17`, Slate `#1E293B`, Neon Cyan `#06B6D4`, Emerald `#10B981`, Amber `#F59E0B`, Rose `#F43F5E`)
- **UI Components & Primitives**: Lucide-React icons, Radix UI primitives (Dialog, Slider, Tabs, Tooltip, Switch, Accordion, Progress), Tailwind Variants
- **Data Visualization**: Recharts (RadarChart, ResponsiveContainer, LineChart, AreaChart, BarChart, Tooltip, Legend)
- **Animation**: Framer Motion (smooth state transitions, modal emergence, gauge sweeps)
- **State Management**: React Context / Zustand with persistent local storage caching for active persona profiles, trade history, and derivation factor logs.
- **Embedded Simulation Engine**: Built-in deterministic historical market data engine covering the 31 assets of the official starter set (RY.TO, TD.TO, SHOP.TO, AAPL, NVDA, TSLA, SPY, QQQ, BTC-USD, ETH-USD, Bond ETFs, ESG ETFs) from 2021 to 2026.

---

## 3. MATHEMATICAL & AGENTIC ARCHITECTURAL FORMULATION

### 3.1 The Behavioral Derivation Factor $\mathcal{D}(t)$
Each investor starts with a baseline vector $\vec{P}_0 \in [0, 1]^6$ representing:
1. $r$: Risk Tolerance
2. $h$: Hype / FOMO Susceptibility
3. $p$: Panic / Loss Aversion
4. $i$: Impulsivity vs Patience
5. $e$: ESG / Ethical Rigor
6. $d$: Diversification Discipline

For each transaction $k$ executed at timestamp $t_k$ with asset $A_k$, volatility $\sigma_k$, 48h price momentum $M_k$, ESG controversy score $C_k$, and portfolio weight change $\Delta w_k$:
$$\vec{P}_{actual}(t_k) = f(A_k, M_k, C_k, \Delta w_k, \Delta t_{since\_news})$$

The instantaneous behavioral drift is calculated as:
$$\delta_k = \|\vec{P}_{actual}(t_k) - \vec{P}_0\|_{W} = \sqrt{\sum_{j=1}^6 w_j (P_{actual, j} - P_{0, j})^2}$$

The cumulative **Derivation Factor** $\mathcal{D}(t) \in [0, 100]$ evolves via an exponentially weighted moving average:
$$\mathcal{D}(t_k) = \alpha \cdot \mathcal{D}(t_{k-1}) + (1 - \alpha) \cdot (100 \cdot \delta_k) + \Omega_{override}$$
Where:
- $\alpha = 0.85$ (memory persistence factor)
- $\Omega_{override} = +5.0$ if the user voluntarily bypassed a self-set guardrail warning.

### 3.2 Multi-Agent Orchestration Flow (AWS Bedrock Agents Emulation)
The app must cleanly demonstrate the 4 coordinating agents:
1. **Profiler Agent**: Ingests onboarding sliders, micro-dilemmas, and CV/LinkedIn uploads. Constructs the baseline behavioral twin.
2. **Macro & Sentiment Agent**: Analyzes the asset's current state: 48h news sentiment, social media velocity, Bank of Canada policy rate context, and ESG controversy flags.
3. **Guardrail Governance Agent**: Checks trade proposals against user-set rules and portfolio limits. Flags cognitive dissonance (e.g. Robert FOMOing into high-beta tech).
4. **Explainability & Audit Agent**: Synthesizes the decision trace with exact data source citations, observable facts, assumption disclaimers, and responsible boundary notices.

---

## 4. APPLICATION STRUCTURE & REQUIRED PAGES/VIEWS

The application must provide a sleek **Top Navigation Header** with:
- **Logo & Challenge Title**: "Banque Nationale × AlphaForge AI"
- **Persona Quick-Switcher**: Instant switch buttons for `[ Amira (Tech/High Risk) ]`, `[ Mateo (ESG/Balanced) ]`, `[ Robert (Preservation/FOMO Risk) ]`, plus `[ + Custom Profile ]`.
- **View Selector Tabs**:
  1. `📱 Banking App & Pre-Trade Interceptor` (The user-facing retail mobile/desktop simulation)
  2. `🧠 Behavioral Twin Calibration` (Sliders, micro-simulations, CV/Social parser, Radar Gap)
  3. `🛡️ Commitment Guardrails` (User-defined friction rules & trigger history)
  4. `🏛️ B2B Institutional Cockpit` (National Bank Wealth Advisor & Compliance View)
  5. `📜 Agentic Explainability Trace` (Live step-by-step reasoning logs & data citations)
- **Device Viewport Toggle**: Switch between **Desktop View** and an **iPhone 16 Pro Frame Mockup** for authentic mobile banking demo feel.

---

## 5. DETAILED VIEW SPECIFICATIONS

### View 1: Retail Banking App & Pre-Trade Interceptor (The Hero Demonstration)
- **Account Summary Card**: Shows Chequing ($14,250), TFSA/CELI Portfolio ($88,400), RRSP/REER ($142,000), total net worth, 24h P&L.
- **Current Portfolio Breakdown**: Pie/Bar chart showing current asset allocation.
- **Trade Execution Terminal**:
  - Asset Selector: Dropdown of 31 starter assets (e.g., `NVDA`, `SHOP.TO`, `RY.TO`, `BTC-USD`, `XBB.TO`, `TSLA`, `ESG ETF`).
  - Order Type: Market / Limit.
  - Action: Buy / Sell.
  - Amount ($ CAD / USD) and Shares input.
  - Real-time ticker chart snippet (price trend + 48h change indicator).
  - Button: `[ Stage & Review Order ]` -> **Triggers the Pre-Trade Agentic Interceptor Modal**.

#### The Pre-Trade Agentic Interceptor Modal (The Showstopper):
When clicked, instead of blindly placing the trade, the SDK intercepts:
1. **Radar Scan Animation**: "Evaluating trade against Investor Behavioral Twin & Market Sentiment..."
2. **Decision Status Badge**:
   - `🟢 ALIGNED`: Trade matches profile and respects all rules.
   - `🟡 CAUTION / BEHAVIORAL NUDGE`: Detected emotional impulse, FOMO, or portfolio imbalance.
   - `🔴 RULE BREACH DETECTED`: Direct violation of user's self-imposed guardrail.
3. **The 3 Key Analytical Cards**:
   - **Card A: Cognitive Bias Detected**: Names the bias (e.g., *"Hype Chasing / FOMO"*, *"Panic Liquidation"*, *"Over-Concentration"*). Shows a comparison metric (e.g. "Asset is up +32% in 48h; your historical trades at peak RSI resulted in -14% return").
   - **Card B: Market & News Context (Macro Agent)**: Correlates trade with recent headline (e.g., *"Headline: Tech rally accelerates on semiconductor earnings hype; Bank of Canada holds overnight rate at 3.75%"*). Cites source: `Reuters / Financial Post / SEDAR+`.
   - **Card C: Your Self-Imposed Rule Conflict**: Highlights the exact rule the user created (e.g., *"Rule #2: Do not buy tech assets when allocation exceeds 35% of total wealth. This trade pushes you to 54%"*).
4. **Projected Derivation Factor Impact**: Shows a gauge changing: e.g., "Current Derivation Factor: 14% -> Projected: 28% (+14% drift)".
5. **Autonomy Actions (Zero Dark Patterns)**:
   - Button 1: `[ 🛡️ Step Back & Keep Rule (Cancel) ]` (Reinforces positive discipline, logs self-control win).
   - Button 2: `[ ⚡ Proceed Anyway (Acknowledge Warning) ]` (Executes trade, increments Derivation Factor, records behavioral audit trail).

---

### View 2: Behavioral Twin Calibration (Rapid 60-Second Onboarding)
- **Section A: Self-Perception Sliders (6 intuitive controls with real-time feedback label)**:
  1. Risk Appetite: `Conservative (1)` to `Degen/Aggressive (10)`
  2. Social & Hype Influence: `Contrarian (1)` to `Trend Chaser (10)`
  3. Market Panic Response: `Ice Cold (1)` to `Immediate Sell (10)`
  4. Trading Patience: `Long-Term DCA (1)` to `Day Trader (10)`
  5. ESG & Ethical Rigor: `Profits Only (1)` to `Zero Controversy (10)`
  6. Asset Diversification: `All-in Best Idea (1)` to `Strict Multi-Asset (10)`
- **Section B: 3 Interactive Dilemma Micro-Simulations**:
  - *Dilemma 1 (Panic Test)*: "Your primary holding drops 22% in 3 days following an unexpected earnings miss. Market sentiment is terrified. What do you do?"
    - Options: `A) Sell entire position immediately to preserve remaining capital`, `B) Do nothing, review fundamentals over the weekend`, `C) Double down and buy the dip aggressively`.
  - *Dilemma 2 (Hype/FOMO Test)*: "A decentralized AI crypto token gains 400% in a week. All major social feeds and your friends are celebrating huge gains. What is your reaction?"
    - Options: `A) Ignore completely, stick to broad-market index funds`, `B) Allocate 1-2% speculative play money just in case`, `C) Liquidate conservative bonds to take a significant position`.
  - *Dilemma 3 (ESG/Values Conflict)*: "An oil pipeline company offers a guaranteed 9.5% dividend yield, but is currently embroiled in an environmental protest and indigenous rights dispute. Do you invest?"
    - Options: `A) Yes, return and yield are the only metrics that matter`, `B) Only if they have a clear transition roadmap`, `C) Absolute exclusion; violates core principles`.
- **Section C: Alternative Data Parser (Simulated File Drop / Social Connector)**:
  - Drag-and-drop simulated CV / Resume upload: Parses job title, sector familiarity (e.g. Amira = Software Engineer -> high tech domain bias), tenure, income predictability.
  - Social Handle Ingestion (X/Twitter, LinkedIn): Analyzes follow lists, frequent tags (`#crypto`, `#cleantech`, `#dividend`), and sentiment score.
- **Section D: Perception vs. Reality Radar Chart (The "Aha!" Moment)**:
  - Dual-polygon Radar Chart:
    - **Blue Outline**: "What You Think You Are" (Based on Self Sliders).
    - **Crimson Filled**: "How You Acted in Simulations" (Evaluated Behavioral Reality).
  - Callout box identifying the **Cognitive Blind Spot** (e.g. *"You rated your Panic Tolerance as 8/10 (High), but in Dilemma 1 you panic-sold at a 22% drop. Actual Loss Tolerance: 3/10"*).

---

### View 3: Commitment Guardrails & Self-Set Rules
- **Rule Builder Interface**:
  - Trigger Condition: `[ When Stock Rises > X% in 24h ]`, `[ When Portfolio Tech Weight > Y% ]`, `[ When Asset has Severe ESG Controversy ]`, `[ When Selling at > Z% Loss ]`.
  - Action Nudge: `[ Require 5-min Cooling Timer ]`, `[ Display Alternative ESG Assets ]`, `[ Show Lifetime Regret Metric ]`, `[ Require Confirmation Checkbox ]`.
- **Active Rules List**: Pre-populated with persona-specific guardrails:
  - **Amira's Guardrail**: "Alert me if non-tech diversification drops below 30%."
  - **Mateo's Guardrail**: "Block/warn on any company with MSCI ESG Rating < BBB or ongoing fossil fuel exploration."
  - **Robert's Guardrail**: "Cooling-off alert if purchasing any asset with 7-day social mention surge > 150%."
- **Rule Enforcement Log**: Table showing dates, assets, triggered rules, and whether the user respected or bypassed the nudge.

---

### View 4: B2B Institutional Cockpit (National Bank Wealth & Compliance View)
- **Advisor Overview Header**: "Banque Nationale du Canada — Behavioral Telemetry & Suitability Hub".
- **Client Risk & Health Grid**:
  - Live metric cards: Average Client Derivation Factor (19.4%), High-Churn Risk Investors (12%), Emotionally Distressed Accounts (34 flagged), Total Capital Protected from Panic ($4.2M).
- **Persona Comparative Benchmarking Matrix**:
  - Side-by-side comparative table showing Amira vs. Mateo vs. Robert across Derivation Factor, Panic Risk, ESG Alignment, and Over-Concentration Risk.
- **Systemic Trend Feed**:
  - Shows incoming market shocks (e.g., "Tech sector correction -4.2%") and how many clients are triggering panic guardrails in real time.
- **Compliance Suitability Export**:
  - Single-click `[ Generate BNC Compliance Audit Report (PDF/JSON) ]` confirming adherence to National Bank regulatory suitability guidelines without imposing fiduciary liability.

---

### View 5: Explainability & Agentic Trace Architecture
- **Observable Step-by-Step Thought Log**:
  - Renders the exact execution trace of the Bedrock Multi-Agent pipeline:
    - `Step 1: Input Received` -> `{ User: Robert, Ticker: TSLA, Action: BUY, Value: $25,000 CAD }`
    - `Step 2: Data Retrieved` -> Cites `prices_daily.csv`, `macro_rates.csv` (Bank of Canada 5-year rate), RSS news feeds.
    - `Step 3: Guardrail Agent Evaluation` -> Matches against Rule #3 ("Hype prevention"). Rule breached: Beta is 2.3x higher than portfolio average.
    - `Step 4: Sentiment & Hype Analysis` -> Social volume +180% over 7-day rolling median.
    - `Step 5: Output Synthesis` -> Generates explainable nudge, computes $\Delta \mathcal{D} = +8.4$.
- **Responsible Boundaries Disclaimer Box**:
  - Prominent box highlighting: "Simulation Only. No real financial execution. No personalized investment advice. Distinguishes verifiable facts from assumptions. Conforms to PolyFinances Datathon 2026 ethics mandate."

---

## 6. PRE-CONFIGURED PERSONAS DATA SPECIFICATION

You must include the 3 official hackathon personas as instant-load fixtures:

### Persona 1: AMIRA
- **Age**: 26 | **Occupation**: Software Engineer | **Horizon**: 15+ years | **Declared Risk**: High
- **Portfolio**: $75,000 (ETH-USD: 25%, BTC-USD: 20%, NVDA: 25%, SHOP.TO: 15%, Cash: 15%)
- **Tension to Demonstrate**: Wants high-growth and crypto, but *wants diversification* and should NOT be treated as "anything goes".
- **Demo Interceptor Scenario**: Amira attempts to buy another $15,000 of NVDA or a speculative crypto asset. The system intervenes: "Your tech/crypto concentration is already 85%. While your risk tolerance is High, this violates your own rule to maintain 15%+ multi-asset diversification. Suggested re-allocation: Canadian Equity ETF (XIU.TO) or Clean Energy."

### Persona 2: MATEO
- **Age**: 41 | **Occupation**: Operations Manager | **Family**: Partner + 2 children | **Horizon**: 8-12 years | **Declared Risk**: Moderate
- **Portfolio**: $210,000 (Balanced Equity ETFs: 40%, Canadian Banks: 30%, Bond ETFs: 20%, Cash: 10%)
- **Tension to Demonstrate**: Balances growth with strict ESG standards and family stability.
- **Demo Interceptor Scenario**: Mateo is presented with a high-dividend opportunity in an oil sands stock (e.g. CNQ.TO or ENB.TO). The interceptor alerts: "High dividend yield (6.8%), but severe ESG controversy score (Tier 4 environmental impact). Violates Mateo's self-imposed ethical exclusion rule. Alternative suggestion: ESG-screened global ETF."

### Persona 3: ROBERT
- **Age**: 59 | **Occupation**: Healthcare Specialist | **Horizon**: 3-5 years (Near Retirement) | **Declared Risk**: Low to Moderate
- **Portfolio**: $580,000 (Fixed Income/Bond ETFs: 50%, High-Quality Dividend Equities: 35%, Cash & GICs: 15%)
- **Tension to Demonstrate**: Seeking capital preservation, but gets tempted by a highly publicized viral/hyped opportunity.
- **Demo Interceptor Scenario**: Robert attempts to allocate $30,000 to TSLA or high-flying tech after seeing news headlines. The system gently challenges him: "Robert, your target retirement date is in 3.5 years. This asset has an annualized volatility of 54% (3.2x higher than your portfolio). In a 2022-style drawdown, this position could experience a 45% drop, delaying your retirement by 18 months. Are you sure you want to bypass your Capital Preservation Rule?"

---

## 7. CODE IMPLEMENTATION REQUIREMENTS

1. **Self-Contained & Complete**: Write the full code across clean, modular files. Provide all code for the React components, styling, state hooks, and calculation engines.
2. **Interactive State Everywhere**: Every slider must immediately update the radar chart. Every persona switch must reload the portfolio, past trades, active rules, and risk metrics. Every trade simulation must trigger the actual interceptor modal with dynamic calculation.
3. **Flawless Design Tokens**:
   - Dark theme default with subtle gradients (`bg-slate-950`, `border-slate-800`).
   - National Bank brand red accents (`#E01A22` / `bg-red-600`) balanced with modern emerald and cyan data indicators.
   - Glassmorphism cards (`backdrop-blur-md bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl`).
   - Smooth hover states, glowing indicators, badge pills, and responsive layout.
4. **Export Readiness**: Include all mock datasets inline (the 31 assets with sectors, betas, ESG ratings, and 5-year price returns from 2021-2026) so the application runs immediately without requiring an external database setup.

Produce the code now. Make it exceptional.
```
