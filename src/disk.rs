use std::io;
use std::path::Path;

/// Free bytes on the filesystem holding `path`.
pub fn free_bytes(path: &Path) -> io::Result<u64> {
    let stat = nix::sys::statvfs::statvfs(path).map_err(io::Error::other)?;
    Ok(stat.block_size() * stat.blocks_available())
}

/// Total size of all regular files directly inside `dir` (non-recursive).
pub fn dir_size(dir: &Path) -> io::Result<u64> {
    let mut total = 0;
    if !dir.is_dir() {
        return Ok(0);
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_file() {
            total += metadata.len();
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_bytes_is_nonzero_for_tmp() {
        let free = free_bytes(Path::new("/tmp")).expect("statvfs");
        assert!(free > 0);
    }

    #[test]
    fn dir_size_sums_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("a"), vec![0u8; 100]).expect("write");
        std::fs::write(dir.path().join("b"), vec![0u8; 50]).expect("write");
        assert_eq!(dir_size(dir.path()).expect("size"), 150);
        assert_eq!(dir_size(&dir.path().join("missing")).expect("size"), 0);
    }
}
