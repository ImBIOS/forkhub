export type CreateContextOptions = {
  context: unknown;
};

export async function createContext(_options: CreateContextOptions) {
  return {
    auth: null,
    session: null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
