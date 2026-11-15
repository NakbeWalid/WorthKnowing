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
/**
 * Mots qui qualifient la vitesse d'une décision (« rapide », « précipitée », « instantané »…) ou son caractère
 * réfléchi. Un fait comme « décision prise en 60 s » ne dit pas si c'est rapide : c'est au lecteur d'en juger.
 * Les variantes courantes sont couvertes (accord, adverbe, nom). Le modèle ne suit pas toujours la consigne écrite
 * (3 cas sur 111 mesurés), donc le code vérifie. « impulsif » est volontairement absent : « impulsivity » est le
 * nom d'un paramètre du profil, présent légitimement dans les faits.
 */
const QUALIFIERS = [
  'rapides?', 'rapidement', 'rapidité', 'vite',
  'lente?s?', 'lentement', 'lenteur',
  'pr[ée]cipit[ée]e?s?', 'pr[ée]cipitamment', 'pr[ée]cipitation',
  'h[âa]tifs?', 'h[âa]tives?', 'h[âa]tivement', 'h[âa]te',
  'instantan[ée]e?s?', 'instantan[ée]ment', 'promptement',
  'imm[ée]diate?s?', 'imm[ée]diatement', // « précèdent immédiatement l'achat » : proximité que les faits n'établissent pas
  'exp[ée]ditifs?', 'exp[ée]ditives?',
  'r[ée]fl[ée]chie?s?', 'irr[ée]fl[ée]chie?s?',
];
// Bornes Unicode : \b ne gère pas les lettres accentuées, et « talent », « violent », « invite » ne doivent pas correspondre.
const QUALIFIER_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${QUALIFIERS.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
/** Qualificatifs de vitesse présents dans un texte (minuscules, sans doublon). */
export function qualifiersOf(text: string): string[] {
  return [...new Set((text.match(QUALIFIER_RE) ?? []).map((w) => w.toLowerCase()))];
}
/**
 * Qualificatifs du texte absents des faits fournis. Un mot déjà présent dans les faits (par exemple dans le titre
 * d'une vraie manchette citée) n'est pas rejeté ; la comparaison est mot pour mot, donc « rapide » dans les faits
 * n'autorise pas « rapidement ».
 */
export function inventedQualifiers(text: string, facts: string): string[] {
  const known = new Set(qualifiersOf(facts));
  return qualifiersOf(text).filter((w) => !known.has(w));
}

