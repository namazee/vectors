/**
 * Syncs model prices and context lengths from the OpenRouter models API.
 *
 *   npm run sync:prices            # apply changes
 *   npm run sync:prices -- --dry   # show what would change
 */
import "./load-env";
import { createClient } from "@supabase/supabase-js";
import { fetchOpenRouterModels, syncModelPrices } from "../src/lib/models/sync";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. in .env.local).");
  const dryRun = process.argv.includes("--dry");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const remote = await fetchOpenRouterModels(process.env.OPENROUTER_BASE_URL || undefined);
  console.log(`Fetched ${remote.length} models from OpenRouter.`);
  const r = await syncModelPrices(db, remote, { dryRun });

  for (const c of r.changes) console.log(`  ${c.slug.padEnd(24)} ${c.field.padEnd(20)} ${c.from} → ${c.to}`);
  for (const m of r.missing) console.warn(`  ! ${m.slug}: ${m.openrouterId} no longer exists on OpenRouter. Deactivate or update it in Admin → Models.`);
  for (const m of r.missingFree) console.warn(`  ! ${m.slug}: free endpoint ${m.freeId} is gone. Requests will use the paid fallback.`);
  console.log(`${dryRun ? "[dry run] " : ""}Checked ${r.checked}, ${dryRun ? "would update" : "updated"} ${dryRun ? new Set(r.changes.map((c) => c.slug)).size : r.updated}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
