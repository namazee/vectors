import { getPlan } from "@/config/plans";
import { errorResponse, requireApiUser } from "@/lib/auth";
import { getWallet } from "@/lib/credits/ledger";
import { getPublicModels } from "@/lib/models/catalog";
import { getSettings } from "@/lib/settings";
import { getSpendState, getUnmeteredUsedToday } from "@/lib/capacity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId, profile } = await requireApiUser();
    const plan = getPlan(profile.plan);
    const settings = await getSettings();
    const [wallet, models, spend, unmeteredUsed] = await Promise.all([
      getWallet(userId, plan.id),
      getPublicModels(),
      getSpendState(settings),
      getUnmeteredUsedToday(userId),
    ]);
    return Response.json({
      wallet,
      models,
      status: {
        frontierPaused: spend.frontierPaused,
        plan: plan.id,
        dailyAllowance: plan.dailyCredits,
        unmeteredUsedToday: unmeteredUsed,
        unmeteredDailyCap: plan.id === "pro" ? settings.unmeteredCapPro : settings.unmeteredCapFree,
        compareEnabled: plan.compareMode,
        compareMaxModels: plan.compareMaxModels,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
