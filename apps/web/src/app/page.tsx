"use client";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export default function Home() {
  const healthCheck = useQuery(orpc.healthCheck.queryOptions());

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <div className="grid gap-10">
        <section className="grid gap-4 text-center">
          <h1 className="text-5xl font-bold tracking-tight">forkhub</h1>
          <p className="text-lg text-muted-foreground">
            Keep up-to-date upstream + your custom patches. Patches are intent,
            not diffs.
          </p>
          <div className="flex justify-center gap-3 text-sm">
            <a
              className="rounded-md border px-4 py-2 font-medium transition-colors hover:bg-accent"
              href="https://github.com/ImBIOS/forkhub"
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <a
              className="rounded-md border px-4 py-2 font-medium transition-colors hover:bg-accent"
              href="https://www.npmjs.com/package/forkhub"
              rel="noreferrer"
              target="_blank"
            >
              npm
            </a>
          </div>
        </section>

        <section className="rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Install</h2>
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
              npm i -g forkhub
            </code>
          </div>
          <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">
            {`$ fh init                    # set up .forkhub in your fork
$ fh draft "add --cheat flag" # declare intent, AI implements
$ fh satisfied                # capture diff, port to forkhub/main
$ fh update                   # upstream releases? re-derive + apply`}
          </pre>
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">API Status</h2>
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${healthCheck.data ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-sm text-muted-foreground">
              {healthCheck.isLoading
                ? "Checking..."
                : healthCheck.data
                  ? "Connected"
                  : "Disconnected"}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
