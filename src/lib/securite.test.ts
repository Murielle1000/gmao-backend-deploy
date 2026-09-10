import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signToken, verifyToken } from './jwt';
import { comparePassword, hashPassword } from './password';

// Ces tests vérifient les deux mécanismes de sécurité les plus critiques
// de l'application : le stockage des mots de passe (jamais en clair) et
// l'intégrité des jetons d'authentification.
describe('Hachage des mots de passe', () => {
  it("ne conserve jamais le mot de passe en clair dans l'empreinte", async () => {
    const motDePasse = 'MonMotDePasse2026';
    const empreinte = await hashPassword(motDePasse);

    assert.notEqual(empreinte, motDePasse);
    assert.ok(!empreinte.includes(motDePasse));
  });

  it('valide le bon mot de passe et rejette un mauvais', async () => {
    const empreinte = await hashPassword('MonMotDePasse2026');

    assert.equal(await comparePassword('MonMotDePasse2026', empreinte), true);
    assert.equal(await comparePassword('MonMotDePasse2025', empreinte), false);
  });

  it('produit deux empreintes différentes pour un même mot de passe (salage)', async () => {
    const premiere = await hashPassword('MotDePasseIdentique');
    const seconde = await hashPassword('MotDePasseIdentique');

    // bcrypt intègre un sel aléatoire : deux utilisateurs ayant choisi le
    // même mot de passe n'ont pas la même empreinte en base.
    assert.notEqual(premiere, seconde);
    // Les deux restent pourtant valides pour ce mot de passe.
    assert.equal(await comparePassword('MotDePasseIdentique', premiere), true);
    assert.equal(await comparePassword('MotDePasseIdentique', seconde), true);
  });
});

describe("Jetons d'authentification (JWT)", () => {
  it("restitue l'identité et le rôle encodés dans le jeton", () => {
    const jeton = signToken({ id: 'utilisateur-123', role: 'administrateur' });
    const contenu = verifyToken(jeton);

    assert.equal(contenu.id, 'utilisateur-123');
    assert.equal(contenu.role, 'administrateur');
  });

  it('rejette un jeton dont le contenu a été modifié', () => {
    const jeton = signToken({ id: 'utilisateur-123', role: 'locataire' });

    // Un attaquant qui altère la charge utile (par exemple pour se donner
    // le rôle administrateur) invalide la signature du jeton.
    const [entete, , signature] = jeton.split('.');
    const chargeFalsifiee = Buffer.from(
      JSON.stringify({ id: 'utilisateur-123', role: 'administrateur' }),
    ).toString('base64url');
    const jetonFalsifie = `${entete}.${chargeFalsifiee}.${signature}`;

    assert.throws(() => verifyToken(jetonFalsifie));
  });

  it("rejette une chaîne qui n'est pas un jeton valide", () => {
    assert.throws(() => verifyToken('ceci-nest-pas-un-jeton'));
  });
});
