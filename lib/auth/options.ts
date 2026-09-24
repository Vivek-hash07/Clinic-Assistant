import bcrypt from "bcrypt";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/prisma";

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
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { patient: true },
        });
        if (!user?.patient) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.patient.name,
          patientId: user.patient.id,
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
