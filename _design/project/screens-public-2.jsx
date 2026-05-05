/* global React, Chip, Wordmark, Suit, Laurel, Icon */
const { useState: useS4 } = React;

// ============================================================
// THE CLUB
// ============================================================
const ClubScreen = ({ onNav }) => (
  <div>
    <section style={{ position: "relative", padding: "100px 40px 60px", borderBottom: "1px solid var(--border-faint)", textAlign: "center", maxWidth: 1280, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 20 }}>About</div>
      <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 88, fontWeight: 500, lineHeight: 1, marginBottom: 24 }}>The Club</h1>
      <hr className="gold-rule-short"/>
      <p style={{ color: "var(--ivory-300)", fontSize: 18, lineHeight: 1.7, maxWidth: 680, margin: "32px auto 0" }}>
        We are a member-funded social poker club. The doors are private. The room is finite. The rake is zero. We exist because the people who play here wanted somewhere better to play.
      </p>
    </section>

    {/* THE ROOM — top-down layout */}
    <section style={{ padding: "100px 40px", maxWidth: 1280, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 16 }}>The Room</div>
      <h2 className="section-title" style={{ fontSize: 48, marginBottom: 16 }}>Twelve tables. One bar. <em className="gold-text" style={{ fontStyle: "italic" }}>No music after midnight.</em></h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, maxWidth: 640, marginBottom: 48 }}>10–14 tables, comfortably. Wide center aisle for traffic. Cashier and membership desk by the door, so the chair you walk to is always the chair you want.</p>

      <div style={{
        background: "linear-gradient(180deg, #0E0D0B, #15140F)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 24,
        position: "relative",
        overflow: "hidden",
      }}>
        <img src="assets/poker-room-layout.png" alt="Members Only Poker — recommended room layout" style={{ width: "100%", display: "block", borderRadius: 8, border: "1px solid var(--border-faint)" }}/>
        <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, fontSize: 13, color: "var(--ivory-300)" }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6, color: "var(--gold-300)" }}>① Main Pit</div>
            8–12 tables in two long rows. Where most cash games run.
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6, color: "var(--gold-300)" }}>② Feature / High Stakes</div>
            2–3 premium tables along the back wall. Camera coverage built in.
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6, color: "var(--gold-300)" }}>③ Tournament & Beginner</div>
            3–4 side-wall tables. Soft games, deep stacks, bounty nights.
          </div>
        </div>
      </div>
    </section>

    {/* HOUSE RULES + DRESS CODE */}
    <section style={{ padding: "60px 40px 100px", maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 16 }}>House Rules</div>
        <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 36, marginBottom: 24 }}>Standard TDA, with our additions.</h3>
        <ol style={{ paddingLeft: 0, listStyle: "none", color: "var(--ivory-300)", fontSize: 14, lineHeight: 1.8 }}>
          {[
            "TDA tournament rules apply at every table, cash and tournament alike.",
            "Phones face-down at the table. Calls and texts in the lounge.",
            "One player to a hand. No coaching, no rabbit hunting on the felt.",
            "English only at the table during a hand.",
            "Show one, show all. House enforces.",
            "Dealer's word is final. Floor's word overrides. Don't argue with the dealer.",
            "Cash plays at posted limits. Maximum buy-in is 100 big blinds; no exceptions.",
            "Time penalties: 1 orbit warning, 2 orbits sit-out, 3 orbits removed for the night.",
          ].map((r, i) => (
            <li key={i} style={{ display: "flex", gap: 16, paddingTop: 12, paddingBottom: 12, borderTop: i === 0 ? "1px solid var(--border-faint)" : "none", borderBottom: "1px solid var(--border-faint)" }}>
              <span style={{ color: "var(--gold-400)", fontFamily: "Cormorant Garamond, serif", fontSize: 18, minWidth: 28 }}>{String(i + 1).padStart(2, "0")}</span>
              <span>{r}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Dress Code</div>
        <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 36, marginBottom: 24 }}>Look like you mean it.</h3>
        <div style={{ background: "var(--ink-800)", border: "1px solid var(--border-faint)", borderRadius: 10, padding: 28, marginBottom: 16 }}>
          <div style={{ color: "var(--gold-300)", fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 12 }}>Encouraged</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ivory-300)", fontSize: 14, lineHeight: 1.9 }}>
            <li>Collared shirts, button-downs, knitwear</li>
            <li>Dark denim or trousers</li>
            <li>Closed-toe footwear</li>
            <li>Sport coats welcome, never required</li>
          </ul>
        </div>
        <div style={{ background: "var(--ink-800)", border: "1px solid var(--border-faint)", borderRadius: 10, padding: 28 }}>
          <div style={{ color: "var(--crimson-light)", fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 12 }}>Not Permitted</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ivory-300)", fontSize: 14, lineHeight: 1.9 }}>
            <li>Tank tops, athletic shorts, flip-flops</li>
            <li>Hats with active sports team logos at tournament tables</li>
            <li>Hoods up at the table</li>
            <li>Sunglasses indoors after 9 PM (yes, really)</li>
          </ul>
        </div>
      </div>
    </section>

    {/* GALLERY */}
    <section style={{ padding: "60px 0 100px", borderTop: "1px solid var(--border-faint)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 40px" }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Photos</div>
        <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 36, marginBottom: 32 }}>The Room, the night, the hand.</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <div style={{ aspectRatio: "1.4/1", borderRadius: 8, overflow: "hidden" }}>
            <img src="assets/venue-exterior.png" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
          </div>
          <div style={{ aspectRatio: "1/1.2", borderRadius: 8, overflow: "hidden" }}>
            <img src="assets/signage.png" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
          </div>
          <PhotoPlaceholder label="The Bar" />
          <PhotoPlaceholder label="Felt + Cards" />
          <PhotoPlaceholder label="Tournament Night" />
          <div style={{ aspectRatio: "1.6/1", borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink-850)", border: "1px solid var(--border-faint)" }}>
            <Chip size={120}/>
          </div>
        </div>
      </div>
    </section>
  </div>
);

const PhotoPlaceholder = ({ label, aspect = "1/1" }) => (
  <div style={{
    aspectRatio: aspect,
    borderRadius: 8,
    background: "var(--ink-850)",
    border: "1px dashed var(--border)",
    display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8,
    color: "var(--text-dim)",
  }}>
    <Suit kind="diamond" size={20} color="#6E5520"/>
    <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase" }}>Photo · {label}</div>
  </div>
);

const RoomLayoutSVG = () => {
  const tables = [
    { x: 120, y: 90, n: 1, k: "cash" }, { x: 280, y: 90, n: 2, k: "cash" }, { x: 440, y: 90, n: 3, k: "cash" },
    { x: 600, y: 90, n: 4, k: "cash" }, { x: 760, y: 90, n: 5, k: "cash" }, { x: 920, y: 90, n: 6, k: "tourney" },
    { x: 120, y: 320, n: 7, k: "cash" }, { x: 280, y: 320, n: 8, k: "cash" }, { x: 440, y: 320, n: 9, k: "cash" },
    { x: 600, y: 320, n: 10, k: "tourney" }, { x: 760, y: 320, n: 11, k: "reserved" }, { x: 920, y: 320, n: 12, k: "tourney" },
  ];
  const colors = { cash: "#1F3A2E", tourney: "#A8842F", reserved: "#3A342C" };
  return (
    <svg viewBox="0 0 1080 460" style={{ width: "100%", height: "auto", display: "block" }}>
      {/* Floor */}
      <rect x="20" y="20" width="1040" height="420" fill="#0B0B0B" stroke="#C9A24A" strokeWidth="0.5" opacity="0.4"/>
      {/* Walls */}
      <rect x="20" y="20" width="1040" height="420" fill="none" stroke="#C9A24A" strokeWidth="1.5"/>
      {/* Bar */}
      <rect x="40" y="200" width="180" height="40" fill="#1A1816" stroke="#C9A24A" strokeWidth="1"/>
      <text x="130" y="225" fill="#C9A24A" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontSize="14" letterSpacing="2">BAR</text>
      {/* Lounge */}
      <rect x="240" y="200" width="200" height="40" fill="none" stroke="#C9A24A" strokeWidth="0.5" strokeDasharray="3,3"/>
      <text x="340" y="225" fill="#8C8470" textAnchor="middle" fontFamily="Inter" fontSize="10" letterSpacing="3">LOUNGE</text>
      {/* Cashier */}
      <rect x="800" y="200" width="100" height="40" fill="#1A1816" stroke="#C9A24A" strokeWidth="1"/>
      <text x="850" y="225" fill="#C9A24A" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontSize="13" letterSpacing="2">CASHIER</text>
      {/* Dealer stand */}
      <rect x="920" y="200" width="120" height="40" fill="#0B0B0B" stroke="#C9A24A" strokeWidth="1"/>
      <text x="980" y="225" fill="#C9A24A" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontSize="11" letterSpacing="2">DEALERS</text>
      {/* Restrooms */}
      <rect x="460" y="200" width="60" height="40" fill="none" stroke="#C9A24A" strokeWidth="0.5"/>
      <text x="490" y="225" fill="#8C8470" textAnchor="middle" fontSize="9" letterSpacing="2">WC</text>
      {/* Entrance */}
      <rect x="500" y="420" width="80" height="20" fill="#C9A24A" opacity="0.8"/>
      <text x="540" y="455" fill="#C9A24A" textAnchor="middle" fontSize="9" letterSpacing="3">ENTRANCE</text>
      {/* Tables */}
      {tables.map(t => (
        <g key={t.n}>
          <ellipse cx={t.x} cy={t.y} rx="58" ry="32" fill={colors[t.k]} stroke="#C9A24A" strokeWidth="1"/>
          <ellipse cx={t.x} cy={t.y} rx="50" ry="24" fill="none" stroke="#C9A24A" strokeWidth="0.4" opacity="0.5"/>
          <text x={t.x} y={t.y + 5} fill="#F4D27A" textAnchor="middle" fontFamily="Cormorant Garamond, serif" fontSize="20" fontWeight="500">T{t.n}</text>
          {/* Seats */}
          {[...Array(9)].map((_, i) => {
            const a = (i / 9) * Math.PI * 2 - Math.PI / 2;
            return <circle key={i} cx={t.x + Math.cos(a) * 70} cy={t.y + Math.sin(a) * 42} r="3" fill="#C9A24A" opacity="0.5"/>;
          })}
        </g>
      ))}
    </svg>
  );
};

// ============================================================
// GAMES & TOURNAMENTS
// ============================================================
const GamesScreen = ({ onNav }) => (
  <div>
    <section style={{ padding: "80px 40px 40px", maxWidth: 1280, margin: "0 auto", textAlign: "center" }}>
      <div className="eyebrow" style={{ marginBottom: 16 }}>Currently On The Floor</div>
      <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 72, lineHeight: 1, marginBottom: 16 }}>Tonight's <em className="gold-text" style={{ fontStyle: "italic" }}>Board</em></h1>
      <p style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace", fontSize: 12, letterSpacing: "0.1em" }}>Updated 6:42 PM · Refreshes every 30s</p>
    </section>

    <section style={{ padding: "20px 40px 40px", maxWidth: 1280, margin: "0 auto" }}>
      <div className="card card-bordered" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-faint)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="pill pill-live">Live</span>
            <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 24 }}>Cash Games</h3>
          </div>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>11 of 12 tables in play</span>
        </div>
        <table className="tbl">
          <thead>
            <tr><th>Table</th><th>Game</th><th>Stakes</th><th>Buy-in</th><th>Status</th><th>Avg. Pot</th><th></th></tr>
          </thead>
          <tbody>
            {[
              ["T1", "NL Hold'em", "$5/$10", "$200—$1,000", "Full · Wait 2", "$340"],
              ["T2", "NL Hold'em", "$2/$5", "$100—$500", "Full · Wait 0", "$165"],
              ["T3", "NL Hold'em", "$2/$5", "$100—$500", "Waitlist 4", "$182"],
              ["T4", "NL Hold'em", "$1/$2", "$40—$200", "1 seat open", "$48"],
              ["T5", "NL Hold'em", "$1/$2", "$40—$200", "Full", "$52"],
              ["T7", "NL Hold'em", "$1/$2", "$40—$200", "2 seats open", "$44"],
              ["T8", "NL Hold'em", "$1/$3", "$60—$300", "Full · Wait 1", "$78"],
              ["T9", "PLO", "$2/$5", "$200—$1,000", "1 seat open", "$280"],
              ["T11", "Mixed (HORSE)", "$5/$10 limit", "$200", "Forming", "—"],
            ].map((row, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 18, color: "var(--gold-300)" }}>{row[0]}</td>
                <td>{row[1]}</td>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>{row[2]}</td>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--text-muted)" }}>{row[3]}</td>
                <td><span style={{ color: row[4].includes("open") ? "#8FBE8F" : row[4].includes("Wait") ? "var(--warning)" : "var(--text-muted)", fontSize: 13 }}>{row[4]}</span></td>
                <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>{row[5]}</td>
                <td><button className="btn btn-sm btn-ghost">Add Me</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    {/* TOURNAMENTS */}
    <section style={{ padding: "40px 40px 100px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 32 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>This Week</div>
          <h2 className="section-title" style={{ fontSize: 44 }}>Tournaments</h2>
        </div>
        <button className="btn btn-sm">Full Schedule <Icon name="arrowRight" size={12}/></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
        {[
          { day: "Tue", date: "Apr 16", title: "Tuesday Bounty", buyin: "$120 + $30", structure: "20-min levels · $25 bounty per knockout", reentry: "1 re-entry · 2 hours late reg", stack: "20,000", players: "32 reg'd", time: "7:00 PM" },
          { day: "Thu", date: "Apr 18", title: "Ladies' Night Freezeout", buyin: "$60", structure: "15-min levels · No re-entry", reentry: "Single chip drop", stack: "15,000", players: "18 reg'd", time: "7:00 PM" },
          { day: "Sat", date: "Apr 20", title: "Members' Deepstack", buyin: "$240 + $40", structure: "30-min levels · 60 BB starting", reentry: "Unlimited re-entry · Day 1 only", stack: "30,000", players: "44 reg'd", time: "12:00 PM" },
        ].map((t, i) => (
          <div key={i} className="card card-bordered" style={{ position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: "linear-gradient(180deg, #C9A24A, transparent)" }}/>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 10 }}>{t.day} · {t.date}</div>
                <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 26, marginTop: 6 }}>{t.title}</h3>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--gold-300)", fontSize: 14 }}>{t.time}</div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--border-faint)", paddingTop: 16, fontSize: 13, color: "var(--ivory-300)", lineHeight: 1.7 }}>
              <Row k="Buy-in" v={t.buyin}/>
              <Row k="Structure" v={t.structure}/>
              <Row k="Re-entry" v={t.reentry}/>
              <Row k="Starting stack" v={t.stack}/>
              <Row k="Registered" v={<span style={{ color: "#8FBE8F" }}>{t.players}</span>}/>
            </div>
            <button className="btn btn-primary btn-sm" style={{ width: "100%", marginTop: 20 }}>Register</button>
          </div>
        ))}
      </div>
    </section>
  </div>
);

const Row = ({ k, v }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
    <span style={{ color: "var(--text-muted)", fontSize: 12, letterSpacing: "0.06em" }}>{k}</span>
    <span style={{ textAlign: "right", maxWidth: "65%" }}>{v}</span>
  </div>
);

Object.assign(window, { ClubScreen, GamesScreen, PhotoPlaceholder, RoomLayoutSVG, Row });
