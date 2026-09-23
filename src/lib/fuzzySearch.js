// ============================================================
// Forgiving text search
// ------------------------------------------------------------
// Every search in the app used to be `haystack.includes(query)`. That is
// already case-insensitive, but it only matches a literal contiguous run —
// so searching "mini gallery" could never find a file called
// "mini inpo gal", because those exact 12 characters don't appear in it.
//
// This scores a record against a query instead of testing it. Each word of
// the query is matched independently against each word of the record, by the
// strongest of several strategies, and a record has to account for every
// query word to survive. That makes all of these find "mini inpo gal":
//
//   mini gallery   → "gal" is the start of "gallery"   (prefix, either way)
//   gallery mini   → word order doesn't matter          (per-word matching)
//   mini galery    → one letter off                     (edit distance)
//   mini-gallery   → punctuation is a separator         (tokenizing)
//   miniGallery    → camelCase splits into words        (tokenizing)
//
// ...while "mini gallery" still does NOT match a file about "minimum wage",
// because "gallery" has nothing to pair with there.
// ============================================================

// Split into comparable words. Runs before lowercasing so camelCase and
// PascalCase can be split on the case change — worth doing because file
// names and paths are full of them (miniGalleryLoader.js → mini gallery
// loader js).
export function tokenize(raw) {
  return String(raw == null ? '' : raw)
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    // Strip accents so "café" and "cafe" match each other.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Flatten to a single normalized string, for whole-phrase checks.
const flatten = (raw) => tokenize(raw).join(' ');

// How many single-character edits to forgive, by word length. Short words get
// no slack at all — at four characters one edit already reaches a different
// word ("wage" is one edit from "page"), so forgiving it turns every short
// query into a guess. Typos in short words are also rare and easy to see.
function allowedEdits(len) {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

// Levenshtein distance, abandoned as soon as it's provably over `max`.
// Bailing early matters: this runs per query-word × record-word × record.
function editDistance(a, b, max) {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;

  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // Every remaining path runs through this row, so it can only get worse.
    if (rowMin > max) return max + 1;
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[bl];
}

// Do the characters of `term` appear in `word` in order, with gaps allowed?
// This is what makes "mnigal" find "mini gallery" — the loose match a command
// palette does. It scores lowest because it's also the easiest to trip.
function isSubsequence(term, word) {
  if (term.length > word.length) return false;
  let i = 0;
  for (let j = 0; j < word.length && i < term.length; j++) {
    if (word[j] === term[i]) i++;
  }
  return i === term.length;
}

// Best score for one query word against one record word. 0 = no match.
// The ladder is ordered by how much the match tells you: an exact hit is
// worth far more than a shared prefix, which beats a typo.
function scoreWord(term, word) {
  if (term === word) return 1;

  // Either direction: the typed word may be longer than the stored one
  // ("gallery" vs the stored "gal") or shorter ("gal" vs "gallery").
  const shorter = term.length < word.length ? term : word;
  const longer  = term.length < word.length ? word : term;
  if (longer.startsWith(shorter)) {
    // Scaled by how much of the longer word is accounted for, so "gal" against
    // "gallery" scores better than "g" against "gallery".
    return 0.6 + 0.3 * (shorter.length / longer.length);
  }

  if (word.includes(term)) return 0.55 * (term.length / word.length) + 0.2;

  const max = allowedEdits(Math.max(term.length, word.length));
  if (max > 0) {
    const dist = editDistance(term, word, max);
    if (dist <= max) return 0.5 * (1 - dist / (max + 1));
  }

  // Only worth trying for terms long enough to be deliberate.
  if (term.length >= 4 && isSubsequence(term, word)) return 0.25;

  return 0;
}

/**
 * Score a record against a query.
 *
 * @param {string} query   what the user typed
 * @param {Array}  fields  [{ text, weight }] — weight defaults to 1. Give
 *                         titles a higher weight than body text so a name hit
 *                         outranks a passing mention in a description.
 * @returns {number} 0 when the record doesn't match; higher is better.
 */
export function scoreRecord(query, fields) {
  const terms = tokenize(query);
  if (!terms.length) return 0;

  const prepared = (fields || [])
    .filter(f => f && f.text)
    .map(f => ({
      weight: f.weight == null ? 1 : f.weight,
      words: tokenize(f.text),
      flat: flatten(f.text),
    }))
    .filter(f => f.words.length);
  if (!prepared.length) return 0;

  let total = 0;

  for (const term of terms) {
    let best = 0;
    for (const field of prepared) {
      for (const word of field.words) {
        const s = scoreWord(term, word) * field.weight;
        if (s > best) best = s;
      }
      // A term spanning a word boundary in the source ("checkout" against a
      // stored "check out") won't match any single word, so also try the
      // field as one run of text.
      if (best < 0.5 * field.weight && field.flat.replace(/ /g, '').includes(term)) {
        const s = 0.5 * field.weight;
        if (s > best) best = s;
      }
    }
    // Every word the user typed has to be accounted for somewhere. Without
    // this, "mini gallery" matches anything containing "mini" and the results
    // fill up with noise.
    if (best === 0) return 0;
    total += best;
  }

  // The whole phrase appearing intact is a strong signal — push those to the
  // top, above records that merely contain the same words scattered about.
  const phrase = terms.join(' ');
  if (terms.length > 1) {
    for (const field of prepared) {
      if (field.flat.includes(phrase)) { total += 0.5 * field.weight; break; }
    }
  }

  return total;
}

/**
 * Filter and rank a list in one step. Records scoring 0 are dropped, and the
 * rest come back best-first.
 *
 * @param {Array}    items    the records
 * @param {string}   query    what the user typed
 * @param {Function} getFields (item) => [{ text, weight }]
 */
export function searchRank(items, query, getFields) {
  // A copy even in the no-query case: callers chain .sort() onto the result,
  // and sort mutates — handing back the caller's own array would reorder it.
  if (!query || !query.trim()) return (items || []).slice();
  return (items || [])
    .map(item => ({ item, score: scoreRecord(query, getFields(item)) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.item);
}
