/** Réglages AWS communs aux deux applications (Miroir et la plateforme de courtage). */
export const env = {
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  /** Bucket S3 des données (dataset/, data/, corpus de nouvelles). Vide = disque local seulement. */
  dataBucket: process.env.DATA_BUCKET ?? '',
};
