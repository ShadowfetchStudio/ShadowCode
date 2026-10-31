fn main() {
    // Windows' default 1 MiB main-thread stack is too small for the CLI's
    // unoptimized async entry point: `run` overflows before the first event.
    // Reserve the usual Unix-sized stack; pages are committed on demand.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-bin=shadowcode=/STACK:8388608");
    }
    tauri_build::build()
}
