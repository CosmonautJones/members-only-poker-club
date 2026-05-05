/* global React, Chip, Wordmark, Suit, Laurel, Icon, MembershipCard, TimeWallet */
const { useState: useS9 } = React;

const DesignSystemScreen = () => (
  <div style={{ padding: "60px 40px", maxWidth: 1280, margin: "0 auto" }}>
    <div style={{ marginBottom: 60 }}>
      <div className="eyebrow" style={{ marginBottom: 16 }}>Design System</div>
      <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 72, lineHeight: 1 }}>The <em className="gold-text" style={{ fontStyle: "italic" }}>System</em></h1>
      <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 12, maxWidth: 600 }}>Tokens, primitives, components, and states. Use as a reference for consistent build-out.</p>
    </div>

    {/* COLORS */}
    <Section title="Colors" sub="Deep matte black, metallic gold, warm ivory. Crimson reserved for hearts and danger.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        {[
          ["#0B0B0B", "Ink 900", "Primary surface"],
          ["#1A1816", "Ink 800", "Card"],
          ["#3A342C", "Ink 600", "Divider"],
          ["#F4D27A", "Gold 200", "Highlight"],
          ["#C9A24A", "Gold 400", "Primary"],
          ["#A8842F", "Gold 500", "Deep gold"],
          ["#F4EDE0", "Ivory 200", "Text"],
          ["#8C8470", "Ivory 500", "Muted text"],
          ["#B43A2E", "Crimson", "Hearts · danger"],
          ["#1F3A2E", "Felt Green", "Cash tables"],
          ["#6F9E6F", "Success", "Live · paid"],
          ["#C9A24A", "Warning", "Wait · attention"],
        ].map(([c, n, sub]) => (
          <div key={n}>
            <div style={{ aspectRatio: "1.4/1", background: c, borderRadius: 8, border: "1px solid var(--border-faint)" }}/>
            <div style={{ marginTop: 8, fontFamily: "Cormorant Garamond, serif", fontSize: 14 }}>{n}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "JetBrains Mono, monospace" }}>{c}</div>
            <div style={{ color: "var(--text-dim)", fontSize: 10 }}>{sub}</div>
          </div>
        ))}
      </div>
    </Section>

    {/* TYPE */}
    <Section title="Typography" sub="Cormorant Garamond display + Inter body + JetBrains Mono for IDs and figures.">
      <div className="card card-bordered" style={{ padding: 32 }}>
        <div style={{ borderBottom: "1px solid var(--border-faint)", paddingBottom: 24, marginBottom: 24 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>Display · Cormorant Garamond 96/100</div>
          <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 96, lineHeight: 1, fontWeight: 500 }}>A chair <em className="gold-text" style={{ fontStyle: "italic" }}>waiting</em></div>
        </div>
        <div style={{ borderBottom: "1px solid var(--border-faint)", paddingBottom: 24, marginBottom: 24 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>H2 · 44/52 · 500</div>
          <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 44, fontWeight: 500 }}>Twelve tables. One bar.</div>
        </div>
        <div style={{ borderBottom: "1px solid var(--border-faint)", paddingBottom: 24, marginBottom: 24 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>Body · Inter 14/22</div>
          <div style={{ color: "var(--ivory-300)", maxWidth: 600 }}>The room runs on memberships and seat-time. No rake. No tip-jar dealer fees. No "comp" promises we can't keep.</div>
        </div>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>Mono · JetBrains Mono 13</div>
          <div style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--gold-300)" }}>MO·00347·9241·8806</div>
        </div>
      </div>
    </Section>

    {/* PRIMITIVES */}
    <Section title="Brand Primitives" sub="Chip, wordmark, suits, laurel. Used across every surface.">
      <div className="card card-bordered" style={{ padding: 40, display: "flex", gap: 48, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        <Chip size={120}/>
        <Wordmark size="lg"/>
        <div style={{ display: "flex", gap: 16 }}>
          <Suit kind="heart" size={36}/>
          <Suit kind="diamond" size={36}/>
          <Suit kind="club" size={36}/>
          <Suit kind="spade" size={36}/>
        </div>
        <Laurel width={240} opacity={0.6}/>
      </div>
    </Section>

    {/* SIGNATURE COMPONENTS */}
    <Section title="Signature Components" sub="Membership card and time wallet — the two pieces members will screenshot.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24, alignItems: "start" }}>
        <div className="card card-bordered" style={{ padding: 32, display: "flex", justifyContent: "center", alignItems: "center", background: "radial-gradient(ellipse at center, #1A1816, #0B0B0B 80%)" }}>
          <MembershipCard/>
        </div>
        <TimeWallet minutesRemaining={412} totalPrepaid={1500} ticking={true}/>
      </div>
    </Section>

    {/* BUTTONS */}
    <Section title="Buttons" sub="Primary uses brushed-gold gradient with shimmer-on-hover. Ghost is text-with-underline-on-hover.">
      <div className="card card-bordered" style={{ padding: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <Row2 label="Primary"><button className="btn btn-primary">Apply for Membership</button><button className="btn btn-primary btn-sm">Save</button><button className="btn btn-primary btn-lg">Add Time Pack</button></Row2>
          <Row2 label="Secondary"><button className="btn">Tour the Club</button><button className="btn btn-sm">Add me</button><button className="btn btn-lg">Tonight's Games</button></Row2>
          <Row2 label="Ghost"><button className="btn btn-ghost">View all →</button><button className="btn btn-ghost btn-sm">Cancel</button></Row2>
          <Row2 label="Danger"><button className="btn" style={{ borderColor: "var(--crimson)", color: "var(--crimson-light)" }}>Cancel membership</button></Row2>
        </div>
      </div>
    </Section>

    {/* PILLS / TAGS */}
    <Section title="Pills, Tags, Eyebrows">
      <div className="card card-bordered" style={{ padding: 32, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span className="pill">Member</span>
        <span className="pill pill-live">Live · Now</span>
        <span className="pill">Founding · MMXXIV</span>
        <span className="pill" style={{ background: "var(--gold-grad)", color: "#0B0B0B", border: "none" }}>33% Bonus</span>
        <span style={{ fontSize: 11, color: "#8FBE8F", letterSpacing: "0.1em", textTransform: "uppercase" }}>● Active</span>
        <span style={{ fontSize: 11, color: "var(--warning)", letterSpacing: "0.1em", textTransform: "uppercase" }}>● Pending</span>
        <span style={{ fontSize: 11, color: "var(--crimson-light)", letterSpacing: "0.1em", textTransform: "uppercase" }}>● Suspended</span>
        <div className="eyebrow">Members Only · MMXXIV</div>
      </div>
    </Section>

    {/* FORMS */}
    <Section title="Form Components">
      <div className="card card-bordered" style={{ padding: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="field"><label className="field-label">Email</label><input className="input" placeholder="m.holloway@example.com"/></div>
        <div className="field"><label className="field-label">Member #</label><input className="input" placeholder="00347" style={{ fontFamily: "JetBrains Mono, monospace" }}/></div>
        <div className="field"><label className="field-label">Disabled</label><input className="input" disabled value="Read only" style={{ opacity: 0.5 }}/></div>
        <div className="field"><label className="field-label" style={{ color: "var(--crimson-light)" }}>Error</label><input className="input" defaultValue="bad@" style={{ borderColor: "var(--crimson)" }}/><div style={{ color: "var(--crimson-light)", fontSize: 12 }}>Doesn't look like an email.</div></div>
      </div>
    </Section>

    {/* STATES CATALOG */}
    <Section title="States Catalog" sub="Empty, loading, error, success. Every screen specifies all four.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <StateCard title="Empty">
          <div style={{ textAlign: "center", padding: 24 }}>
            <Suit kind="diamond" size={36} color="#3A342C"/>
            <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 18, marginTop: 16 }}>No sessions yet</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>Sit down. We'll log it.</div>
          </div>
        </StateCard>
        <StateCard title="Loading">
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ width: 36, height: 36, margin: "0 auto", borderRadius: "50%", border: "2px solid var(--ink-700)", borderTopColor: "var(--gold-400)", animation: "spin 800ms linear infinite" }}/>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 16, letterSpacing: "0.1em", textTransform: "uppercase" }}>Counting chips…</div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </StateCard>
        <StateCard title="Error">
          <div style={{ textAlign: "center", padding: 24 }}>
            <Icon name="alert" size={28} color="#D6584C"/>
            <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 18, marginTop: 12 }}>Charge declined</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>Stripe: card_declined · 402</div>
          </div>
        </StateCard>
        <StateCard title="Success">
          <div style={{ textAlign: "center", padding: 24 }}>
            <Icon name="check" size={28} color="#8FBE8F" stroke={2.5}/>
            <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 18, marginTop: 12 }}>Time added</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>+$300.00 · Receipt sent</div>
          </div>
        </StateCard>
      </div>
    </Section>

    {/* MOTION */}
    <Section title="Motion" sub="Slow, weighted, cinematic. The gold shimmers; the cards settle. No bounces.">
      <div className="card card-bordered" style={{ padding: 32, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
        <div><div style={{ color: "var(--gold-300)", fontFamily: "JetBrains Mono, monospace" }}>140ms</div>Hover, focus rings</div>
        <div><div style={{ color: "var(--gold-300)", fontFamily: "JetBrains Mono, monospace" }}>220ms</div>State changes</div>
        <div><div style={{ color: "var(--gold-300)", fontFamily: "JetBrains Mono, monospace" }}>380ms</div>Modal in/out, toast</div>
        <div><div style={{ color: "var(--gold-300)", fontFamily: "JetBrains Mono, monospace" }}>720ms</div>Card flip · gold shimmer sweep</div>
      </div>
    </Section>
  </div>
);

const Section = ({ title, sub, children }) => (
  <section style={{ marginBottom: 60 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid var(--gold-400)" }}>
      <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32 }}>{title}</h2>
      {sub && <div style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 500, textAlign: "right" }}>{sub}</div>}
    </div>
    {children}
  </section>
);

const Row2 = ({ label, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <div style={{ width: 100, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{children}</div>
  </div>
);

const StateCard = ({ title, children }) => (
  <div className="card card-bordered" style={{ padding: 0 }}>
    <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-faint)", fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--gold-300)" }}>{title}</div>
    {children}
  </div>
);

Object.assign(window, { DesignSystemScreen });
