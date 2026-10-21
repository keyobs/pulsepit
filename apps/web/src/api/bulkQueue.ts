import { BULK_REQUEST_LIMIT } from '@constants/api';
import { createRequestQueue } from '@utils/requestQueue';

/** File partagée par toutes les actions de masse (fetch, diagnostic, vérification des déploiements). */
export const bulkQueue = createRequestQueue(BULK_REQUEST_LIMIT);
