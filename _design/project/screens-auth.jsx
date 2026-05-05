/* global React, Chip, Wordmark, Suit, Laurel, Icon, MembershipCard, TimeWallet, Row */
const { useState: useS6 } = React;

// ============================================================
// AUTH — Sign Up (multi-step) + Login
// ============================================================
const SignupScreen = ({ onNav }) => {
  const [step, setStep] = useS6(1);
  const [autopay, setAutopay] = useS6(true);
  const [addPack, setAddPack] = useS6(true);

  const Step = ({ n, label }) => (
    <div style={{ display: "flex", gap: 10, alignItems: "center", color: step >= n ? "var(--gold-300)" : "var(--text-dim)" }}>
      <span style={{
        width: 28, height: 28, borderRadius: "50%",
        border: `1px solid ${step >= n ? "var(--gold-400)" : "var(--border)"}`,
        background: step > n ? "var(--gold-grad)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "Cormorant Garamond, serif", fontSize: 13,
        color: step > n ? "#0B0B0B" : "inherit",
      }}>{step > n ? <Icon name="check" size={14} color="#0B0B0B" stroke={2.5}/> : n}</span>
      <span style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase" }}>{label}</span>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Chip size={64}/>
          <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 40, marginTop: 16 }}>Apply for Membership</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>Five minutes. We review within 24 hours.</p>
        </div>

        {/* Stepper */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 32, padding: "0 20px" }}>
          <Step n={1} label="Account"/>
          <div style={{ flex: 1, height: 1, background: step > 1 ? "var(--gold-400)" : "var(--border)", margin: "13px 12px 0" }}/>
          <Step n={2} label="Identity"/>
          <div style={{ flex: 1, height: 1, background: step > 2 ? "var(--gold-400)" : "var(--border)", margin: "13px 12px 0" }}/>
          <Step n={3} label="Plan"/>
          <div style={{ flex: 1, height: 1, background: step > 3 ? "var(--gold-400)" : "var(--border)", margin: "13px 12px 0" }}/>
          <Step n={4} label="Payment"/>
          <div style={{ flex: 1, height: 1, background: step > 4 ? "var(--gold-400)" : "var(--border)", margin: "13px 12px 0" }}/>
          <Step n={5} label="Done"/>
        </div>

        <div className="card card-bordered" style={{ padding: 40 }}>
          {step === 1 && (
            <div>
              <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 28, marginBottom: 8 }}>Create your account</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>This is how you'll sign in to the member portal.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div className="field"><label className="field-label">First name</label><input className="input" placeholder="Marcus"/></div>
                <div className="field"><label className="field-label">Last name</label><input className="input" placeholder="Holloway"/></div>
              </div>
              <div className="field" style={{ marginBottom: 16 }}><label className="field-label">Email</label><input className="input" placeholder="m.holloway@example.com" type="email"/></div>
              <div className="field" style={{ marginBottom: 16 }}><label className="field-label">Mobile</label><input className="input" placeholder="(316) 555-0199" type="tel"/></div>
              <div className="field" style={{ marginBottom: 24 }}><label className="field-label">Password</label><input className="input" type="password" placeholder="At least 12 characters"/></div>
              <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={() => setStep(2)}>Continue <Icon name="arrowRight" size={14} stroke={2}/></button>
            </div>
          )}
          {step === 2 && (
            <div>
              <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 28, marginBottom: 8 }}>Verify your identity</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>Required by state law. Members must be 21+. Your ID is encrypted at rest and never shared.</p>
              <div className="field" style={{ marginBottom: 16 }}><label className="field-label">Date of birth</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <input className="input" placeholder="MM"/><input className="input" placeholder="DD"/><input className="input" placeholder="YYYY"/>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 24 }}>
                <label className="field-label">Photo of government ID</label>
                <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 32, textAlign: "center", background: "var(--ink-850)" }}>
                  <Icon name="creditCard" size={28} color="#C9A24A"/>
                  <div style={{ marginTop: 12, color: "var(--ivory-300)", fontSize: 14 }}>Drop image, or <span style={{ color: "var(--gold-300)", textDecoration: "underline" }}>browse files</span></div>
                  <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 11 }}>JPG / PNG / HEIC · 10MB max</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button className="btn" onClick={() => setStep(1)}><Icon name="chevronLeft" size={14}/> Back</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(3)}>Continue <Icon name="arrowRight" size={14} stroke={2}/></button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div>
              <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 28, marginBottom: 8 }}>Choose your billing</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>Same membership. Save when you autopay.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
                <PlanOption selected={autopay} onSelect={() => setAutopay(true)} title="Autopay" price="$25" sub="/ month" tag="Save $60/yr"/>
                <PlanOption selected={!autopay} onSelect={() => setAutopay(false)} title="Monthly" price="$30" sub="/ month" tag="Cancel anytime"/>
              </div>
              <div style={{ background: "linear-gradient(160deg, #1F1A12, #0E0D0B)", border: "1px solid var(--gold-400)", borderRadius: 10, padding: 24, marginBottom: 24, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -30, right: -30, opacity: 0.06 }}><Chip size={180}/></div>
                <label style={{ display: "flex", gap: 16, alignItems: "flex-start", cursor: "pointer", position: "relative" }}>
                  <input type="checkbox" checked={addPack} onChange={e => setAddPack(e.target.checked)} style={{ marginTop: 4, accentColor: "#C9A24A", width: 18, height: 18 }}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <h3 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22 }}>Add a Time Pack</h3>
                      <div className="gold-text" style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 24, fontWeight: 600 }}>+$200</div>
                    </div>
                    <div style={{ color: "var(--ivory-300)", fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>Get $300 in seat-time credit (33% bonus). Roughly 25 hours at the table. No expiration.</div>
                  </div>
                </label>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button className="btn" onClick={() => setStep(2)}><Icon name="chevronLeft" size={14}/> Back</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(4)}>Continue <Icon name="arrowRight" size={14} stroke={2}/></button>
              </div>
            </div>
          )}
          {step === 4 && (
            <div>
              <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 28, marginBottom: 8 }}>Payment</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>Stripe processes your card. We never see the number.</p>
              {/* Order summary */}
              <div style={{ background: "var(--ink-850)", border: "1px solid var(--border-faint)", borderRadius: 10, padding: 20, marginBottom: 24, fontSize: 13 }}>
                <Row k="Membership" v={`${autopay ? "$25" : "$30"} / month`}/>
                {addPack && <Row k="Time Pack ($200 → $300 credit)" v="$200"/>}
                <Row k="Application fee (refundable if declined)" v="$50"/>
                <hr className="gold-rule" style={{ margin: "12px 0" }}/>
                <Row k={<span style={{ color: "var(--gold-300)", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>Today</span>} v={<span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 22, color: "var(--gold-200)" }}>${50 + (addPack ? 200 : 0) + (autopay ? 25 : 30)}.00</span>}/>
              </div>
              {/* Stripe-shaped fields */}
              <div className="field" style={{ marginBottom: 12 }}><label className="field-label">Card number</label><input className="input" placeholder="•••• •••• •••• ••••" style={{ fontFamily: "JetBrains Mono, monospace" }}/></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
                <div className="field"><label className="field-label">Expiry</label><input className="input" placeholder="MM/YY"/></div>
                <div className="field"><label className="field-label">CVC</label><input className="input" placeholder="•••"/></div>
                <div className="field"><label className="field-label">Zip</label><input className="input" placeholder="67202"/></div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button className="btn" onClick={() => setStep(3)}><Icon name="chevronLeft" size={14}/> Back</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(5)}>Submit Application</button>
              </div>
              <div style={{ textAlign: "center", color: "var(--text-dim)", fontSize: 11, marginTop: 16, letterSpacing: "0.08em", display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
                <Icon name="shield" size={12}/> Secured by Stripe · 256-bit encryption
              </div>
            </div>
          )}
          {step === 5 && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ display: "inline-block", padding: 24, background: "rgba(201, 162, 74, 0.08)", borderRadius: "50%", marginBottom: 24 }}>
                <Chip size={96}/>
              </div>
              <h2 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 36, marginBottom: 12 }}>Application <em className="gold-text" style={{ fontStyle: "italic" }}>received</em></h2>
              <p style={{ color: "var(--ivory-300)", fontSize: 15, lineHeight: 1.7, maxWidth: 460, margin: "0 auto 32px" }}>
                We'll review and respond within 24 hours. Watch your inbox — including spam, just in case. Once approved, your digital membership card is issued instantly.
              </p>
              <div className="diamond-divider" style={{ maxWidth: 280, margin: "0 auto 32px" }}><Suit kind="diamond" size={10} color="#C9A24A"/></div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button className="btn" onClick={() => onNav("home")}>Back to home</button>
                <button className="btn btn-primary" onClick={() => onNav("dashboard")}>Preview the Portal</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PlanOption = ({ selected, onSelect, title, price, sub, tag }) => (
  <button onClick={onSelect} style={{
    background: selected ? "linear-gradient(160deg, #1F1A12, #0E0D0B)" : "var(--ink-850)",
    border: `1px solid ${selected ? "var(--gold-400)" : "var(--border-faint)"}`,
    borderRadius: 10, padding: 20, textAlign: "left", cursor: "pointer",
    color: "inherit", transition: "all 220ms",
    boxShadow: selected ? "var(--gold-glow-soft)" : "none",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
      <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 18 }}>{title}</div>
      {selected && <Icon name="check" size={16} color="#C9A24A" stroke={2.5}/>}
    </div>
    <div style={{ display: "baseline", fontFamily: "Cormorant Garamond, serif" }}>
      <span className={selected ? "gold-text" : ""} style={{ fontSize: 36, fontWeight: 600, color: selected ? undefined : "var(--ivory-200)" }}>{price}</span>
      <span style={{ color: "var(--text-muted)", fontSize: 13, marginLeft: 4 }}>{sub}</span>
    </div>
    <div style={{ marginTop: 8, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: selected ? "#8FBE8F" : "var(--text-dim)" }}>{tag}</div>
  </button>
);

// ============================================================
// LOGIN
// ============================================================
const LoginScreen = ({ onNav }) => {
  const [forgot, setForgot] = useS6(false);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 40, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.03 }}>
        <div style={{ position: "absolute", left: -100, top: -100 }}><Chip size={500}/></div>
        <div style={{ position: "absolute", right: -150, bottom: -150 }}><Chip size={600}/></div>
      </div>
      <div style={{ width: "100%", maxWidth: 440, position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Chip size={64}/>
          <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 32, marginTop: 16 }}>{forgot ? "Reset password" : "Welcome back"}</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>{forgot ? "We'll email you a reset link." : "The room is open. Come on in."}</p>
        </div>
        <div className="card card-bordered" style={{ padding: 32 }}>
          <div className="field" style={{ marginBottom: 16 }}><label className="field-label">Email</label><input className="input" placeholder="m.holloway@example.com"/></div>
          {!forgot && <div className="field" style={{ marginBottom: 8 }}><label className="field-label">Password</label><input className="input" type="password" placeholder="••••••••••••"/></div>}
          {!forgot && <div style={{ textAlign: "right", marginBottom: 24 }}><a onClick={() => setForgot(true)} style={{ color: "var(--gold-300)", fontSize: 12, cursor: "pointer" }}>Forgot password?</a></div>}
          <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={() => onNav(forgot ? "login" : "dashboard")}>{forgot ? "Send reset link" : "Sign in"}</button>
          {forgot && <div style={{ textAlign: "center", marginTop: 16 }}><a onClick={() => setForgot(false)} style={{ color: "var(--gold-300)", fontSize: 12, cursor: "pointer" }}>← Back to sign in</a></div>}
        </div>
        <div style={{ textAlign: "center", marginTop: 24, color: "var(--text-muted)", fontSize: 13 }}>
          Not a member yet? <a onClick={() => onNav("signup")} style={{ color: "var(--gold-300)", cursor: "pointer" }}>Apply now</a>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { SignupScreen, LoginScreen, PlanOption });
