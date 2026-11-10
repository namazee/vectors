import { config } from "dotenv";
// Load .env.local first (Next.js convention), then .env.
config({ path: [".env.local", ".env"], quiet: true });
