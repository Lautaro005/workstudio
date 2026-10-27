// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(|a| a == "mcp").unwrap_or(false) {
        workstudio_lib::serve_mcp(&args[1..]);
        return;
    }
    workstudio_lib::run()
}
