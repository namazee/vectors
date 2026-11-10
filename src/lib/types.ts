export type PlanId = "free" | "pro";
export type ModelTier = "unmetered" | "frontier";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  plan: PlanId;
  stripe_customer_id: string | null;
  created_at: string;
}

export interface ModelRow {
  id: string;
  slug: string;
  display_name: string;
  provider: string;
  openrouter_id: string;
  free_openrouter_id: string | null;
  fallback_model_slug: string | null;
  tier: ModelTier;
  input_price_per_m: number;
  output_price_per_m: number;
  context_length: number | null;
  max_output_tokens: number | null;
  description: string | null;
  logo: string | null;
  active: boolean;
  sort_order: number;
  est_credits_per_request: number | null;
  avg_credits_per_request: number | null;
  avg_sample_count: number;
  margin_override: number | null;
  last_synced_at: string | null;
}

/** Shape sent to the browser (no internal routing IDs). */
export interface PublicModel {
  slug: string;
  name: string;
  provider: string;
  tier: ModelTier;
  description: string | null;
  contextLength: number | null;
  /** ~X credits/request (0 for unmetered). */
  creditsPerRequest: number;
}

export interface Wallet {
  daily: number;
  topup: number;
  held: number;
  available: number;
  daily_date: string;
}

export interface Conversation {
  id: string;
  title: string;
  model_slug: string | null;
  is_compare: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model_slug: string | null;
  served_model: string | null;
  credits_used: number;
  compare_group: string | null;
  status: "complete" | "stopped" | "error";
  notice: string | null;
  created_at: string;
}
