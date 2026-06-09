#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--sync-once") {
        sf_sync_lib::run_once();
        return;
    }
    if args.iter().any(|a| a == "--enforce-once") {
        sf_sync_lib::run_enforce_once();
        return;
    }
    sf_sync_lib::run()
}
