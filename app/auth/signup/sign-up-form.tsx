"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { buttonClassName, fieldClassName } from "@/components/auth-shell";

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  dob?: string;
};

export function SignUpForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        dob: formData.get("dob"),
        email,
        password,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      fieldErrors?: FieldErrors;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Could not create the account.");
      setFieldErrors(payload?.fieldErrors ?? {});
      setPending(false);
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/chat",
    });

    if (!result || result.error) {
      setError("Account created, but signing in failed. Try the sign-in page.");
      setPending(false);
      return;
    }

    router.push("/chat");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field
        id="name"
        label="Full name"
        name="name"
        autoComplete="name"
        error={fieldErrors.name}
      />
      <Field
        id="dob"
        label="Date of birth"
        name="dob"
        type="date"
        autoComplete="bday"
        error={fieldErrors.dob}
      />
      <Field
        id="email"
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        error={fieldErrors.email}
      />
      <Field
        id="password"
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        error={fieldErrors.password}
      />
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className={buttonClassName} disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Already registered?{" "}
        <Link
          href="/auth/signin"
          className="font-medium text-teal-800 hover:text-teal-950 dark:text-teal-300"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  name,
  type = "text",
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={error ? true : undefined}
        className={fieldClassName}
      />
      {error ? (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
