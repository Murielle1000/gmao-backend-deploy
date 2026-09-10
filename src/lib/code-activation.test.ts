import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DUREE_VALIDITE_JOURS,
  dateExpirationActivation,
  genererCodeActivation,
} from './code-activation';

describe('genererCodeActivation', () => {
  it('produit un code au format XXXX-XXXX', () => {
    const code = genererCodeActivation();
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("n'utilise jamais de caractères ambigus à l'oral ou à la lecture", () => {
    // Le code est destiné à être dicté ou recopié : 0/O, 1/I/L sont
    // volontairement exclus de l'alphabet (voir code-activation.ts).
    const interdits = /[0O1IL]/;
    for (let i = 0; i < 500; i++) {
      const code = genererCodeActivation();
      assert.ok(!interdits.test(code), `caractère ambigu trouvé dans « ${code} »`);
    }
  });

  it('produit des codes différents à chaque appel', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      codes.add(genererCodeActivation());
    }
    // Avec 31^8 combinaisons possibles, 500 tirages sans aucun doublon
    // est le comportement attendu d'un générateur correct.
    assert.equal(codes.size, 500);
  });
});

describe('dateExpirationActivation', () => {
  it(`fixe l'expiration à ${DUREE_VALIDITE_JOURS} jours dans le futur`, () => {
    const avant = Date.now();
    const expiration = dateExpirationActivation().getTime();
    const attendu = avant + DUREE_VALIDITE_JOURS * 24 * 60 * 60 * 1000;

    // Tolérance de 5 secondes pour absorber le temps d'exécution du test.
    assert.ok(Math.abs(expiration - attendu) < 5000);
  });

  it("produit une date strictement postérieure à maintenant", () => {
    assert.ok(dateExpirationActivation().getTime() > Date.now());
  });
});
