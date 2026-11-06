/** Clinch mark: a rising price ladder ending in a clinch. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M3 19.5h4.5V15H12v-4.5h4.5V6H21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21" cy="6" r="1.9" fill="var(--accent, #8fe0b8)" />
    </svg>
  );
}
