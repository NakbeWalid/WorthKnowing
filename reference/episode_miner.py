import sys, json, pandas as pd, numpy as np
"""Reference episode miner. Usage: python episode_miner.py <dir with CSVs> <output.json>"""
D=sys.argv[1]; OUT=sys.argv[2]
p=pd.read_csv(f"{D}/prices_daily.csv",parse_dates=["date"])
a=pd.read_csv(f"{D}/assets_universe.csv").set_index("ticker")
m=pd.read_csv(f"{D}/macro_rates.csv",parse_dates=["date"])
px=p.pivot(index="date",columns="ticker",values="adj_close")
# macro point-in-time: monthly series lagged 45 days (conservative publication lag)
LAG={"STATIC_TOTALCPICHANGE":45,"CPIAUCSL":45,"UNRATE":35}
mm=m.copy(); mm["avail"]=mm.apply(lambda r: r.date+pd.Timedelta(days=LAG.get(r.series_id,0)),axis=1)
KEYS=["V39079","DFF","BD.CDN.10YR.DQ.YLD","DGS10","STATIC_TOTALCPICHANGE","UNRATE"]
def macro_at(d):
    out={}
    for k in KEYS:
        s=mm[(mm.series_id==k)&(mm.avail<=d)].sort_values("date")
        if len(s): out[k]=round(float(s.value.iloc[-1]),2)
    return out
WIN=190; STEP=21
eps=[]
for t in px.columns:
    s=px[t].dropna()
    if t.endswith("-USD"): s=s[s.index.dayofweek<5]  # weekdays only for comparability
    idx=s.index; n=len(idx)
    cands=[]
    for i in range(0,n-WIN,10):
        w=s.iloc[i:i+WIN+1]; r=w/w.iloc[0]
        dd=(r/r.cummax()-1); mdd=dd.min(); fin=r.iloc[-1]-1
        peak=r.max()-1; trough_after_peak=None
        dly=w.pct_change().dropna(); mx=dly.abs().max()
        low=r.min()-1
        # classify
        typ=None
        if mdd<=-0.30 and fin<=-0.15: typ="crash_no_recovery"
        elif low<=-0.25 and fin>=0.0: typ="drop_then_recovery"
        elif peak>=0.60 and fin>=0.40: typ="parabolic_rally"
        elif peak>=0.50 and (r.max()-r.iloc[-1])/r.max()>=0.25: typ="rally_then_reversal"
        elif mx>=0.12: typ="single_day_shock"
        elif abs(fin)<=0.06 and mdd>=-0.10: typ="calm_sideways"
        elif fin>=0.15 and mdd>=-0.10: typ="steady_climb"
        if typ: cands.append((typ,i,mdd,fin,peak,mx))
    # greedy non-overlapping selection: best 2 per type per asset
    used=[]; byt={}
    score=lambda c: abs(c[2])+abs(c[3])+c[4]
    for c in sorted(cands,key=lambda c:-score(c)):
        if byt.get(c[0],0)>=1: continue
        if any(abs(c[1]-u)<WIN for u in used): continue
        used.append(c[1]); byt[c[0]]=byt.get(c[0],0)+1
        typ,i,mdd,fin,peak,mx=c
        w=s.iloc[i:i+WIN+1]
        # monthly checkpoints
        pos=list(range(0,len(w),STEP)); 
        if pos[-1]!=len(w)-1:
            if (len(w)-1)-pos[-1] < STEP//2: pos[-1]=len(w)-1
            else: pos.append(len(w)-1)
        cps=[]
        for k,j in enumerate(pos):
            d=w.index[j]; v=float(w.iloc[j]/w.iloc[0]*100)
            run=w.iloc[:j+1]; dd_now=float(w.iloc[j]/run.max()-1)
            cps.append({"step":k,"date":str(d.date()),"index":round(v,2),"ret_since_start_pct":round(v-100,1),"drawdown_from_peak_pct":round(dd_now*100,1),"macro":macro_at(d)})
        # after-window outcome (12 months later if exists)
        after=s.iloc[i+WIN:i+WIN+252]
        aft=None
        if len(after)>=60: aft=round(float(after.iloc[-1]/w.iloc[-1]-1)*100,1)
        r=w/w.iloc[0]; dly=w.pct_change().dropna()
        eps.append({"episode_id":f"EP-{t.replace('.','').replace('-','')}-{typ}-{str(w.index[0].date())}",
          "type":typ,"ticker_truth":t,"name_truth":a.loc[t,"name"],"asset_class":a.loc[t,"asset_class"],"sector":a.loc[t,"sector"],"currency":a.loc[t,"currency"],
          "start":str(w.index[0].date()),"end":str(w.index[-1].date()),"n_checkpoints":len(cps),
          "stats":{"total_return_pct":round(fin*100,1),"max_drawdown_pct":round(mdd*100,1),"peak_gain_pct":round(peak*100,1),"worst_day_pct":round(float(dly.min())*100,1),"best_day_pct":round(float(dly.max())*100,1),"ann_vol_pct":round(float(dly.std()*np.sqrt(252))*100,1),"after_window_12m_return_pct":aft},
          "checkpoints":cps})
json.dump(eps,open(OUT,"w"),ensure_ascii=False,indent=1)
df=pd.DataFrame([{"type":e["type"],"t":e["ticker_truth"],"start":e["start"],"ret":e["stats"]["total_return_pct"],"mdd":e["stats"]["max_drawdown_pct"],"peak":e["stats"]["peak_gain_pct"]} for e in eps])
print(len(eps),"episodes"); print(df.type.value_counts().to_string()); print(df.t.nunique(),"assets covered")
print(df.sort_values(["type","mdd"]).to_string(index=False))
