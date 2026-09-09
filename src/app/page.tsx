/**
 * Phase 0 holding page. Phase 1 replaces this with the catalogue.
 *
 * Mobile-first throughout: Kenyan e-commerce traffic is overwhelmingly phone
 * based, so the small-screen layout is the default and wider screens are the
 * progressive enhancement.
 */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs tracking-widest text-neutral-500 uppercase">Nairobi</p>

      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        The Thrift Plug
      </h1>

      <p className="mt-5 text-lg text-pretty text-neutral-600 dark:text-neutral-400">
        Handpicked secondhand fashion. Every piece is one of one — when it is gone, it is gone.
      </p>

      <p className="mt-10 border-t border-neutral-200 pt-6 text-sm text-neutral-500 dark:border-neutral-800">
        The shop is being built. The catalogue opens soon.
      </p>
    </main>
  );
}
