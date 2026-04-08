import { TestableSignIn } from "@/components/auth/testable-sign-in";
import {
  getTestAuthPresets,
  shouldShowTestAuthPresets,
} from "@/lib/test-auth-presets";

export default function SignInPage() {
  const presets = getTestAuthPresets();

  return <TestableSignIn presets={presets} showTestPresets={shouldShowTestAuthPresets(presets)} />;
}
