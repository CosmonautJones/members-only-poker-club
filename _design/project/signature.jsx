/* global React */
const { useState: useS2, useEffect: useE2, useRef: useR2, useMemo: useM2 } = React;

// ============================================================
// MEMBERSHIP CARD — black metal credit card, flips on tap
// ============================================================
const MembershipCard = ({ name = "Marcus W. Holloway", memberNo = "00347", joinDate = "MMXXIV", tier = "Founding Member", flipped: flippedProp, onFlip, scale = 1, interactive = true }) => {
  const [flipInternal, setFlipInternal] = useS2(false);
  const flipped = flippedProp !== undefined ? flippedProp : flipInternal;
  const handleFlip = () => {
    if (!interactive) return;
    if (onFlip) onFlip(!flipped);
    else setFlipInternal(!flipped);
  };

  return (
    <div style={{
      perspective: "1600px",
      width: 420 * scale,
      height: 264 * scale,
      cursor: interactive ? "pointer" : "default",
    }} onClick={handleFlip}>
      <div style={{
        position: "relative",
        width: "100%",
        height: "100%",
        transformStyle: "preserve-3d",
        transition: "transform 720ms cubic-bezier(0.2, 0.6, 0.2, 1)",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
      }}>
        {/* FRONT */}
        <div style={{
          position: "absolute", inset: 0,
          backfaceVisibility: "hidden",
          borderRadius: 16 * scale,
          overflow: "hidden",
          background: "linear-gradient(135deg, #1A1816 0%, #0B0B0B 50%, #1A1816 100%)",
          border: "1px solid rgba(201, 162, 74, 0.3)",
          boxShadow: "0 24px 60px -16px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(244, 210, 122, 0.12)",
          padding: 24 * scale,
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}>
          {/* Subtle laurel watermark */}
          <div style={{ position: "absolute", right: -40 * scale, bottom: -40 * scale, opacity: 0.08 }}>
            <Chip size={280 * scale} showLaurel={true} />
          </div>
          {/* Brushed gold corners */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 1,
            background: "linear-gradient(90deg, transparent, rgba(244, 210, 122, 0.4), transparent)",
          }} />
          {/* Top row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 2 }}>
            <div>
              <div style={{
                fontSize: 9 * scale,
                letterSpacing: "0.4em",
                color: "#C9A24A",
                fontWeight: 500,
                textTransform: "uppercase",
              }}>Members Only</div>
              <div className="gold-text" style={{
                fontFamily: "Cormorant Garamond, serif",
                fontSize: 22 * scale,
                fontWeight: 600,
                letterSpacing: "0.06em",
                marginTop: 2 * scale,
              }}>POKER · SOCIAL CLUB</div>
            </div>
            <div style={{
              fontSize: 8 * scale,
              letterSpacing: "0.3em",
              color: "#8C8470",
              textAlign: "right",
              textTransform: "uppercase",
            }}>{tier}<br/><span style={{ color: "#C9A24A" }}>Est. 2024</span></div>
          </div>

          {/* Center chip emblem */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 * scale, position: "relative", zIndex: 2 }}>
            <Chip size={56 * scale} label="MO" />
            <div>
              <div style={{ fontSize: 8 * scale, letterSpacing: "0.3em", color: "#8C8470", textTransform: "uppercase" }}>Member</div>
              <div style={{
                fontFamily: "Cormorant Garamond, serif",
                fontSize: 22 * scale,
                color: "#F4EDE0",
                fontWeight: 500,
                marginTop: 2 * scale,
                letterSpacing: "0.02em",
              }}>{name}</div>
            </div>
          </div>

          {/* Bottom row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", position: "relative", zIndex: 2 }}>
            <div>
              <div style={{ fontSize: 8 * scale, letterSpacing: "0.3em", color: "#8C8470", textTransform: "uppercase" }}>No.</div>
              <div style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 14 * scale,
                color: "#C9A24A",
                letterSpacing: "0.1em",
                marginTop: 2 * scale,
              }}>· {memberNo} ·</div>
            </div>
            <div style={{ display: "flex", gap: 4 * scale }}>
              <Suit kind="heart" size={10 * scale} />
              <Suit kind="diamond" size={10 * scale} />
              <Suit kind="club" size={10 * scale} />
              <Suit kind="spade" size={10 * scale} />
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 8 * scale, letterSpacing: "0.3em", color: "#8C8470", textTransform: "uppercase" }}>Since</div>
              <div style={{
                fontFamily: "Cormorant Garamond, serif",
                fontSize: 14 * scale,
                color: "#C9A24A",
                marginTop: 2 * scale,
              }}>{joinDate}</div>
            </div>
          </div>
        </div>

        {/* BACK */}
        <div style={{
          position: "absolute", inset: 0,
          backfaceVisibility: "hidden",
          transform: "rotateY(180deg)",
          borderRadius: 16 * scale,
          overflow: "hidden",
          background: "linear-gradient(135deg, #0B0B0B 0%, #1A1816 100%)",
          border: "1px solid rgba(201, 162, 74, 0.3)",
          boxShadow: "0 24px 60px -16px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column",
        }}>
          {/* Magstripe */}
          <div style={{
            height: 44 * scale,
            background: "linear-gradient(180deg, #000 0%, #1a1a1a 50%, #000 100%)",
            marginTop: 24 * scale,
            borderTop: "1px solid #000",
            borderBottom: "1px solid #000",
          }} />

          <div style={{ padding: `${20*scale}px ${24*scale}px`, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            {/* Barcode */}
            <div style={{
              background: "#F4EDE0",
              borderRadius: 4 * scale,
              padding: `${8 * scale}px ${12 * scale}px`,
              display: "flex", flexDirection: "column", gap: 4 * scale,
            }}>
              <div style={{ display: "flex", gap: 1, height: 32 * scale, alignItems: "stretch" }}>
                {[2,1,3,1,2,3,1,2,1,3,2,1,3,2,1,2,3,1,2,3,1,2,1,3,2,1,3,1,2,3,1,2,3,1,2,3,2,1,3,2,1,2,3,1,2,3,1,2,1,3].map((w, i) => (
                  <div key={i} style={{ width: w * 1.4 * scale, background: i % 2 === 0 ? "#0B0B0B" : "transparent" }} />
                ))}
              </div>
              <div style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 9 * scale,
                color: "#0B0B0B",
                letterSpacing: "0.4em",
                textAlign: "center",
              }}>MO·{memberNo}·9241·8806</div>
            </div>

            {/* Fine print */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 * scale }}>
              <div style={{
                fontSize: 7 * scale,
                color: "#8C8470",
                lineHeight: 1.5,
                letterSpacing: "0.04em",
                maxWidth: "70%",
              }}>
                Property of Members Only Poker Social Club. Non-transferable. Present at front desk on every visit. Lost cards: $25 replacement.
              </div>
              <div style={{ opacity: 0.6 }}>
                <Wordmark size="sm" showSubtitle={false} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// TIME WALLET — vault dial / counter, large gold numerals
// ============================================================
const TimeWallet = ({ minutesRemaining = 412, totalPrepaid = 1500, ticking = false }) => {
  const hours = Math.floor(minutesRemaining / 60);
  const mins = minutesRemaining % 60;
  const pct = (minutesRemaining / totalPrepaid) * 100;

  return (
    <div style={{
      background: "linear-gradient(180deg, #1A1816 0%, #0B0B0B 100%)",
      border: "1px solid rgba(201, 162, 74, 0.25)",
      borderRadius: 14,
      padding: 28,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Subtle suit watermark */}
      <div style={{ position: "absolute", right: -24, top: -24, opacity: 0.04 }}>
        <Suit kind="diamond" size={180} color="#C9A24A" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 11 }}>Time Wallet</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Billed by the minute · $12 / hour
          </div>
        </div>
        <span className="pill pill-live">{ticking ? "Seat 4 · Active" : "Idle"}</span>
      </div>

      {/* The dial */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 18, justifyContent: "center", padding: "20px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span className="gold-text" style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: 96,
            fontWeight: 600,
            lineHeight: 0.9,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}>{String(hours).padStart(2, "0")}</span>
          <span style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: 96,
            fontWeight: 400,
            lineHeight: 0.9,
            color: "rgba(201, 162, 74, 0.4)",
            margin: "0 2px",
            animation: ticking ? "pulse 1s ease-in-out infinite" : "none",
          }}>:</span>
          <span className="gold-text" style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: 96,
            fontWeight: 600,
            lineHeight: 0.9,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}>{String(mins).padStart(2, "0")}</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 20, fontSize: 10, letterSpacing: "0.3em", color: "var(--text-muted)", textTransform: "uppercase" }}>
        <div style={{ flex: 1, textAlign: "center" }}>Hours</div>
        <div style={{ flex: 1, textAlign: "center" }}>Minutes</div>
      </div>

      {/* Burn rate bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <span>Of {Math.floor(totalPrepaid / 60)}h prepaid</span>
          <span style={{ color: "#C9A24A", fontFamily: "JetBrains Mono, monospace" }}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 4, background: "rgba(201, 162, 74, 0.12)", borderRadius: 2, overflow: "hidden", position: "relative" }}>
          <div style={{
            position: "absolute", inset: 0, width: `${pct}%`,
            background: "linear-gradient(90deg, #A8842F, #F4D27A)",
          }} />
        </div>
      </div>

      <button className="btn btn-primary" style={{ width: "100%" }}>
        Add Time
        <Icon name="arrowRight" size={14} stroke={2} />
      </button>
    </div>
  );
};

Object.assign(window, { MembershipCard, TimeWallet });
