"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, ChevronRight, Clock3, LogOut, Settings } from "lucide-react";
import { CleanerSection } from "@/components/cleaner/cleaner-ui";

export default function CleanerMorePage() {
  const { signOut } = useAuth();
  const router = useRouter();
  const t = useTranslations();

  const menuSections = [
    {
      titleKey: "cleaner.moreMenu.activity",
      items: [
        {
          id: "history",
          labelKey: "cleaner.moreMenu.jobHistory",
          descKey: "cleaner.moreMenu.jobHistoryDesc",
          href: "/cleaner/history",
          icon: Clock3,
        },
        {
          id: "settings",
          labelKey: "cleaner.moreMenu.settingsLabel",
          descKey: "cleaner.moreMenu.settingsDesc",
          href: "/cleaner/settings",
          icon: Settings,
        },
        {
          id: "notifications",
          labelKey: "cleaner.moreMenu.notificationsLabel",
          descKey: "cleaner.moreMenu.notificationsDesc",
          href: "/cleaner/settings",
          icon: Bell,
        },
      ],
    },
  ];

  const handleSignOut = async () => {
    await signOut();
    router.push("/sign-in");
  };

  return (
    <div className="space-y-4">
      {menuSections.map((section) => (
        <CleanerSection key={section.titleKey} eyebrow={t(section.titleKey)} title={t("cleaner.more")}>
          <div className="space-y-3">
            {section.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--muted)]/35 px-4 py-3 transition-colors hover:bg-[var(--muted)]/60"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[var(--cleaner-primary)] shadow-[var(--cleaner-shadow)]">
                  <item.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-[var(--font-cleaner-body)] text-sm font-semibold text-[var(--cleaner-ink)]">
                    {t(item.labelKey)}
                  </p>
                  <p className="text-xs text-[var(--cleaner-muted)]">{t(item.descKey)}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--cleaner-muted)]" />
              </Link>
            ))}
          </div>
        </CleanerSection>
      ))}

      <CleanerSection eyebrow={t("cleaner.moreMenu.account")} title={t("cleaner.moreMenu.session")}>
        <button
          type="button"
          onClick={() => {
            void handleSignOut();
          }}
          className="flex w-full items-center gap-3 rounded-[18px] border border-[var(--destructive)]/25 bg-[var(--destructive)]/8 px-4 py-3 text-left"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[var(--destructive)] shadow-[var(--cleaner-shadow)]">
            <LogOut className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-[var(--font-cleaner-body)] text-sm font-semibold text-[var(--destructive)]">
              {t("cleaner.moreMenu.signOut")}
            </p>
            <p className="text-xs text-[var(--cleaner-muted)]">{t("cleaner.moreMenu.signOutDesc")}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--cleaner-muted)]" />
        </button>
      </CleanerSection>
    </div>
  );
}
