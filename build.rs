use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::{env, fs};

/// Embeds everything under static/ (the built frontend) into the binary as a
/// path -> bytes map, generated into OUT_DIR and included by src/rest/ui.rs.
fn main() -> io::Result<()> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(io::Error::other)?);
    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(io::Error::other)?);
    let static_dir = manifest_dir.join("static");

    println!("cargo:rerun-if-changed={}", static_dir.display());

    let mut files = Vec::new();
    visit_dirs(&static_dir, &mut files)?;

    let mut entries = Vec::new();
    for file in files {
        let key = file
            .strip_prefix(&static_dir)
            .map_err(io::Error::other)?
            .to_string_lossy()
            .replace('\\', "/");
        if key == ".gitkeep" {
            continue;
        }
        println!("cargo:rerun-if-changed={}", file.display());
        entries.push((key, file));
    }

    let mut f = fs::File::create(out_dir.join("static_files.rs"))?;
    writeln!(f, "use std::collections::HashMap;")?;
    writeln!(
        f,
        "pub fn static_files() -> HashMap<&'static str, &'static [u8]> {{"
    )?;
    if entries.is_empty() {
        writeln!(f, "    HashMap::new()")?;
    } else {
        writeln!(f, "    HashMap::from([")?;
        for (key, file) in entries {
            writeln!(
                f,
                "        (r#\"{}\"# as &'static str, include_bytes!(r#\"{}\"#).as_ref()),",
                key,
                file.display()
            )?;
        }
        writeln!(f, "    ])")?;
    }
    writeln!(f, "}}")?;
    Ok(())
}

fn visit_dirs(dir: &Path, files: &mut Vec<PathBuf>) -> io::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            visit_dirs(&path, files)?;
        } else {
            files.push(path);
        }
    }
    Ok(())
}
