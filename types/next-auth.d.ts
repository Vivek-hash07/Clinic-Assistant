import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      patientId: string;
    } & DefaultSession["user"];
  }

  interface User {
    patientId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    patientId: string;
  }
}
