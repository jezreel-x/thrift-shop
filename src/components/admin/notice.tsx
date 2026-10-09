/** A green "it worked" line at the top of an admin page. */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="mb-6 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
    >
      {children}
    </p>
  );
}
