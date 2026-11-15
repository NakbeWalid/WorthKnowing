/** Garde-fous appliqués aux textes produits par un modèle. */

/** Nombres d'un texte, normalisés (« 30 000 » → 30000, « 12,5 » → 12.5). */
export function numbersOf(text: string): string[] {
  const joined = text.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, '$1');
  return (joined.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(',', '.'))));
}

/**
 * Nombres du texte qui n'apparaissent pas dans les faits fournis au modèle (chiffres inventés ou recalculés).
 * Les petits entiers (≤ 10 : « 2 paramètres », « 3 règles ») sont tolérés.
 */
export function inventedNumbers(text: string, facts: string): string[] {
  const known = new Set(numbersOf(facts));
  return numbersOf(text).filter((n) => !known.has(n) && Number(n) > 10);
}
/**
 * Durées (« 3-4 jours », « 24 heures ») absentes des faits fournis : le modèle calcule alors lui-même un délai
 * entre une nouvelle et un trade, ce que seules les dates des faits permettent d'affirmer. Les petits entiers
 * tolérés par `inventedNumbers` n'attrapent pas ce cas.
 */
export function inventedDurations(text: string, facts: string): string[] {
  const unit = /\d+(?:\s*(?:-|–|à|ou|ou de)\s*\d+)?\s*(?:jours?|heures?|semaines?|mois|h)\b/gi;
  const norm = (m: string) => m.toLowerCase().replace(/\s+/g, ' ');
  const known = new Set((facts.match(unit) ?? []).map(norm));
  return (text.match(unit) ?? []).map(norm).filter((m) => !known.has(m));
}
