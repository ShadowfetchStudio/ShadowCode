//! The Windows sandbox launcher on its own, for the engine's tests (the app
//! runs its own executable with the launch flag instead).
fn main() {
    #[cfg(windows)]
    {
        let mut args = std::env::args_os().skip(1).peekable();
        if args.peek().map(|a| a.as_os_str())
            == Some(std::ffi::OsStr::new(
                shadowcode_core::sandbox::appcontainer::LAUNCH_FLAG,
            ))
        {
            args.next();
        }
        std::process::exit(shadowcode_core::sandbox::appcontainer::launch_main(
            args.collect(),
        ));
    }
    #[cfg(not(windows))]
    {
        eprintln!("The ShadowCode sandbox launcher is for Windows.");
        std::process::exit(2);
    }
}
