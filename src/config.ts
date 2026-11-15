/** Configuration centralisée (variables d'environnement). */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@miroir.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin123',
  /** Seuil du score de dérive à partir duquel une réévaluation est exigée. */
  driftThreshold: Number(process.env.DRIFT_THRESHOLD ?? 60),
  /** Capital fictif de départ de chaque utilisateur. */
  startingCash: 100_000,
  /** Nombre de mises en situation par évaluation (une par type de biais). */
  scenariosPerEvaluation: 5,
  /** Pause entre les étapes du pipeline, pour que la vue admin les montre une à une (démo). */
  pipelineStepDelayMs: Number(process.env.PIPELINE_STEP_DELAY_MS ?? 350),
};
