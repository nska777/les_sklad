let backgroundTimersStarted = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { createLocalBackup, localResilienceStatus } = await import("./lib/local-resilience");
    const { recoverBackgroundSyncQueue, runBackgroundSyncOnce } = await import("./lib/resilience-background");

    localResilienceStatus();
    recoverBackgroundSyncQueue();
    console.log("[resilience] local SQLite initialized");

    if (!backgroundTimersStarted) {
      backgroundTimersStarted = true;

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

      const sync = () => {
        void runBackgroundSyncOnce().catch((error) => {
          console.error("[resilience] background sync failed", error);
        });
      };

      hourlyBackup();
      dailyBackup();
      sync();

      const syncTimer = setInterval(sync, 20_000);
      const hourlyTimer = setInterval(hourlyBackup, 60 * 60 * 1000);
      const dailyTimer = setInterval(dailyBackup, 24 * 60 * 60 * 1000);
      syncTimer.unref();
      hourlyTimer.unref();
      dailyTimer.unref();
      console.log("[resilience] automatic background sync started (20s interval)");
    }
  } catch (error) {
    console.error("[resilience] failed to initialize local SQLite", error);
  }
}
