#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![tauri_plugin_sql::Migration {
    version: 1,
    description: "create AgentXRay persistence tables",
    sql: "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);\nCREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, prompt TEXT NOT NULL, created_at INTEGER NOT NULL, errors TEXT NOT NULL DEFAULT '{}');\nCREATE TABLE IF NOT EXISTS trace_runs (id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, mode TEXT NOT NULL, turn_number INTEGER NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL, FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE);\nCREATE INDEX IF NOT EXISTS idx_trace_runs_experiment ON trace_runs(experiment_id);",
    kind: tauri_plugin_sql::MigrationKind::Up,
  }];
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:agentxray.db", migrations).build())
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
