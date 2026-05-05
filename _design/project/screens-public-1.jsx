/* global React, Chip, Wordmark, Suit, Laurel, Icon, MembershipCard, TimeWallet */
const { useState: useS3, useEffect: useE3, useRef: useR3, useMemo: useM3 } = React;

// ============================================================
// PUBLIC SITE — top nav + footer wrapper
// ============================================================

const PublicNav = ({ current, onNav }) => (
  <nav style={{
    position: "sticky", top: 0, zIndex: 50,
    height: 72,
    background: "rgba(11, 11, 11, 0.85)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid var(--border-faint)",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 40px",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => onNav("home")}>
      <Chip size={36} />
      <Wordmark size="md" showSubtitle={true} />
    </div>
    <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
      {[
        { id: "home", label: "Home" },
        { id: "club", label: "The Club" },
        { id: "games", label: "Games & Tournaments" },
        { id: "membership", label: "Membership" },
        { id: "contact", label: "Find Us" },
      ].map(item => (
        <a key={item.id} onClick={() => onNav(item.id)} style={{
          fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase",
          color: current === item.id ? "var(--gold-300)" : "var(--ivory-300)",
          fontWeight: 500, cursor: "pointer",
          borderBottom: current === item.id ? "1px solid var(--gold-400)" : "1px solid transparent",
          paddingBottom: 4,
          transition: "all 220ms var(--ease)",
        }}>{item.label}</a>
      ))}
      <button className="btn btn-sm" onClick={() => onNav("login")} style={{ marginLeft: 16 }}>Member Sign In</button>
      <button className="btn btn-primary btn-sm" onClick={() => onNav("signup")}>Apply</button>
    </div>
  </nav>
);

const PublicFooter = ({ onNav }) => (
  <footer style={{ borderTop: "1px solid var(--border-faint)", padding: "60px 40px 40px", background: "var(--ink-850)" }}>
    <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Chip size={48} />
          <Wordmark size="md" />
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, maxWidth: 320 }}>
          A private social club for legal, member-funded poker. Membership by application.
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 20, color: "var(--gold-400)" }}>
          <Suit kind="heart" size={14} /><Suit kind="diamond" size={14} /><Suit kind="club" size={14} /><Suit kind="spade" size={14} />
        </div>
      </div>
      {[
        { title: "The Club", links: [["The Room", "club"], ["House Rules", "club"], ["Dress Code", "club"]] },
        { title: "Play", links: [["Cash Games", "games"], ["Tournaments", "games"], ["Membership", "membership"]] },
        { title: "Visit", links: [["Find Us", "contact"], ["Hours", "contact"], ["Member Portal", "login"]] },
      ].map(col => (
        <div key={col.title}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>{col.title}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {col.links.map(([label, target]) => (
              <a key={label} onClick={() => onNav(target)} style={{ color: "var(--ivory-300)", fontSize: 13, cursor: "pointer", textDecoration: "none" }}>{label}</a>
            ))}
          </div>
        </div>
      ))}
    </div>
    <hr className="gold-rule" style={{ margin: "40px auto 24px", maxWidth: 1280 }}/>
    <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", justifyContent: "space-between", color: "var(--text-dim)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
      <span>© MMXXIV Members Only Poker Social Club</span>
      <span>Members must be 21+ · ID required at the door · Play responsibly</span>
    </div>
  </footer>
);

// ============================================================
// HOME
// ============================================================
const HomeScreen = ({ onNav }) => (
  <div>
    {/* HERO */}
    <section style={{
      position: "relative",
      height: 720,
      overflow: "hidden",
      borderBottom: "1px solid var(--border-faint)",
    }}>
      <img src="assets/venue-exterior.png" style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
        filter: "brightness(0.5) saturate(0.9)",
      }}/>
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(11,11,11,0.4) 0%, rgba(11,11,11,0.3) 50%, rgba(11,11,11,0.95) 100%)",
      }}/>
      <div className="grain" style={{ position: "absolute", inset: 0 }}/>

      <div style={{
        position: "relative",
        maxWidth: 1280, margin: "0 auto",
        padding: "120px 40px 0",
        height: "100%",
        display: "flex", flexDirection: "column", justifyContent: "center",
        textAlign: "center",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <Chip size={84} />
        </div>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Est. MMXXIV · Private Social Club</div>
        <h1 style={{
          fontFamily: "Cormorant Garamond, serif",
          fontSize: 96, fontWeight: 500,
          lineHeight: 1, letterSpacing: "-0.015em",
          marginBottom: 24,
        }}>
          A room. A game.<br/>
          <em className="gold-text" style={{ fontStyle: "italic" }}>A chair waiting for you.</em>
        </h1>
        <div className="diamond-divider" style={{ maxWidth: 320, margin: "0 auto 24px" }}>
          <Suit kind="diamond" size={10} color="#C9A24A" />
        </div>
        <p style={{ fontSize: 17, color: "var(--ivory-300)", maxWidth: 580, margin: "0 auto 40px", lineHeight: 1.6 }}>
          Members-funded poker, held to a higher standard. No rake. No tilt. Just twelve tables and the people you wanted to play with anyway.
        </p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
          <button className="btn btn-primary btn-lg" onClick={() => onNav("membership")}>Apply for Membership</button>
          <button className="btn btn-lg" onClick={() => onNav("games")}>Tonight's Games</button>
        </div>
      </div>
    </section>

    {/* LIVE TICKER */}
    <section style={{ borderBottom: "1px solid var(--border-faint)", background: "var(--ink-850)", padding: "20px 40px" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", alignItems: "center", gap: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span className="pill pill-live">Live · Now</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.16em", textTransform: "uppercase" }}>The Floor</span>
        </div>
        <div style={{ flex: 1, display: "flex", gap: 32, overflow: "hidden", fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "var(--ivory-300)" }}>
          {[
            ["1/2 NL Hold'em", "2 seats open", "T7"],
            ["2/5 NL Hold'em", "Waitlist 4", "T3"],
            ["5/10 NL Hold'em", "Full · Wait 2", "T1"],
            ["PLO 2/5", "1 seat open", "T9"],
            ["Friday Bounty", "Starts 7:00 PM", "—"],
          ].map(([game, status, table], i) => (
            <div key={i} style={{ display: "flex", gap: 12, whiteSpace: "nowrap", alignItems: "center" }}>
              <span style={{ color: "var(--gold-300)" }}>{game}</span>
              <span style={{ color: "var(--text-muted)" }}>·</span>
              <span>{status}</span>
              <span style={{ color: "var(--text-dim)" }}>{table}</span>
              {i < 4 && <span style={{ color: "var(--gold-600)", marginLeft: 16 }}>◆</span>}
            </div>
          ))}
        </div>
        <a onClick={() => onNav("games")} style={{ color: "var(--gold-300)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.16em", cursor: "pointer", display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          Full board <Icon name="arrowRight" size={12} />
        </a>
      </div>
    </section>

    {/* VALUE PROP */}
    <section style={{ padding: "120px 40px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 80 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>The Difference</div>
        <h2 className="section-title" style={{ fontSize: 64, marginBottom: 24 }}>
          Built for the people<br/>at the <em className="gold-text" style={{ fontStyle: "italic" }}>table</em>.
        </h2>
        <hr className="gold-rule-short" style={{ marginTop: 32 }}/>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
        {[
          { title: "No Rake", body: "Revenue comes from membership and seat-time. Every dollar at the table stays at the table. The house wins by hosting a room you keep coming back to.", num: "I" },
          { title: "Members First", body: "Membership is by application. The room stays the size we can keep at the level we want. You'll know the dealers. They'll know your name.", num: "II" },
          { title: "Honest Time", body: "$12 an hour, billed by the minute. Step away for dinner, your meter pauses. Pay $200, get $300 of credit. Keep it simple.", num: "III" },
        ].map((card, i) => (
          <div key={i} style={{ borderTop: "1px solid var(--gold-400)", paddingTop: 32 }}>
            <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 14, letterSpacing: "0.4em", marginBottom: 16 }}>{card.num}</div>
            <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, marginBottom: 16 }}>{card.title}</h3>
            <p style={{ color: "var(--ivory-400)", fontSize: 15, lineHeight: 1.7 }}>{card.body}</p>
          </div>
        ))}
      </div>
    </section>

    {/* SIGNAGE FEATURE */}
    <section style={{ position: "relative", padding: "100px 0", borderTop: "1px solid var(--border-faint)", borderBottom: "1px solid var(--border-faint)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 40px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
        <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1.4 / 1" }}>
          <img src="assets/signage.png" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, transparent 60%, rgba(11,11,11,0.4))" }}/>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>The House</div>
          <h2 className="section-title" style={{ fontSize: 56, marginBottom: 24 }}>
            Twelve tables.<br/>
            <em className="gold-text" style={{ fontStyle: "italic" }}>One standard.</em>
          </h2>
          <p style={{ color: "var(--ivory-300)", fontSize: 16, lineHeight: 1.7, marginBottom: 32 }}>
            Tournament-grade Copag cards. Cushioned rails. Properly trained dealers — not a hobbyist with a button. A bar stocked the way a poker night should be.
          </p>
          <p style={{ color: "var(--ivory-300)", fontSize: 16, lineHeight: 1.7, marginBottom: 40 }}>
            We open the doors at 4. Last seat goes at 2. Sundays are cash only. Tuesdays we run the bounty. Thursday is ladies night, by which we mean ladies sit free.
          </p>
          <button className="btn" onClick={() => onNav("club")}>
            Tour The Club <Icon name="arrowRight" size={14} />
          </button>
        </div>
      </div>
    </section>

    {/* HOURS */}
    <section style={{ padding: "100px 40px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 80 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Open Tonight</div>
          <h2 className="section-title" style={{ fontSize: 48, marginBottom: 16 }}>4:00 PM<br/><em className="gold-text" style={{ fontStyle: "italic" }}>until last hand</em></h2>
        </div>
        <div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            {[
              ["Monday", "Closed", true],
              ["Tuesday", "4:00 PM — 2:00 AM"],
              ["Wednesday", "4:00 PM — 2:00 AM"],
              ["Thursday", "4:00 PM — 2:00 AM"],
              ["Friday", "2:00 PM — 4:00 AM"],
              ["Saturday", "12:00 PM — 4:00 AM"],
              ["Sunday", "12:00 PM — Midnight"],
            ].map(([d, h, closed], i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-faint)" }}>
                <td style={{ padding: "16px 0", fontFamily: "Cormorant Garamond, serif", fontSize: 22, color: "var(--ivory-200)" }}>{d}</td>
                <td style={{ padding: "16px 0", textAlign: "right", color: closed ? "var(--text-dim)" : "var(--gold-300)", fontFamily: "JetBrains Mono, monospace", fontSize: 13, letterSpacing: "0.05em" }}>{h}</td>
              </tr>
            ))}
          </table>
        </div>
      </div>
    </section>

    {/* CTA */}
    <section style={{ position: "relative", padding: "120px 40px", textAlign: "center", borderTop: "1px solid var(--border-faint)" }}>
      <div style={{ position: "absolute", left: "50%", top: 60, transform: "translateX(-50%)", opacity: 0.5 }}>
        <Laurel width={400} opacity={0.3}/>
      </div>
      <div style={{ position: "relative", maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 64, fontWeight: 500, lineHeight: 1, marginBottom: 24 }}>
          The chair is open.<br/><em className="gold-text" style={{ fontStyle: "italic" }}>Pull it up.</em>
        </h2>
        <p style={{ color: "var(--ivory-300)", fontSize: 16, marginBottom: 40, maxWidth: 520, marginLeft: "auto", marginRight: "auto", lineHeight: 1.7 }}>
          $25 a month with autopay. Apply in five minutes. Approved within twenty-four hours.
        </p>
        <button className="btn btn-primary btn-lg" onClick={() => onNav("signup")}>Apply for Membership <Icon name="arrowRight" size={14} stroke={2}/></button>
      </div>
    </section>
  </div>
);

Object.assign(window, { PublicNav, PublicFooter, HomeScreen });
