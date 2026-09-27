let backupTimersStarted = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { createLocalBackup, localResilienceStatus } = await import("./lib/local-resilience");
    localResilienceStatus();
    console.log("[resilience] local SQLite initialized");

    if (!backupTimersStarted) {
      backupTimersStarted = true;

      const hourlyBackup = () => {
        try {
          const path = createLocalBackup("hourly");
          if (path) console.log(`[resilience] hourly backup created: ${path}`);
        } catch (error) {
          console.error("[resilience] hourly backup failed", error);
        }
      };

      const dailyBackup = () => {
        try {
          const path = createLocalBackup("daily");
          if (path) console.log(`[resilience] daily backup created: ${path}`);
        } catch (error) {
          console.error("[resilience] daily backup failed", error);
        }
      };

      hourlyBackup();
      dailyBackup();

      const hourlyTimer = setInterval(hourlyBackup, 60 * 60 * 1000);
      const dailyTimer = setInterval(dailyBackup, 24 * 60 * 60 * 1000);
      hourlyTimer.unref();
      dailyTimer.unref();
    }
  } catch (error) {
    console.error("[resilience] failed to initialize local SQLite", error);
  }
}
