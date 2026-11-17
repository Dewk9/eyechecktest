import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

const baseOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

let serviceClient = null;

/** Service-role client — bypasses RLS. Use only for privileged backend work. */
export function getServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient(config.supabase.url, config.supabase.serviceRoleKey, baseOptions);
  }
  return serviceClient;
}

/** Anonymous client — used for password sign-in and token refresh. */
export function createAnonClient() {
  return createClient(config.supabase.url, config.supabase.anonKey, baseOptions);
}

/**
 * Client acting as the signed-in user. Every query through it is checked
 * by Postgres Row Level Security using the user's JWT.
 */
export function createUserClient(accessToken) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    ...baseOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
