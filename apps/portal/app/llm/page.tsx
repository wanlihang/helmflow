import { LlmProvidersClient } from "@/components/llm-providers-client";
import { RuntimeSettingsClient } from "@/components/runtime-settings-client";
import { getDb } from "@/lib/db";
import { maskApiKey } from "@/lib/llm-config";
import { getRuntimeSettings, listLLMProviders } from "@helmflow/storage";

export const dynamic = "force-dynamic";

export default function LlmPage() {
  const db = getDb();
  const providers = listLLMProviders(db).map((p) => ({ ...p, apiKey: maskApiKey(p.apiKey) }));
  const settings = getRuntimeSettings(db);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">模型配置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理连接大模型的 Provider(API Key / Endpoint / Model)。激活的 Provider 用于所有 LLM
          调用(分析/编排/契约)。
        </p>
      </div>
      <RuntimeSettingsClient initialSettings={settings} />
      <LlmProvidersClient initialProviders={providers} />
    </div>
  );
}
