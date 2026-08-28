/** The queue stores RFC 3339 UTC; the front desk reads the clock on the wall. */
export function time(submittedAt: string): string {
  const at = new Date(submittedAt);
  if (Number.isNaN(at.getTime())) {
    return submittedAt;
  }
  return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
