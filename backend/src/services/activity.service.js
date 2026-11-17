import { getServiceClient } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

/**
 * Audit / activity log. Never store names, passwords, images or health data
 * in `details` — only identifiers and non-identifying metadata.
 */
export async function logActivity(userId, action, details = {}) {
  try {
    const { error } = await getServiceClient()
      .from('activity_logs')
      .insert({ user_id: userId ?? null, action, details });
    if (error) logger.warn('activity log insert failed', { action, error });
  } catch (err) {
    logger.warn('activity log insert failed', { action, error: err });
  }
}
