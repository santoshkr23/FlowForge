import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Sign in" };

export default function Login() {
  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-8 px-5">
      <Logo />
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
