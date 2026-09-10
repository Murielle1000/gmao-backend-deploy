import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CriticiteBatiment, NiveauUrgence, TypeIncident } from '@prisma/client';

import { evaluerUrgence } from './priority-engine';

// Ces cas reprennent volontairement, un pour un, ceux du test Dart
// équivalent (gmao_rpi_app/test/priority_engine_test.dart) : le moteur de
// priorité existe en deux implémentations (une côté application mobile
// pour l'aperçu immédiat, une côté serveur qui fait foi), et elles doivent
// donner exactement le même résultat. Tester les deux avec les mêmes cas
// est le seul moyen de détecter une divergence entre elles.
describe('evaluerUrgence', () => {
  it("classe une fuite d'eau dangereuse en bâtiment stratégique comme critique", () => {
    const resultat = evaluerUrgence({
      type: TypeIncident.fuiteEau,
      description:
        "Fuite d'eau importante et dangereuse à proximité de prises électriques, risque de court-circuit.",
      criticiteBatiment: CriticiteBatiment.strategique,
    });

    assert.equal(resultat.niveau, NiveauUrgence.critique);
    assert.ok(resultat.facteursDeclenches.length > 0);
  });

  it("classe une panne électrique sans mot-clé en bâtiment important comme élevée", () => {
    const resultat = evaluerUrgence({
      type: TypeIncident.panneElectrique,
      description: 'Coupure de courant au 3e étage depuis ce matin.',
      criticiteBatiment: CriticiteBatiment.importante,
    });

    assert.equal(resultat.niveau, NiveauUrgence.elevee);
  });

  it('classe une dégradation structurelle simple en bâtiment standard comme moyenne', () => {
    const resultat = evaluerUrgence({
      type: TypeIncident.degradationStructurelle,
      description: 'Fissure visible sur le mur extérieur.',
      criticiteBatiment: CriticiteBatiment.standard,
    });

    assert.equal(resultat.niveau, NiveauUrgence.moyenne);
  });

  it('classe une panne de climatisation mineure en bâtiment standard comme faible', () => {
    const resultat = evaluerUrgence({
      type: TypeIncident.panneClimatisation,
      description: 'Le climatiseur ne refroidit plus.',
      criticiteBatiment: CriticiteBatiment.standard,
    });

    assert.equal(resultat.niveau, NiveauUrgence.faible);
  });

  it('plafonne le score issu des mots-clés', () => {
    const resultat = evaluerUrgence({
      type: TypeIncident.autre,
      description:
        'incendie feu fumée effondrement électrocution blessé blessure danger dangereux grave urgent urgence sécurité important',
      criticiteBatiment: CriticiteBatiment.standard,
    });

    // Poids de base "autre" (8) + plafond mots-clés (30) + bâtiment
    // standard (0) = 38 au maximum.
    assert.ok(resultat.score <= 38, `score attendu <= 38, obtenu ${resultat.score}`);
  });

  it("ne produit jamais un niveau inférieur pour un score supérieur", () => {
    const faible = evaluerUrgence({
      type: TypeIncident.autre,
      description: 'Petit problème sans gravité.',
      criticiteBatiment: CriticiteBatiment.standard,
    });
    const critique = evaluerUrgence({
      type: TypeIncident.securiteIncendie,
      description: 'Incendie déclaré, danger immédiat, blessés à évacuer.',
      criticiteBatiment: CriticiteBatiment.strategique,
    });

    assert.ok(critique.score > faible.score);
    const ordre = [
      NiveauUrgence.faible,
      NiveauUrgence.moyenne,
      NiveauUrgence.elevee,
      NiveauUrgence.critique,
    ];
    assert.ok(ordre.indexOf(critique.niveau) > ordre.indexOf(faible.niveau));
  });

  it('applique bien la pondération de criticité du bâtiment', () => {
    const commun = {
      type: TypeIncident.problemePlomberie,
      description: 'Robinet qui goutte dans les sanitaires.',
    };

    const standard = evaluerUrgence({ ...commun, criticiteBatiment: CriticiteBatiment.standard });
    const strategique = evaluerUrgence({
      ...commun,
      criticiteBatiment: CriticiteBatiment.strategique,
    });

    // Un incident identique doit être jugé plus urgent dans un bâtiment
    // stratégique que dans un bâtiment standard.
    assert.ok(strategique.score > standard.score);
  });
});
