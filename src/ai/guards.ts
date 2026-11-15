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
