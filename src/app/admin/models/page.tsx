import { getAllModels } from "@/lib/models/catalog";
import { ModelsManager } from "@/components/admin/models-manager";

export const dynamic = "force-dynamic";

export default async function AdminModelsPage() {
  const models = await getAllModels();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
        <p className="text-sm text-muted-foreground">
          Toggle availability, change tiers, edit prices and estimates, and reorder. Changes apply immediately.
        </p>
      </div>
      <ModelsManager initial={models} />
    </div>
  );
}
