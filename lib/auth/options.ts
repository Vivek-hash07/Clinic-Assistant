import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { signInWithPassword } from "@/lib/auth/credentials";

// Derive the auth origin from the request host. Next.js sets
// x-forwarded-host and x-forwarded-proto, including http://localhost on any port.
process.env.AUTH_TRUST_HOST ??= "true";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const result = await signInWithPassword(
          credentials?.email,
          credentials?.password,
        );
        if (!result.ok) return null;

        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          patientId: result.user.patientId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.patientId = user.patientId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId && token.patientId) {
        session.user.id = token.userId;
        session.user.patientId = token.patientId;
      }
      return session;
    },
  },
};
