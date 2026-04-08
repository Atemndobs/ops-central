export type TestAuthRole = "cleaner" | "manager" | "admin" | "property_ops";

export type TestAuthPreset = {
  role: TestAuthRole;
  label: string;
  description: string;
  email: string;
  password: string;
};

function getEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return "";
}

export function getTestAuthPresets(): TestAuthPreset[] {
  const sharedPassword = getEnv(
    "NEXT_PUBLIC_TEST_PASSWORD",
    "EXPO_PUBLIC_TEST_PASSWORD",
    "NEXT_PUBLIC_TEST_CLEANER_PASSWORD",
    "EXPO_PUBLIC_TEST_CLEANER_PASSWORD",
    "NEXT_PUBLIC_TEST_MANAGER_PASSWORD",
    "EXPO_PUBLIC_TEST_MANAGER_PASSWORD",
    "NEXT_PUBLIC_TEST_ADMIN_PASSWORD",
    "EXPO_PUBLIC_TEST_ADMIN_PASSWORD",
    "NEXT_PUBLIC_TEST_PROPERTY_OPS_PASSWORD",
    "EXPO_PUBLIC_TEST_PROPERTY_OPS_PASSWORD",
  );

  return [
    {
      role: "cleaner",
      label: "Cleaner",
      description: "Cleaner mobile-equivalent test account",
      email: getEnv("NEXT_PUBLIC_TEST_CLEANER_EMAIL", "EXPO_PUBLIC_TEST_CLEANER_EMAIL"),
      password: sharedPassword,
    },
    {
      role: "manager",
      label: "Manager",
      description: "Company-scoped manager test account",
      email: getEnv("NEXT_PUBLIC_TEST_MANAGER_EMAIL", "EXPO_PUBLIC_TEST_MANAGER_EMAIL"),
      password: sharedPassword,
    },
    {
      role: "property_ops",
      label: "Property Ops",
      description: "Ops user with broader scheduling access",
      email: getEnv(
        "NEXT_PUBLIC_TEST_PROPERTY_OPS_EMAIL",
        "EXPO_PUBLIC_TEST_PROPERTY_OPS_EMAIL",
      ),
      password: sharedPassword,
    },
    {
      role: "admin",
      label: "Admin",
      description: "Full-access admin test account",
      email: getEnv("NEXT_PUBLIC_TEST_ADMIN_EMAIL", "EXPO_PUBLIC_TEST_ADMIN_EMAIL"),
      password: sharedPassword,
    },
  ];
}

export function shouldShowTestAuthPresets(presets: TestAuthPreset[]): boolean {
  const explicitFlag = process.env.NEXT_PUBLIC_ENABLE_TEST_LOGIN_PRESETS;
  const hasConfiguredPreset = presets.some((preset) => preset.email && preset.password);

  if (explicitFlag === "true") {
    return true;
  }

  if (explicitFlag === "false") {
    return false;
  }

  return process.env.NODE_ENV !== "production" && hasConfiguredPreset;
}
