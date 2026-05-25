// @paradigm: sql
// StalenessLabel — shows an epoch freshness indicator.
// CF-C6-AS-OF-STAMP-1: binds the card's displayed data_epoch.
// The UI renders this when the insight epoch differs from the card epoch.
// CF-C6-RENDER-ONLY-1: never recomputes the epoch; renders server-provided value.

interface StalenessLabelProps {
  dataEpoch: Date | string;
  className?: string;
}

export function StalenessLabel({ dataEpoch, className = '' }: StalenessLabelProps) {
  const epochDate = typeof dataEpoch === 'string' ? new Date(dataEpoch) : dataEpoch;

  // ISO UTC display only — never reformat to local time in a way that changes the value.
  const displayTime = epochDate.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <span
      role="status"
      aria-label={`Data as of ${displayTime} IST`}
      className={`text-xs text-gray-500 inline-flex items-center gap-1 ${className}`}
    >
      <span aria-hidden="true">&#x1F552;</span>
      {displayTime} IST
    </span>
  );
}
