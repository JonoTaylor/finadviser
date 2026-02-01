export async function transactionFingerprint(
  date: string,
  amount: string,
  description: string,
): Promise<string> {
  const normalized = `${date.trim()}|${amount.trim()}|${description.trim().toLowerCase()}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
