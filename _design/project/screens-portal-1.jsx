/* global React, Chip, Wordmark, Suit, Laurel, Icon, MembershipCard, TimeWallet, Row */
const { useState: useS7, useEffect: useE7 } = React;

// Portal Shell — sidebar nav for member portal
const PortalShell = ({ current, onNav, children }) => (
  <div style={{ display: "flex", minHeight: "100vh", background: "var(--ink-900)" }}>
    <aside style={{
      width: 248, flexShrink: 0,
      background: "var(--ink-850)",
      borderRight: "1px solid var(--border-faint)",
      padding: "24px 16px",
      display: "flex", flexDirection: "column",
      position: "sticky", top: 0, height: "100vh",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 24px", borderBottom: "1px solid var(--border-faint)", marginBottom: 20 }}>
        <Chip size={32}/>
        <Wordmark size="sm" showSubtitle={true}/>
      </div>
      <div className="eyebrow" style={{ fontSize: 10, padding: "0 8px", marginBottom: 8 }}>Portal</div>
      {[
        { id: "dashboard", label: "Dashboard", icon: "layers" },
        { id: "buytime", label: "Buy Time", icon: "clock" },
        { id: "billing", label: "Billing", icon: "creditCard" },
        { id: "activity", label: "Activity", icon: "activity" },
        { id: "profile", label: "Profile", icon: "user" },
      ].map(item => (
        <a key={item.id} onClick={() => onNav(item.id)} style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 12px", borderRadius: 6, cursor: "pointer",
          color: current === item.id ? "var(--gold-200)" : "var(--ivory-300)",
          background: current === item.id ? "rgba(201, 162, 74, 0.08)" : "transparent",
          fontSize: 14, fontWeight: 500,
          marginBottom: 2,
          borderLeft: current === item.id ? "2px solid var(--gold-400)" : "2px solid transparent",
          transition: "all 180ms var(--ease)",
        }}>
          <Icon name={item.icon} size={16}/>
          {item.label}
        </a>
      ))}
      <div style={{ flex: 1 }}/>
      <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 4 }}>
        <a onClick={() => onNav("home")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}>
          <Icon name="logout" size={14}/> Sign out
        </a>
        <a onClick={() => onNav("admin")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", color: "var(--text-dim)", fontSize: 11, cursor: "pointer", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          <Icon name="shield" size={12}/> Admin
        </a>
      </div>
    </aside>
    <main style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        height: 64, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid var(--border-faint)", background: "var(--ink-850)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-muted)", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          <span>Members Portal</span>
          <span>/</span>
          <span style={{ color: "var(--gold-300)" }}>{current}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="pill pill-live">In Room · Seat 4 · T7</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--gold-grad)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Cormorant Garamond, serif", color: "#0B0B0B", fontWeight: 600 }}>MH</div>
            <div style={{ fontSize: 13 }}>Marcus H.</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "32px" }}>{children}</div>
    </main>
  </div>
);

// DASHBOARD
const DashboardScreen = ({ onNav }) => {
  const [flipped, setFlipped] = useS7(false);
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Welcome back</div>
        <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 44, lineHeight: 1.1 }}>Good evening, <em className="gold-text" style={{ fontStyle: "italic" }}>Marcus</em>.</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>Friday, April 12 · The room opens in 12 minutes.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24, marginBottom: 24 }}>
        {/* Membership card */}
        <div className="card card-bordered" style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse at center, #1A1816 0%, #0B0B0B 80%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "baseline", marginBottom: 24 }}>
            <div>
              <div className="eyebrow" style={{ fontSize: 11 }}>Membership Card</div>
              <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>Tap to flip · Show at the door</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setFlipped(!flipped)}><Icon name="refresh" size={12}/> Flip</button>
          </div>
          <MembershipCard flipped={flipped} onFlip={setFlipped} name="Marcus W. Holloway" memberNo="00347" joinDate="MMXXIV" tier="Founding Member"/>
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            <button className="btn btn-sm"><Icon name="download" size={12}/> Apple Wallet</button>
            <button className="btn btn-sm"><Icon name="barcode" size={12}/> PokerAtlas</button>
          </div>
        </div>

        <TimeWallet minutesRemaining={412} totalPrepaid={1500} ticking={true}/>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Next Bill", val: "Apr 24", sub: "$25 · autopay" },
          { label: "This Month", val: "18h 42m", sub: "of seat-time" },
          { label: "Lifetime Hours", val: "247", sub: "since join" },
          { label: "Sessions", val: "63", sub: "all-time" },
        ].map((s, i) => (
          <div key={i} className="card card-bordered" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>{s.label}</div>
            <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, fontWeight: 600, lineHeight: 1 }}>{s.val}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent sessions + tonight */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
        <div className="card card-bordered" style={{ padding: 0 }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-faint)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22 }}>Recent Sessions</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => onNav("activity")}>View all <Icon name="arrowRight" size={12}/></button>
          </div>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Game</th><th>Hours</th><th>Cost</th><th>Result</th></tr></thead>
            <tbody>
              {[
                ["Apr 11", "$2/$5 NL · T3", "4h 18m", "$51.60", "+$420"],
                ["Apr 9", "Tuesday Bounty", "5h 02m", "$60.40", "+$185 · 2 KOs"],
                ["Apr 6", "$1/$2 NL · T7", "3h 44m", "$44.80", "−$180"],
                ["Apr 4", "$2/$5 PLO · T9", "2h 50m", "$34.00", "+$760"],
                ["Apr 2", "$1/$2 NL · T8", "2h 12m", "$26.40", "Even"],
              ].map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--text-muted)" }}>{r[0]}</td>
                  <td>{r[1]}</td>
                  <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>{r[2]}</td>
                  <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--text-muted)" }}>{r[3]}</td>
                  <td style={{ color: r[4].startsWith("+") ? "#8FBE8F" : r[4].startsWith("−") ? "var(--crimson-light)" : "var(--text-muted)", fontSize: 13 }}>{r[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card card-bordered">
          <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, marginBottom: 16 }}>Tonight on the Floor</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              ["$2/$5 NL", "T3 · 1 seat", "open"],
              ["$1/$2 NL", "T7 · waitlist", "wait"],
              ["Friday Bounty", "7:00 PM · 32 reg", "tourney"],
              ["$2/$5 PLO", "T9 · forming", "form"],
            ].map((g, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 6, background: "var(--ink-850)", border: "1px solid var(--border-faint)" }}>
                <div>
                  <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 16, color: "var(--gold-300)" }}>{g[0]}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{g[1]}</div>
                </div>
                <button className="btn btn-sm btn-ghost">Add Me</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// BUY TIME
const BuyTimeScreen = ({ onNav }) => {
  const [pack, setPack] = useS7("hero");
  const [custom, setCustom] = useS7(100);
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Top Up</div>
        <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 44 }}>Buy Time</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>Current balance: <span style={{ color: "var(--gold-300)" }}>6h 52m</span> · Burns at $12/hr</p>
      </div>

      {/* Hero pack */}
      <div className="card" style={{ background: "linear-gradient(160deg, #1F1A12, #0E0D0B)", border: pack === "hero" ? "1px solid var(--gold-400)" : "1px solid var(--border)", padding: 0, overflow: "hidden", marginBottom: 24, cursor: "pointer", boxShadow: pack === "hero" ? "var(--gold-glow-soft)" : "none" }} onClick={() => setPack("hero")}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center" }}>
          <div style={{ padding: 40, position: "relative" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <span className="pill" style={{ background: "var(--gold-grad)", color: "#0B0B0B", border: "none" }}>Most Popular</span>
              <span className="pill">33% Bonus</span>
            </div>
            <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 40, marginBottom: 12 }}>The Time Pack</h2>
            <p style={{ color: "var(--ivory-300)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>Pay $200, get $300 of credit. Roughly 25 hours of seat-time. Members brag about this one.</p>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 10 }}>Pay</div>
                <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 56, fontWeight: 600, lineHeight: 1 }}>$200</div>
              </div>
              <Icon name="arrowRight" size={22} color="#C9A24A"/>
              <div>
                <div className="eyebrow" style={{ fontSize: 10 }}>Get</div>
                <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 56, fontWeight: 600, lineHeight: 1 }}>$300</div>
              </div>
            </div>
          </div>
          <div style={{ position: "relative", padding: 40, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              {/* Stack of chips visual */}
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ position: i === 0 ? "relative" : "absolute", left: 0, top: -i * 10, zIndex: 5 - i, opacity: 1 - i * 0.12 }}>
                  <Chip size={180} label={i === 0 ? "$60" : ""}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Other packs + custom */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) 1.4fr", gap: 16, marginBottom: 32 }}>
        {[
          { id: "small", pay: "$60", get: "$60", bonus: "—", hrs: "5 hrs" },
          { id: "med", pay: "$120", get: "$135", bonus: "12% bonus", hrs: "≈11 hrs" },
          { id: "big", pay: "$500", get: "$800", bonus: "60% bonus", hrs: "≈67 hrs" },
        ].map(p => (
          <div key={p.id} className="card card-bordered" style={{ padding: 20, cursor: "pointer", border: pack === p.id ? "1px solid var(--gold-400)" : undefined, boxShadow: pack === p.id ? "var(--gold-glow-soft)" : "none" }} onClick={() => setPack(p.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="eyebrow" style={{ fontSize: 10 }}>{p.bonus}</div>
              {pack === p.id && <Icon name="check" size={14} color="#C9A24A"/>}
            </div>
            <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, fontWeight: 600 }}>{p.pay}</div>
            <div style={{ color: "var(--ivory-300)", fontSize: 13, marginTop: 4 }}>→ {p.get} credit</div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "JetBrains Mono, monospace", marginTop: 8 }}>{p.hrs}</div>
          </div>
        ))}
        <div className="card card-bordered" style={{ padding: 20, cursor: "pointer", border: pack === "custom" ? "1px solid var(--gold-400)" : undefined }} onClick={() => setPack("custom")}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 12 }}>Custom Amount</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, color: "var(--text-muted)" }}>$</span>
            <input type="number" value={custom} onChange={e => setCustom(+e.target.value)} className="input" style={{ fontSize: 24, fontFamily: "Cormorant Garamond, serif", padding: "4px 8px", border: "none", background: "transparent" }}/>
          </div>
          <input type="range" min="20" max="1000" step="10" value={custom} onChange={e => setCustom(+e.target.value)} style={{ width: "100%", accentColor: "#C9A24A", marginTop: 8 }}/>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>≈ {(custom / 12).toFixed(1)} hours · No bonus under $100</div>
        </div>
      </div>

      {/* Stripe-style checkout */}
      <div className="card card-bordered" style={{ padding: 32, maxWidth: 640 }}>
        <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 24, marginBottom: 20 }}>Payment</h3>
        <div style={{ background: "var(--ink-850)", borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <Row k="Charge" v={pack === "hero" ? "$200.00" : pack === "custom" ? `$${custom}.00` : pack === "small" ? "$60.00" : pack === "med" ? "$120.00" : "$500.00"}/>
          <Row k="Credit added" v={<span style={{ color: "#8FBE8F" }}>{pack === "hero" ? "+$300.00" : pack === "custom" ? `+$${custom}.00` : pack === "small" ? "+$60.00" : pack === "med" ? "+$135.00" : "+$800.00"}</span>}/>
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div className="card card-bordered" style={{ flex: 1, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid var(--gold-400)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 36, height: 24, background: "var(--gold-grad)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#0B0B0B", fontWeight: 700, letterSpacing: 1 }}>VISA</div>
              <div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>•••• 4242</div>
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Exp 09/27 · Default</div>
              </div>
            </div>
            <Icon name="check" size={16} color="#C9A24A"/>
          </div>
        </div>
        <button className="btn btn-primary btn-lg" style={{ width: "100%" }}>Buy Time · Charge {pack === "hero" ? "$200" : pack === "custom" ? `$${custom}` : pack === "small" ? "$60" : pack === "med" ? "$120" : "$500"}</button>
        <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 11, marginTop: 12, letterSpacing: "0.08em" }}>
          <Icon name="shield" size={11}/> Stripe · 256-bit · Receipt emailed instantly
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PortalShell, DashboardScreen, BuyTimeScreen });
