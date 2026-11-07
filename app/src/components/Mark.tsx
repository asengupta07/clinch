/** Clinch logo (transparent PNG in public/). Size it with className, e.g. "size-5". */
export function Mark({ className = "" }: { className?: string }) {
  return <img src="/logo-128.png" alt="" aria-hidden width={128} height={128} draggable={false} className={`clinch-mark shrink-0 select-none object-contain ${className}`} />;
}
