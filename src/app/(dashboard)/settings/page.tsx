import {
  SettingsPageClient,
  type SettingsTab,
} from "@/components/settings/settings-page-client";

const validTabs: SettingsTab[] = [
  "general",
  "scheduling",
  "notifications",
  "integrations",
  "team",
];

function parseTab(tab: string | undefined): SettingsTab {
  if (tab && validTabs.includes(tab as SettingsTab)) {
    return tab as SettingsTab;
  }

  return "general";
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <SettingsPageClient initialTab={parseTab(tab)} />;
}
