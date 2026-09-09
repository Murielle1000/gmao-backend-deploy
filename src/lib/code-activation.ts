import crypto from 'crypto';

// Alphabet volontairement restreint : que des caractères non-ambigus à
// l'oral/à la lecture (pas de 0/O, 1/I/L, ni de voyelles qui formeraient
// des mots reconnaissables par hasard) — le code est destiné à être
// transmis oralement ou recopié depuis un SMS/écran de taille modeste.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LONGUEUR = 8;

/// Durée de validité d'un code d'activation avant qu'il faille en
/// régénérer un (voir PATCH /:id/regenerer-code-activation).
export const DUREE_VALIDITE_JOURS = 7;

export function genererCodeActivation(): string {
  let code = '';
  for (let i = 0; i < LONGUEUR; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (i === 3) code += '-'; // ex. "K7X9-M3PQ", plus lisible
  }
  return code;
}

export function dateExpirationActivation(): Date {
  return new Date(Date.now() + DUREE_VALIDITE_JOURS * 24 * 60 * 60 * 1000);
}
