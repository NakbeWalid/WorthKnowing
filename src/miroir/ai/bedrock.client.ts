import { Injectable, Logger } from '@nestjs/common';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config';

/**
 * Accès unique à Amazon Bedrock (API Converse), partagé par les agents qui utilisent un modèle.
 * Température 0 et sortie JSON stricte : le code valide ensuite chaque champ retourné.
 */
@Injectable()
export class BedrockClient {
  private client = new BedrockRuntimeClient({ region: config.awsRegion });
  private log = new Logger('Bedrock');
  readonly modelId = config.bedrockModelId;

  /** Envoie une consigne et retourne l'objet JSON produit par le modèle (lève une erreur sinon). */
  async json<T>(system: string, prompt: string, maxTokens = 800, timeoutMs = config.bedrockTimeoutMs): Promise<T> {
    const started = Date.now();
    const out = await this.client.send(new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens, temperature: 0 },
    }), { abortSignal: AbortSignal.timeout(timeoutMs) });
    const text = (out.output?.message?.content ?? []).map((c) => c.text ?? '').join('');
    this.log.debug(`${Date.now() - started} ms, ${out.usage?.inputTokens} → ${out.usage?.outputTokens} jetons`);
    return parseJson<T>(text);
  }
}

/** Extrait le premier objet JSON du texte (le modèle l'entoure parfois de ```json). */
function parseJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Réponse du modèle sans JSON.');
  return JSON.parse(text.slice(start, end + 1)) as T;
}
