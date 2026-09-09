/**
 * Reads the environment variables the server needs, failing loudly and early
 * rather than surfacing as a confusing connection error deep in a request.
 */

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in for local development, ` +
        `or set it in the Vercel project settings.`,
    );
  }

  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
};
