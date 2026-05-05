/* global React, Chip, Icon, Suit, Row, Wordmark */
const { useState: useS8 } = React;

// BILLING
const BillingScreen = ({ onNav }) => {
  const [autopay, setAutopay] = useS8(true);
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Billing</div>
        <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 44 }}>Payment & Plan</h1>
      </div>

      {/* Plan card */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, marginBottom: 24 }}>
        <div className="card card-bordered" style={{ padding: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Current Plan</div>
              <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 28 }}>The Member · Autopay</h3>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>Renews Apr 24 · $25.00</div>
            </div>
            <span className="pill pill-live">Active</span>
          </div>

          <div style={{ background: "linear-gradient(160deg, #1F1A12, #0E0D0B)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 18 }}>Autopay Discount</div>
              <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>You save <span style={{ color: "#8FBE8F" }}>$60/year</span> on autopay</div>
            </div>
            <button onClick={() => setAutopay(!autopay)} style={{
              width: 52, height: 28, borderRadius: 999, border: 0, cursor: "pointer",
              background: autopay ? "var(--gold-grad)" : "var(--ink-700)",
              position: "relative", transition: "all 220ms",
            }}>
              <div style={{ position: "absolute", top: 3, left: autopay ? 27 : 3, width: 22, height: 22, borderRadius: "50%", background: autopay ? "#0B0B0B" : "#F4EDE0", transition: "all 220ms" }}/>
            </button>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-sm btn-ghost">Pause for a month</button>
            <button className="btn btn-sm btn-ghost" style={{ color: "var(--crimson-light)" }}>Cancel membership</button>
          </div>
        </div>

        <div className="card card-bordered" style={{ padding: 28 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Default Method</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <div style={{ width: 56, height: 36, background: "var(--gold-grad)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#0B0B0B", fontWeight: 700, letterSpacing: 1 }}>VISA</div>
            <div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14 }}>•••• 4242</div>
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Marcus W. Holloway · Exp 09/27</div>
            </div>
          </div>
          <button className="btn btn-sm" style={{ width: "100%" }}><Icon name="plus" size={12}/> Add new card</button>
        </div>
      </div>

      {/* Invoices */}
      <div className="card card-bordered" style={{ padding: 0 }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-faint)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22 }}>Invoices</h3>
          <button className="btn btn-sm btn-ghost"><Icon name="download" size={12}/> Export all</button>
        </div>
        <table className="tbl">
          <thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {[
              ["Apr 24, 2024", "Membership · Autopay", "Visa •••• 4242", "$25.00", "Paid"],
              ["Apr 12, 2024", "Time Pack · $200 → $300", "Visa •••• 4242", "$200.00", "Paid"],
              ["Mar 24, 2024", "Membership · Autopay", "Visa •••• 4242", "$25.00", "Paid"],
              ["Mar 03, 2024", "Time Pack · $120 → $135", "Visa •••• 4242", "$120.00", "Paid"],
              ["Feb 24, 2024", "Membership · Autopay", "Visa •••• 4242", "$25.00", "Paid"],
              ["Jan 24, 2024", "Membership · Autopay", "Visa •••• 4242", "$25.00", "Paid"],
              ["Jan 04, 2024", "Application fee", "Visa •••• 4242", "$50.00", "Paid"],
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text-muted)" }}>{r[0]}</td>
                <td>{r[1]}</td>
                <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{r[2]}</td>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>{r[3]}</td>
                <td><span style={{ color: "#8FBE8F", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>● {r[4]}</span></td>
                <td><a style={{ color: "var(--gold-300)", fontSize: 12, cursor: "pointer" }}>Receipt</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// PROFILE
const ProfileScreen = ({ onNav }) => (
  <div>
    <div style={{ marginBottom: 32 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Profile</div>
      <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 44 }}>Your Account</h1>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <div className="card card-bordered" style={{ padding: 28 }}>
        <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, marginBottom: 20 }}>Personal Details</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="field"><label className="field-label">Display Name</label><input className="input" defaultValue="Marcus W. Holloway"/></div>
          <div className="field"><label className="field-label">Email</label><input className="input" defaultValue="m.holloway@example.com"/></div>
          <div className="field"><label className="field-label">Mobile</label><input className="input" defaultValue="(316) 555-0199"/></div>
          <div className="field"><label className="field-label">Address (for receipts)</label><input className="input" defaultValue="2241 Riverside Dr, Wichita, KS 67203"/></div>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Save changes</button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="card card-bordered" style={{ padding: 28 }}>
          <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, marginBottom: 20 }}>ID On File</h3>
          <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 16, background: "var(--ink-850)", borderRadius: 8, marginBottom: 16 }}>
            <Icon name="creditCard" size={28} color="#C9A24A"/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14 }}>Driver's License · KS</div>
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Verified Jan 04, 2024 · Expires 2027</div>
            </div>
            <span className="pill pill-live">Verified</span>
          </div>
          <button className="btn btn-sm">Update ID</button>
        </div>
        <div className="card card-bordered" style={{ padding: 28 }}>
          <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, marginBottom: 16 }}>Communications</h3>
          {[
            ["Game alerts", "Open seats at your stakes", true],
            ["Tournament reminders", "12 hours before", true],
            ["Members' Slack invite", "Re-send", false],
            ["Marketing", "Monthly recap, occasional offers", false],
          ].map((c, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--border-faint)" : "none" }}>
              <div>
                <div style={{ fontSize: 14 }}>{c[0]}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{c[1]}</div>
              </div>
              <ToggleSm on={c[2]}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const ToggleSm = ({ on }) => (
  <div style={{ width: 36, height: 20, borderRadius: 999, background: on ? "var(--gold-grad)" : "var(--ink-700)", position: "relative" }}>
    <div style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: on ? "#0B0B0B" : "#F4EDE0" }}/>
  </div>
);

// ACTIVITY
const ActivityScreen = ({ onNav }) => (
  <div>
    <div style={{ marginBottom: 32 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>History</div>
      <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 44 }}>Sessions</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>Every hand played here. Tracked from chair to cash-out.</p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
      {[["Total Sessions", "63"], ["Hours Logged", "247.4"], ["Tournaments Cashed", "4"], ["Net (self-reported)", "+$2,840"]].map((s, i) => (
        <div key={i} className="card card-bordered" style={{ padding: 20 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>{s[0]}</div>
          <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, fontWeight: 600 }}>{s[1]}</div>
        </div>
      ))}
    </div>

    {/* Filters */}
    <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>Filter</span>
      {["All", "Cash", "Tournament", "PLO", "This month", "This year"].map((f, i) => (
        <button key={i} className="btn btn-sm btn-ghost" style={{ borderColor: i === 0 ? "var(--gold-400)" : undefined, color: i === 0 ? "var(--gold-200)" : undefined }}>{f}</button>
      ))}
      <div style={{ flex: 1 }}/>
      <div style={{ position: "relative" }}>
        <input className="input" placeholder="Search sessions" style={{ paddingLeft: 36, width: 240 }}/>
        <Icon name="search" size={14} color="#8C8470" style={{ position: "absolute", left: 12, top: 14 }}/>
      </div>
    </div>

    <div className="card card-bordered" style={{ padding: 0 }}>
      <table className="tbl">
        <thead><tr><th>Date</th><th>Game</th><th>Table</th><th>Duration</th><th>Seat-time</th><th>Result</th><th>Notes</th></tr></thead>
        <tbody>
          {[
            ["Apr 11", "$2/$5 NL", "T3", "4h 18m", "$51.60", "+$420", "Cracked aces with 78s"],
            ["Apr 9", "Tuesday Bounty", "T6", "5h 02m", "$60.40", "+$185", "2 KOs · Out 14th"],
            ["Apr 6", "$1/$2 NL", "T7", "3h 44m", "$44.80", "−$180", ""],
            ["Apr 4", "$2/$5 PLO", "T9", "2h 50m", "$34.00", "+$760", "Set over set"],
            ["Apr 2", "$1/$2 NL", "T8", "2h 12m", "$26.40", "Even", ""],
            ["Mar 30", "Saturday Deepstack", "T1", "8h 24m", "$100.80", "+$1,200", "Final table · 4th"],
            ["Mar 27", "$2/$5 NL", "T2", "3h 30m", "$42.00", "−$240", ""],
            ["Mar 24", "$1/$2 NL", "T7", "5h 12m", "$62.40", "+$310", ""],
            ["Mar 21", "$2/$5 NL", "T4", "2h 48m", "$33.60", "Even", ""],
            ["Mar 19", "Tuesday Bounty", "T6", "3h 50m", "$46.00", "−$120", "Out 22nd"],
          ].map((r, i) => (
            <tr key={i}>
              <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text-muted)" }}>{r[0]}</td>
              <td>{r[1]}</td>
              <td style={{ color: "var(--gold-300)", fontFamily: "Cormorant Garamond, serif", fontSize: 16 }}>{r[2]}</td>
              <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>{r[3]}</td>
              <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--text-muted)" }}>{r[4]}</td>
              <td style={{ color: r[5].startsWith("+") ? "#8FBE8F" : r[5].startsWith("−") ? "var(--crimson-light)" : "var(--text-muted)", fontSize: 13 }}>{r[5]}</td>
              <td style={{ color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>{r[6] || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ADMIN
const AdminScreen = ({ onNav }) => (
  <div style={{ minHeight: "100vh", background: "var(--ink-900)", color: "var(--ivory-200)" }}>
    <div style={{ height: 56, padding: "0 24px", borderBottom: "1px solid var(--border-faint)", background: "var(--ink-850)", display: "flex", alignItems: "center", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chip size={28}/>
        <span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 16, color: "var(--gold-300)" }}>Members Only</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 3 }}>Admin</span>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ivory-300)" }}>
        {["Members", "Sessions", "Tables", "Tournaments", "Comps & Refunds", "Reports"].map((t, i) => (
          <a key={i} style={{ cursor: "pointer", color: i === 0 ? "var(--gold-300)" : undefined, borderBottom: i === 0 ? "1px solid var(--gold-400)" : "1px solid transparent", paddingBottom: 4 }}>{t}</a>
        ))}
      </div>
      <div style={{ flex: 1 }}/>
      <button className="btn btn-sm btn-ghost" onClick={() => onNav("dashboard")}>← Exit Admin</button>
    </div>

    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 28 }}>Members</h1>
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>347 active · 18 paused · 3 pending review</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm">Manual Time Credit</button>
          <button className="btn btn-sm">Comp Adjust</button>
          <button className="btn btn-sm btn-primary">+ Add Member</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input className="input" placeholder="Search by name, email, member #" style={{ maxWidth: 360 }}/>
        {["All 368", "Active 347", "Paused 18", "Pending 3", "Suspended 0"].map((f, i) => (
          <button key={i} className="btn btn-sm btn-ghost" style={{ fontSize: 11, padding: "8px 12px", borderColor: i === 0 ? "var(--gold-400)" : undefined, color: i === 0 ? "var(--gold-200)" : undefined }}>{f}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, border: "1px solid var(--border-faint)" }}>
        <table className="tbl" style={{ fontSize: 13 }}>
          <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Status</th><th>Plan</th><th>Wallet</th><th>Sessions</th><th>Last Visit</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            {[
              ["00347", "Marcus W. Holloway", "m.holloway@example.com", "Active", "Autopay", "$82.40", 63, "Apr 11", "Jan 2024", "View"],
              ["00346", "Susan R. Chen", "s.chen@example.com", "Active", "Autopay", "$240.00", 41, "Apr 11", "Jan 2024", "View"],
              ["00345", "James P. Kowalski", "j.kowalski@example.com", "Paused", "Monthly", "$0.00", 22, "Mar 02", "Dec 2023", "View"],
              ["00344", "Daria V. Lemarchand", "d.lemarchand@example.com", "Active", "Autopay", "$1,180.00", 87, "Apr 10", "Nov 2023", "View"],
              ["00343", "Robert E. Akinwale", "r.akinwale@example.com", "Pending", "—", "—", 0, "—", "Apr 11", "Review"],
              ["00342", "Phaedra Q. Lin", "p.lin@example.com", "Active", "Autopay", "$48.00", 14, "Apr 09", "Mar 2024", "View"],
              ["00341", "William K. Goff III", "w.goff@example.com", "Active", "Monthly", "$0.00", 9, "Apr 06", "Feb 2024", "View"],
              ["00340", "Yuki Tanaka", "y.tanaka@example.com", "Active", "Autopay", "$320.00", 52, "Apr 11", "Oct 2023", "View"],
              ["00339", "Chris O'Connor", "c.oconnor@example.com", "Active", "Autopay", "$24.00", 31, "Apr 08", "Sep 2023", "View"],
              ["00338", "Anne-Marie Belieu", "am.belieu@example.com", "Pending", "—", "—", 0, "—", "Apr 10", "Review"],
              ["00337", "Tomas Reyes", "t.reyes@example.com", "Active", "Autopay", "$180.00", 19, "Apr 04", "Jan 2024", "View"],
              ["00336", "Henrietta van Dale", "h.vandale@example.com", "Paused", "Monthly", "$60.00", 28, "Feb 20", "Aug 2023", "View"],
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--gold-300)", fontSize: 12 }}>{r[0]}</td>
                <td>{r[1]}</td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{r[2]}</td>
                <td><span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: r[3] === "Active" ? "#8FBE8F" : r[3] === "Pending" ? "var(--warning)" : "var(--text-muted)" }}>● {r[3]}</span></td>
                <td style={{ fontSize: 12 }}>{r[4]}</td>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{r[5]}</td>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text-muted)" }}>{r[6]}</td>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text-muted)" }}>{r[7]}</td>
                <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{r[8]}</td>
                <td><a style={{ color: "var(--gold-300)", fontSize: 12, cursor: "pointer" }}>{r[9]} →</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

Object.assign(window, { BillingScreen, ProfileScreen, ActivityScreen, AdminScreen, ToggleSm });
