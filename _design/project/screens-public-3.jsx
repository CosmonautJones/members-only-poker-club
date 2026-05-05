/* global React, Chip, Wordmark, Suit, Laurel, Icon, Row */
const { useState: useS5 } = React;

// ============================================================
// MEMBERSHIP — pricing
// ============================================================
const MembershipScreen = ({ onNav }) => {
  const [autopay, setAutopay] = useS5(true);
  return (
    <div>
      <section style={{ padding: "100px 40px 40px", textAlign: "center", maxWidth: 1280, margin: "0 auto" }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Membership</div>
        <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 88, lineHeight: 1, marginBottom: 24 }}>
          One <em className="gold-text" style={{ fontStyle: "italic" }}>tier</em>. Two ways to pay.
        </h1>
        <hr className="gold-rule-short"/>
        <p style={{ color: "var(--ivory-300)", fontSize: 17, lineHeight: 1.7, maxWidth: 580, margin: "32px auto 0" }}>
          The room runs on memberships and seat-time. No rake. No tip-jar dealer fees. No "comp" promises we can't keep.
        </p>
      </section>

      <section style={{ padding: "60px 40px", maxWidth: 1100, margin: "0 auto" }}>
        {/* Toggle */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 40 }}>
          <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, padding: 4, background: "var(--ink-850)" }}>
            <button onClick={() => setAutopay(true)} style={{ padding: "10px 24px", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", border: 0, borderRadius: 999, cursor: "pointer", fontWeight: 500, background: autopay ? "var(--gold-grad)" : "transparent", color: autopay ? "#0B0B0B" : "var(--ivory-300)", transition: "all 220ms" }}>Autopay · Save 17%</button>
            <button onClick={() => setAutopay(false)} style={{ padding: "10px 24px", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", border: 0, borderRadius: 999, cursor: "pointer", fontWeight: 500, background: !autopay ? "var(--gold-grad)" : "transparent", color: !autopay ? "#0B0B0B" : "var(--ivory-300)", transition: "all 220ms" }}>Monthly</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Membership card */}
          <div className="card card-bordered" style={{ position: "relative", padding: 40, background: "linear-gradient(180deg, #1A1816, #0B0B0B)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 11 }}>Membership</div>
                <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, marginTop: 8 }}>The Member</h3>
              </div>
              <Chip size={56}/>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ color: "var(--text-muted)", fontSize: 18, fontFamily: "Cormorant Garamond, serif" }}>$</span>
              <span className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 96, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em" }}>{autopay ? 25 : 30}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 14, marginLeft: 8 }}>/ month</span>
            </div>
            {autopay && <div style={{ color: "#8FBE8F", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 24 }}>Autopay discount applied · save $60/yr</div>}
            {!autopay && <div style={{ color: "var(--text-muted)", fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 24 }}>Switch to autopay anytime to save</div>}
            <hr className="gold-rule" style={{ margin: "24px 0" }}/>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", color: "var(--ivory-300)", fontSize: 14, lineHeight: 1.9 }}>
              {[
                "Access to all twelve tables, all open hours",
                "Reserved seating for tournaments — members register first",
                "Digital membership card via PokerAtlas",
                "Members-only Slack and game alerts",
                "Comp drinks Tuesday & Thursday after 9 PM",
                "Pause membership for one month per year",
              ].map((f, i) => (
                <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0" }}>
                  <Icon name="check" size={16} color="#C9A24A" stroke={2}/>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button className="btn btn-primary btn-lg" style={{ width: "100%", marginTop: 32 }} onClick={() => onNav("signup")}>Apply for Membership</button>
            <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 11, marginTop: 16, letterSpacing: "0.1em" }}>$50 one-time application fee · Refundable if declined</div>
          </div>

          {/* Time pack — hero deal */}
          <div className="card" style={{ position: "relative", padding: 40, background: "linear-gradient(160deg, #1F1A12 0%, #0B0B0B 70%)", border: "1px solid var(--gold-400)", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -40, right: -40, opacity: 0.05 }}>
              <Chip size={280} showLaurel={true}/>
            </div>
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <span className="pill" style={{ background: "var(--gold-grad)", color: "#0B0B0B", border: "none" }}>Members' Deal</span>
                <span className="pill">33% Bonus</span>
              </div>
              <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, marginBottom: 8 }}>The Time Pack</h3>
              <p style={{ color: "var(--ivory-300)", fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
                Pay $200, get $300 in seat-time credit. Burns at $12/hour, billed by the minute. Doesn't expire.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 24, padding: "20px 0", borderTop: "1px solid var(--border-faint)", borderBottom: "1px solid var(--border-faint)" }}>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>You Pay</div>
                  <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 56, fontWeight: 600, lineHeight: 1, marginTop: 4 }}>$200</div>
                </div>
                <Icon name="arrowRight" size={28} color="#C9A24A" stroke={1.2}/>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>You Get</div>
                  <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 56, fontWeight: 600, lineHeight: 1, marginTop: 4 }}>$300</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>≈ 25 hours of seat-time</div>
                </div>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", color: "var(--ivory-300)", fontSize: 13, lineHeight: 1.9 }}>
                {[
                  "Stack multiple packs — credit accrues",
                  "Step away for dinner, the meter pauses",
                  "No expiration. No fine print.",
                  "Members only — autopay required",
                ].map((f, i) => (
                  <li key={i} style={{ display: "flex", gap: 12, padding: "4px 0" }}>
                    <Suit kind="diamond" size={11} color="#C9A24A"/>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button className="btn btn-primary btn-lg" style={{ width: "100%", marginTop: 28 }} onClick={() => onNav("signup")}>Add Time Pack at Signup</button>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: "80px 40px", maxWidth: 1280, margin: "0 auto", borderTop: "1px solid var(--border-faint)" }}>
        <div className="eyebrow" style={{ marginBottom: 16, textAlign: "center" }}>How It Works</div>
        <h2 className="section-title" style={{ fontSize: 44, textAlign: "center", marginBottom: 60 }}>From <em className="gold-text" style={{ fontStyle: "italic" }}>application</em> to first hand.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32 }}>
          {[
            { n: "I", title: "Apply", body: "Five minutes. Name, photo of your ID, and which membership you want." },
            { n: "II", title: "Approve", body: "We review within 24 hours. Most members hear back same-day." },
            { n: "III", title: "Activate", body: "Your digital card is issued via PokerAtlas. Show it at the door." },
            { n: "IV", title: "Sit Down", body: "Pick a table. The meter starts when you sit, pauses when you stand." },
          ].map((s, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--gold-400)", paddingTop: 24 }}>
              <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 14, letterSpacing: "0.4em", marginBottom: 12 }}>{s.n}</div>
              <h4 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 24, marginBottom: 12 }}>{s.title}</h4>
              <p style={{ color: "var(--ivory-400)", fontSize: 14, lineHeight: 1.7 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "80px 40px 100px", maxWidth: 880, margin: "0 auto" }}>
        <div className="eyebrow" style={{ marginBottom: 16, textAlign: "center" }}>Questions</div>
        <h2 className="section-title" style={{ fontSize: 44, textAlign: "center", marginBottom: 48 }}>Asked <em className="gold-text" style={{ fontStyle: "italic" }}>and answered</em>.</h2>
        {[
          ["Is this legal?", "Yes. We are a private social club operating under the state's social-gaming statutes. The house collects no rake. Revenue is membership dues and member-purchased seat time. We're licensed, audited, and we'll show you the paperwork."],
          ["What's the catch with the time pack?", "There isn't one. $200 buys $300 of seat-time credit, billed at $12/hour by the minute. The math is in your favor because we'd rather you stay in the room and play another hand than overthink the meter."],
          ["Can I bring a guest?", "Members can bring one guest per visit. Guests pay a $25 day-rate plus the same $12/hour seat time. After three visits, a guest must apply for membership."],
          ["What if I want to cancel?", "Cancel anytime from the portal. Your time wallet keeps any remaining credit; you can come back as a guest to use it down."],
          ["Do you deal anything besides Hold'em?", "Tuesday and Thursday we run PLO and PLO/8. Mixed games (HORSE, 8-Game) form on request — usually Saturdays. Tell us what you want and we'll seat it."],
        ].map(([q, a], i) => <FaqRow key={i} q={q} a={a}/>)}
      </section>
    </div>
  );
};

const FaqRow = ({ q, a }) => {
  const [open, setOpen] = useS5(false);
  return (
    <div style={{ borderBottom: "1px solid var(--border-faint)" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", textAlign: "left", padding: "24px 0", border: 0, background: "transparent",
        display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
        color: "var(--ivory-200)", fontFamily: "Cormorant Garamond, serif", fontSize: 22,
      }}>
        <span>{q}</span>
        <span style={{ color: "var(--gold-400)", transform: open ? "rotate(45deg)" : "rotate(0)", transition: "transform 220ms" }}>
          <Icon name="plus" size={18}/>
        </span>
      </button>
      {open && <div style={{ paddingBottom: 24, color: "var(--ivory-300)", fontSize: 15, lineHeight: 1.7, maxWidth: 720 }}>{a}</div>}
    </div>
  );
};

// ============================================================
// CONTACT
// ============================================================
const ContactScreen = ({ onNav }) => (
  <div>
    <section style={{ padding: "100px 40px 60px", textAlign: "center", maxWidth: 1280, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 16 }}>Find Us</div>
      <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 88, lineHeight: 1, marginBottom: 24 }}>414 <em className="gold-text" style={{ fontStyle: "italic" }}>Walnut Street</em></h1>
      <p style={{ color: "var(--ivory-300)", fontSize: 17, lineHeight: 1.6 }}>Wichita, Kansas · 67202<br/>Behind the unmarked door, between the cigar shop and the tailor.</p>
    </section>

    <section style={{ padding: "20px 40px 100px", maxWidth: 1280, margin: "0 auto", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 32 }}>
      {/* Map */}
      <div className="card card-bordered" style={{ padding: 0, overflow: "hidden", aspectRatio: "1.4/1", position: "relative" }}>
        <svg viewBox="0 0 800 540" style={{ width: "100%", height: "100%", display: "block" }}>
          <rect width="800" height="540" fill="#0E0D0B"/>
          {/* Streets */}
          {[100, 220, 340, 460, 580, 700].map(x => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="540" stroke="#3A342C" strokeWidth="1"/>)}
          {[80, 180, 280, 380, 480]. map(y => <line key={`h${y}`} x1="0" y1={y} x2="800" y2={y} stroke="#3A342C" strokeWidth="1"/>)}
          {/* Highlighted street */}
          <line x1="0" y1="280" x2="800" y2="280" stroke="#C9A24A" strokeWidth="2" opacity="0.6"/>
          <text x="20" y="270" fill="#C9A24A" fontSize="11" letterSpacing="3">WALNUT ST</text>
          {/* Buildings */}
          {[[110,220,80,40],[290,210,110,50],[480,200,90,60],[610,220,80,40],[120,300,90,50],[280,310,80,40],[450,310,140,40],[610,320,80,40]].map((b, i) => <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} fill="#1A1816" stroke="#3A342C"/>)}
          {/* Pin */}
          <g transform="translate(400, 280)">
            <circle r="36" fill="#C9A24A" opacity="0.15"/>
            <circle r="22" fill="#C9A24A" opacity="0.25"/>
            <g transform="translate(-12, -28)">
              <Chip size={24}/>
            </g>
          </g>
          <text x="412" y="320" fill="#F4D27A" fontFamily="Cormorant Garamond, serif" fontSize="18" letterSpacing="1">Members Only</text>
        </svg>
        <div style={{ position: "absolute", bottom: 16, right: 16 }}>
          <button className="btn btn-sm">Open in Maps <Icon name="arrowRight" size={12}/></button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card card-bordered">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <Icon name="mapPin" size={20} color="#C9A24A"/>
            <div>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>Address</div>
              <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 20 }}>414 Walnut Street</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Wichita, Kansas 67202</div>
            </div>
          </div>
        </div>
        <div className="card card-bordered">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <Icon name="phone" size={20} color="#C9A24A"/>
            <div>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>Phone</div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 16, color: "var(--gold-300)" }}>(316) 555-0142</div>
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Member services, weekdays 10–6</div>
            </div>
          </div>
        </div>
        <div className="card card-bordered">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <Icon name="creditCard" size={20} color="#C9A24A"/>
            <div>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>Parking</div>
              <div style={{ color: "var(--ivory-300)", fontSize: 13, lineHeight: 1.7 }}>Members park free in the rear lot. Visitors: street meters until 9 PM, then unrestricted.</div>
            </div>
          </div>
        </div>
        <div className="card card-bordered">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <Icon name="info" size={20} color="#C9A24A"/>
            <div>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>The Door</div>
              <div style={{ color: "var(--ivory-300)", fontSize: 13, lineHeight: 1.7 }}>Press the buzzer marked "MO." Have your member card ready. ID required, every visit, no exceptions.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
);

Object.assign(window, { MembershipScreen, ContactScreen, FaqRow });
