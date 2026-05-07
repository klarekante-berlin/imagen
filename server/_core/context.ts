import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

const DEV_USER: User = {
  id: 0,
  openId: "dev-local",
  name: "Dev (local)",
  email: "dev@localhost",
  loginMethod: "dev-bypass",
  role: "admin",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSignedIn: new Date(0),
};

/**
 * In development without OAUTH_SERVER_URL set, no user can authenticate
 * via the regular flow. Inject a synthetic dev user so protected mutations
 * (story.create, asset.upload, …) work locally without an OAuth provider.
 */
function shouldBypassAuth(): boolean {
  return !ENV.isProduction && !ENV.oAuthServerUrl;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  if (!user && shouldBypassAuth()) {
    user = DEV_USER;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
