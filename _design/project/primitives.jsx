/* global React */
const { useState, useEffect, useRef, useMemo } = React;

// ============================================================
// SVG PRIMITIVES — chip, laurel, suits, wordmark
// ============================================================

const Chip = ({ size = 80, label = "MO", showLaurel = true }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" style={{ display: "block" }}>
    <defs>
      <radialGradient id={`chip-bg-${size}`} cx="50%" cy="40%" r="60%">
        <stop offset="0%" stopColor="#2a2620" />
        <stop offset="60%" stopColor="#15130F" />
        <stop offset="100%" stopColor="#0B0B0B" />
      </radialGradient>
      <linearGradient id={`gold-edge-${size}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F4D27A" />
        <stop offset="50%" stopColor="#C9A24A" />
        <stop offset="100%" stopColor="#6E5520" />
      </linearGradient>
      <linearGradient id={`gold-laurel-${size}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#F4D27A" />
        <stop offset="100%" stopColor="#A8842F" />
      </linearGradient>
    </defs>
    {/* Outer dashes — alternating black and ivory */}
    <circle cx="100" cy="100" r="96" fill={`url(#gold-edge-${size})`} />
    {[...Array(16)].map((_, i) => {
      const angle = (i * 22.5) - 11.25;
      const isIvory = i % 2 === 0;
      return (
        <path
          key={i}
          d={`M 100 100 L ${100 + 96 * Math.cos((angle - 11) * Math.PI / 180)} ${100 + 96 * Math.sin((angle - 11) * Math.PI / 180)} A 96 96 0 0 1 ${100 + 96 * Math.cos((angle + 11) * Math.PI / 180)} ${100 + 96 * Math.sin((angle + 11) * Math.PI / 180)} Z`}
          fill={isIvory ? "#F4EDE0" : "#0B0B0B"}
          opacity={isIvory ? 0.88 : 1}
        />
      );
    })}
    {/* Inner gold ring */}
    <circle cx="100" cy="100" r="78" fill="none" stroke={`url(#gold-edge-${size})`} strokeWidth="2" />
    <circle cx="100" cy="100" r="74" fill={`url(#chip-bg-${size})`} />
    <circle cx="100" cy="100" r="70" fill="none" stroke="#C9A24A" strokeWidth="0.5" opacity="0.5" />
    {/* Laurel */}
    {showLaurel && (
      <g fill={`url(#gold-laurel-${size})`} opacity="0.85">
        {[...Array(7)].map((_, i) => {
          const a = 130 + i * 12;
          const r = 60;
          const cx = 100 + r * Math.cos(a * Math.PI / 180);
          const cy = 100 + r * Math.sin(a * Math.PI / 180);
          return <ellipse key={`l-${i}`} cx={cx} cy={cy} rx="3.5" ry="8" transform={`rotate(${a + 90} ${cx} ${cy})`} />;
        })}
        {[...Array(7)].map((_, i) => {
          const a = 50 - i * 12;
          const r = 60;
          const cx = 100 + r * Math.cos(a * Math.PI / 180);
          const cy = 100 + r * Math.sin(a * Math.PI / 180);
          return <ellipse key={`r-${i}`} cx={cx} cy={cy} rx="3.5" ry="8" transform={`rotate(${a + 90} ${cx} ${cy})`} />;
        })}
      </g>
    )}
    {/* Center label */}
    <text
      x="100" y="108"
      textAnchor="middle"
      fontFamily="Cormorant Garamond, serif"
      fontWeight="600"
      fontSize="32"
      fill={`url(#gold-laurel-${size})`}
      letterSpacing="2"
    >{label}</text>
  </svg>
);

const Wordmark = ({ size = "lg", showSubtitle = true }) => {
  const map = { sm: { top: 14, sub: 7 }, md: { top: 22, sub: 9 }, lg: { top: 36, sub: 11 }, xl: { top: 64, sub: 16 }, hero: { top: 120, sub: 28 } };
  const sz = map[size];
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      <div className="gold-text" style={{
        fontFamily: "Cormorant Garamond, serif",
        fontSize: sz.top,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}>POKER</div>
      {showSubtitle && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: sz.top * 0.06 }}>
            <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #C9A24A)" }} />
            <span style={{ color: "#C9A24A", fontSize: sz.sub * 0.7 }}>♦</span>
            <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, #C9A24A, transparent)" }} />
          </div>
          <div className="gold-text" style={{
            fontFamily: "Cormorant Garamond, serif",
            fontSize: sz.sub,
            fontWeight: 500,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            marginTop: sz.top * 0.05,
          }}>Social Club</div>
        </>
      )}
    </div>
  );
};

const Suit = ({ kind = "spade", size = 14, color }) => {
  const c = color || (kind === "heart" || kind === "diamond" ? "#D6584C" : "#F4EDE0");
  const paths = {
    spade: "M12 2 C 7 7, 4 10, 4 14 C 4 17, 7 18, 9 16 C 9 18, 8 20, 7 21 L 17 21 C 16 20, 15 18, 15 16 C 17 18, 20 17, 20 14 C 20 10, 17 7, 12 2 Z",
    heart: "M12 21 C 4 14, 2 10, 4 7 C 6 4, 10 5, 12 8 C 14 5, 18 4, 20 7 C 22 10, 20 14, 12 21 Z",
    diamond: "M12 2 L 21 12 L 12 22 L 3 12 Z",
    club: "M12 2 C 9 2, 7 4, 7 7 C 7 8, 7 9, 8 10 C 6 9, 3 11, 3 14 C 3 17, 6 18, 8 17 C 8 19, 7 21, 6 22 L 18 22 C 17 21, 16 19, 16 17 C 18 18, 21 17, 21 14 C 21 11, 18 9, 16 10 C 17 9, 17 8, 17 7 C 17 4, 15 2, 12 2 Z",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d={paths[kind]} fill={c} />
    </svg>
  );
};

const Laurel = ({ width = 200, color = "#C9A24A", opacity = 0.5 }) => (
  <svg width={width} height={width * 0.5} viewBox="0 0 400 200" style={{ display: "block" }}>
    <defs>
      <linearGradient id="laurel-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F4D27A" />
        <stop offset="100%" stopColor="#A8842F" />
      </linearGradient>
    </defs>
    <g fill="url(#laurel-g)" opacity={opacity}>
      {[...Array(9)].map((_, i) => {
        const t = i / 8;
        const x = 30 + t * 150;
        const y = 180 - Math.sin(t * Math.PI) * 130;
        const rot = -30 + t * 50;
        return <ellipse key={`l-${i}`} cx={x} cy={y} rx="5" ry="14" transform={`rotate(${rot} ${x} ${y})`} />;
      })}
      {[...Array(9)].map((_, i) => {
        const t = i / 8;
        const x = 370 - t * 150;
        const y = 180 - Math.sin(t * Math.PI) * 130;
        const rot = 30 - t * 50;
        return <ellipse key={`r-${i}`} cx={x} cy={y} rx="5" ry="14" transform={`rotate(${rot} ${x} ${y})`} />;
      })}
    </g>
  </svg>
);

// Lucide-style icon set
const Icon = ({ name, size = 18, stroke = 1.5, color = "currentColor" }) => {
  const paths = {
    menu: "M3 6h18M3 12h18M3 18h18",
    x: "M18 6 6 18M6 6l12 12",
    chevronRight: "m9 6 6 6-6 6",
    chevronLeft: "m15 6-6 6 6 6",
    chevronDown: "m6 9 6 6 6-6",
    arrowRight: "M5 12h14M13 6l6 6-6 6",
    check: "M20 6 9 17l-5-5",
    user: "M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    clock: "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
    calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    creditCard: "M3 10h18M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
    mapPin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    receipt: "M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2zM8 7h8M8 12h8M8 17h5",
    trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z",
    activity: "M22 12h-4l-3 9L9 3l-3 9H2",
    barcode: "M3 5v14M6 5v14M9 5v14M13 5v14M16 5v14M20 5v14",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    sparkle: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1",
    pause: "M6 4h4v16H6zM14 4h4v16h-4z",
    refresh: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
    info: "M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
    alert: "M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
    search: "M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
    edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
    flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22V15",
    users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    layers: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
      <path d={paths[name]} />
    </svg>
  );
};

Object.assign(window, { Chip, Wordmark, Suit, Laurel, Icon });
