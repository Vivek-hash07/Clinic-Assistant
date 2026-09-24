import { prisma } from "../lib/db/prisma";
import { seedClinic } from "../lib/db/seedClinic";

seedClinic()
  .then(async (result) => {
    console.log(
      `Seeded ${result.patients} patients and ${result.appointments} appointments.`,
    );
    console.log("Sign in with password patient-demo:");
    console.log("- maya.patel@clinic.example (Maya Patel)");
    console.log("- luis.romero@clinic.example (Luis Romero)");
    console.log("- hannah.berg@clinic.example (Hannah Berg)");
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
