import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Create account" };

export default function Signup() {
  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-8 px-5">
      <Logo />
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </main>
  );
}
