export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { localResilienceStatus } = await import("./lib/local-resilience");
    localResilienceStatus();
    console.log("[resilience] local SQLite initialized");
  } catch (error) {
    console.error("[resilience] failed to initialize local SQLite", error);
  }
}
