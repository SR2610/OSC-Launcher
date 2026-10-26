use std::fs;
use std::path::Path;

fn copy_dir_all(src: &Path, dst: &Path) {
    let _ = fs::create_dir_all(dst);
    if let Ok(entries) = fs::read_dir(src) {
        for entry in entries.flatten() {
            let path = entry.path();
            let dest_path = dst.join(entry.file_name());
            if path.is_dir() {
                copy_dir_all(&path, &dest_path);
            } else {
                let _ = fs::copy(&path, &dest_path);
            }
        }
    }
}

fn main() {
    // Automatically prepare dist-tauri if missing so cargo test / cargo check always succeed
    let dist = Path::new("../dist-tauri");
    let _ = fs::create_dir_all(dist);

    for file in ["index.html", "index.css", "renderer.js"] {
        let src = Path::new("..").join(file);
        let dst = dist.join(file);
        if src.exists() {
            let _ = fs::copy(src, dst);
        }
    }

    let assets_src = Path::new("../assets");
    let assets_dst = dist.join("assets");
    if assets_src.exists() {
        copy_dir_all(assets_src, &assets_dst);
    }

    tauri_build::build();
}
