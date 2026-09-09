import Anthropic from '@anthropic-ai/sdk';
import { TypeIncident } from '@prisma/client';

// Suggestion IA du type d'incident à partir de la description libre saisie
// par le locataire (besoin : aujourd'hui le champ "type" est un menu
// déroulant purement manuel — voir POST /incidents/suggerer-type). Le
// niveau d'urgence, lui, reste calculé par le moteur déterministe existant
// (`priority-engine.ts`) une fois le type connu : pas besoin d'IA pour ça.
//
// Utilise l'API Messages d'Anthropic avec un "tool" à schéma contraint
// (plutôt que de faire écrire du JSON libre au modèle et de le parser) :
// le type renvoyé est garanti appartenir à l'énumération Prisma, ce qui
// évite toute valeur inventée par le modèle.

const TYPES_VALIDES = Object.values(TypeIncident);

const LABEL_TYPE: Record<TypeIncident, string> = {
  fuiteEau: "Fuite d'eau",
  panneElectrique: 'Panne électrique',
  degradationStructurelle: 'Dégradation structurelle',
  panneClimatisation: 'Panne de climatisation',
  problemePlomberie: 'Problème de plomberie',
  panneAscenseur: "Panne d'ascenseur",
  securiteIncendie: 'Sécurité incendie',
  autre: 'Autre',
};

// Modèle rapide et économique : suffisant pour une classification à 8
// catégories, pas besoin d'un modèle plus coûteux pour cette tâche.
const MODELE = 'claude-haiku-4-5-20251001';

const OUTIL_CLASSIFICATION: Anthropic.Tool = {
  name: 'classifier_incident',
  description:
    "Enregistre la catégorie d'incident de maintenance immobilière la plus adaptée à la description fournie.",
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: TYPES_VALIDES,
        description: 'Catégorie la plus adaptée parmi celles proposées.',
      },
      justification: {
        type: 'string',
        description:
          'Courte explication en français (une phrase) de pourquoi cette catégorie a été choisie.',
      },
    },
    required: ['type', 'justification'],
  },
};

export interface SuggestionType {
  type: TypeIncident;
  justification: string;
}

let client: Anthropic | null = null;

function obtenirClient(): Anthropic {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    throw new Error(
      "ANTHROPIC_API_KEY absente de la configuration : la suggestion IA n'est pas disponible.",
    );
  }
  if (!client) {
    // Nécessaire pour certaines clés API créées sans workspace précis
    // dans la console Anthropic ("This API key is not scoped to a
    // workspace") : l'appel échoue en 400 tant que l'ID du workspace
    // n'est pas fourni explicitement. Optionnel — sans effet pour une clé
    // déjà rattachée à un workspace.
    const idWorkspace = process.env.ANTHROPIC_WORKSPACE_ID;
    client = new Anthropic({
      apiKey: cle,
      defaultHeaders: idWorkspace
        ? { 'anthropic-workspace-id': idWorkspace }
        : undefined,
    });
  }
  return client;
}

/// Lève une erreur si la classification échoue (clé absente, description
/// trop courte, panne réseau, réponse inexploitable...) — c'est à
/// l'appelant (la route) de décider comment réagir ; on ne renvoie jamais
/// une valeur par défaut silencieuse qui pourrait passer pour un vrai avis
/// de l'IA.
export async function suggererTypeIncident(description: string): Promise<SuggestionType> {
  const texte = description.trim();
  if (texte.length < 10) {
    throw new Error('Description trop courte pour être analysée.');
  }

  const listeCategories = TYPES_VALIDES.map((t) => `- ${t} : ${LABEL_TYPE[t]}`).join('\n');

  const message = await obtenirClient().messages.create({
    model: MODELE,
    max_tokens: 300,
    system:
      "Tu aides à trier des signalements d'incidents de maintenance dans un immeuble, à partir de la " +
      "description écrite par un locataire (souvent informelle, parfois imprécise). Choisis toujours la " +
      "catégorie la plus adaptée dans la liste fournie, même en cas de doute — utilise \"autre\" seulement " +
      "si vraiment aucune catégorie ne correspond.",
    tools: [OUTIL_CLASSIFICATION],
    tool_choice: { type: 'tool', name: 'classifier_incident' },
    messages: [
      {
        role: 'user',
        content: `Catégories disponibles :\n${listeCategories}\n\nDescription du locataire :\n"""${texte}"""`,
      },
    ],
  });

  const appelOutil = message.content.find(
    (bloc): bloc is Anthropic.ToolUseBlock => bloc.type === 'tool_use',
  );
  if (!appelOutil) {
    throw new Error("L'IA n'a renvoyé aucune classification exploitable.");
  }

  const entree = appelOutil.input as { type?: string; justification?: string };
  if (!entree.type || !TYPES_VALIDES.includes(entree.type as TypeIncident)) {
    throw new Error('Type suggéré par l’IA invalide.');
  }

  return {
    type: entree.type as TypeIncident,
    justification: typeof entree.justification === 'string' ? entree.justification.trim() : '',
  };
}
