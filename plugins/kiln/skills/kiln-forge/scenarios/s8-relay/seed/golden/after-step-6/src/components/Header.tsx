export function Header() {
  return (
    <header className="rounded-3xl bg-slate-900 px-6 py-8 text-slate-50 shadow-lg">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">
        <span className="text-sky-400">&#9670;</span> Personal Dashboard
      </p>
      <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Linkah
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
        Save useful pages fast, keep them local, and build a cleaner link
        collection over time.
      </p>
    </header>
  );
}
