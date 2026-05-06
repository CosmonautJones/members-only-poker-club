// Slice 1 will replace this with the full HomeScreen ported from
// _design/screens-public-1.jsx. This stub exists so `pnpm dev` runs
// against the brand tokens immediately after `pnpm install`.

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="eyebrow mb-3">Est. MMXXIV · Private Social Club</div>
      <h1 className="mb-6 text-center font-display text-5xl leading-none md:text-display">
        A room. A game.
        <br />
        <em className="gold-text italic">A chair waiting for you.</em>
      </h1>
      <hr className="gold-rule-short my-6" />
      <p className="max-w-xl text-center text-lg leading-relaxed text-ivory-300">
        Site under construction. Members must be 21+. ID required at the door.
      </p>
    </main>
  );
}
